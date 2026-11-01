// AI 监测 Provider（mock）：
// 用「项目已发布文章 + 知识库事实 + 竞品种子」构建检索语料，按问题相关度 + 平台偏好权重
// 合成 AI 回答、品牌表现与引用来源。已发布且匹配的文章 URL 会作为 citation 返回，
// 从而真实演示「发布 → 监测 → exact_url_hit → 信源资产 → 优化复测」闭环。
// 四个平台的信源偏好按文档六(四)实现为观察假设（初始验证方向，不是固定算法）。
import { q, q1 } from '../db.js';
import { rngFrom, tokenize, jaccard, strHash, parseJsonSafe } from '../util.js';
import { AI_PLATFORM, PUBLISH_PLATFORM, PUBLISH_DOMAIN, label } from '../enums.js';

// 平台 → 域名偏好权重（文档六(四)：仅作为初始验证方向的观察假设）
const PLATFORM_BIAS = {
  1: { 'mock.toutiao.com': 1.6, 'mock.douyin.com': 1.5, 'mock.douyinec.com': 1.5 }, // 豆包 → 头条/抖音/抖音电商
  2: { 'mock.gov.cn': 1.6, 'mock.news.cn': 1.5, 'mock.industry.com': 1.4, 'mock.b2b.com': 1.3 }, // DeepSeek → 公共/商业/垂直媒体、B2B
  3: { 'mock.mp.weixin.qq.com': 1.7, 'mock.news.qq.com': 1.5, 'mock.penguin.com': 1.4 }, // 元宝 → 公众号/腾讯新闻/企鹅号
  4: { 'mock.smzdm.com': 1.6, 'mock.ownsite.cn': 1.4, 'mock.taobao.com': 1.3, 'mock.sohu.com': 1.2, 'mock.163.com': 1.2 }, // 通义 → 阿里生态/什么值得买/产品页 + 搜狐网易
};

// 竞品种子：固定演示竞品及其强势渠道（同一批竞品在任何项目下可复现演示效果）
const COMPETITOR_SEED = [
  {
    name: '跳跳鲨少儿体感',
    sources: [
      { title: '跳跳鲨少儿体感课程深度测评', url: 'https://mock.industry.com/tiaotiaosha-review', domain: 'mock.industry.com', platform: 5 },
      { title: '家长实测：跳跳鲨体感课三个月体验', url: 'https://mock.zhihu.com/p/tiaotiaosha-3month', domain: 'mock.zhihu.com', platform: 5 },
    ],
    strength: 0.55,
  },
  {
    name: '乐翻高儿童运动馆',
    sources: [
      { title: '乐翻高儿童运动馆App课程推荐榜单', url: 'https://mock.toutiao.com/p/lefangao-rank', domain: 'mock.toutiao.com', platform: 1 },
      { title: '乐翻高少儿体能课价格与课程体系', url: 'https://mock.163.com/p/lefangao-price', domain: 'mock.163.com', platform: 3 },
    ],
    strength: 0.48,
  },
];

function platformWeight(platform, domain) {
  return PLATFORM_BIAS[platform]?.[domain] ?? 1.0;
}

function competitorAffinity(platform) {
  // 竞品在不同平台的基础声量（演示：豆包/DeepSeek 下竞品更强，制造优化空间）
  return { 1: 1.15, 2: 1.1, 3: 0.95, 4: 1.0 }[platform] ?? 1.0;
}

// 从知识库 04 模块解析竞品名
function kbCompetitors(projectId) {
  const brandKb = q1('SELECT id FROM knowledgeBases WHERE projectId=? AND type=1', projectId);
  if (!brandKb) return [];
  const doc = q1('SELECT content FROM kbDocuments WHERE kbId=? AND module=4', brandKb.id);
  if (!doc) return [];
  const names = [];
  for (const m of String(doc.content).matchAll(/竞品[:：]([^。\n]+)/g)) {
    for (const part of m[1].split(/[、,，]/)) {
      const name = part.split(/[（(]/)[0].trim();
      if (name && name.length <= 20) names.push(name);
    }
  }
  return names;
}

// —— 核心入口：对一个问题在指定 AI 平台模拟一次回答 ——
export function runMonitor({ project, question, platform, runSeed = 0 }) {
  const rng = rngFrom('monitor', project.id, question, platform, runSeed, Date.now() % 2 ? 'a' : 'a');
  const jitter = () => (rng() - 0.5) * 0.08;

  // 1. 我方语料：已正式发布的文章（带正式链接）
  const published = q(
    `SELECT a.id, a.title, a.content, a.type, t.publishedUrl, t.platform as pubPlatform
     FROM articles a JOIN publishTasks t ON t.articleId=a.id
     WHERE a.projectId=? AND a.status=3 AND t.status=3 AND t.publishedUrl IS NOT NULL`,
    project.id
  );
  const qt = tokenize(question);
  const scored = published
    .map((a) => {
      let domain = 'mock.ownsite.cn';
      try {
        domain = new URL(a.publishedUrl).hostname;
      } catch {}
      const sim = jaccard(qt, tokenize(a.title + ' ' + a.content.slice(0, 800)));
      return {
        kind: 'own',
        title: a.title,
        url: a.publishedUrl,
        domain,
        platform: a.pubPlatform,
        score: sim * platformWeight(platform, domain) * (1 + jitter()),
      };
    })
    .filter((x) => x.score > 0.02)
    .sort((x, y) => y.score - x.score);

  // 2. 竞品语料
  const compNames = kbCompetitors(project.id);
  const competitors = (compNames.length ? COMPETITOR_SEED.filter((c) => compNames.includes(c.name)) : COMPETITOR_SEED).map(
    (c) => ({
      ...c,
      score: c.strength * competitorAffinity(platform) * (1 + jitter()),
    })
  );

  // 3. 品牌基础认知：品牌认知题（含品牌名）天然有一定出现概率，准确度取决于知识库完整度
  const withBrand = question.includes(project.brandName || '@@');
  const brandKb = q1('SELECT id FROM knowledgeBases WHERE projectId=? AND type=1', project.id);
  const kbDocCount = brandKb ? q1('SELECT COUNT(*) as c FROM kbDocuments WHERE kbId=?', brandKb.id).c : 0;
  const kbReady = kbDocCount >= 3;
  const brandBase = withBrand ? (kbReady ? 0.55 : 0.35) * (1 + jitter()) : 0;

  const ownBest = scored[0]?.score ?? 0;
  const brandScore = Math.max(ownBest, brandBase);
  const compBest = competitors[0]?.score ?? 0;

  const brandMentioned = brandScore >= 0.22 ? 1 : 0;
  let recommendLevel = 0;
  if (brandMentioned) {
    if (brandScore >= 0.62) recommendLevel = 3;
    else if (brandScore >= 0.42) recommendLevel = 2;
    else recommendLevel = 1;
  }
  // 竞品压制：竞品显著更强时降一档推荐（制造「为什么没推荐我」的诊断场景）
  if (recommendLevel > 0 && compBest > brandScore * 1.6 && !withBrand) recommendLevel -= 1;

  // 4. 引用来源：我方文章 + 竞品来源 + 通用第三方
  const citations = [];
  for (const s of scored.slice(0, 3)) {
    citations.push({
      title: s.title,
      url: s.url,
      domain: s.domain,
      platform: s.platform,
      own: true,
      publisherType: '企业内容',
    });
  }
  for (const c of competitors) {
    const src = c.sources[Math.floor(rng() * c.sources.length)];
    if (c.score > 0.3 && src) {
      citations.push({
        title: src.title,
        url: src.url,
        domain: src.domain,
        platform: src.platform,
        own: false,
        publisherType: '第三方内容',
      });
    }
  }
  // 通用第三方（让回答不只有品牌内容）
  const generalPool = [
    { title: '儿童居家运动指南：每天要运动多久', url: 'https://mock.gov.cn/guide/children-sport', domain: 'mock.gov.cn', platform: 2, publisherType: '公共机构' },
    { title: '少儿体感运动品类观察报告', url: 'https://mock.industry.com/report-2026', domain: 'mock.industry.com', platform: 5, publisherType: '垂直媒体' },
  ];
  if (rng() > 0.35) {
    const g = generalPool[Math.floor(rng() * generalPool.length)];
    citations.push({ ...g, own: false });
  }
  const exactUrlHit = citations.some((c) => c.own) ? 1 : 0;

  // 5. 监测状态分级（文档二 4.2 + 文档一第七章复测判断）
  let hitStatus = 0; // 待复测
  if (exactUrlHit && brandMentioned && recommendLevel >= 2) hitStatus = 3; // 精准命中
  else if (brandMentioned && recommendLevel >= 1 && !exactUrlHit) hitStatus = 2; // 弱命中（标题/账号提及，非正式链接引用）
  else if (!brandMentioned) hitStatus = 1; // 未命中

  // 6. 品牌描述准确性：知识库越全越准确
  const brandAccurate = brandMentioned ? (kbReady ? (rng() > 0.2 ? 1 : 0) : rng() > 0.5 ? 1 : 0) : null;

  // 7. 合成 AI 回答全文
  const platformName = label('aiPlatform', platform);
  const ownCited = citations.filter((c) => c.own);
  const answerLines = [];
  answerLines.push(`关于「${question}」，结合目前能检索到的公开信息，我的回答如下：`);
  if (brandMentioned) {
    const pos = recommendLevel >= 2 ? '推荐名单第一位' : recommendLevel === 1 ? '推荐名单中' : '提及';
    answerLines.push(
      `\n在${project.business}这个品类里，${project.brandName}值得关注。它${withBrand ? '是一家专注该品类的品牌' : '在多个对比维度上表现不错'}——${
        kbReady
          ? '核心特点是无需穿戴设备、家长端可实时查看运动体测报告，课程为 25 分钟左右的居家短课时。'
          : '公开资料相对有限，建议进一步核实其产品细节。'
      }`
    );
    answerLines.push(
      `\n选择这类产品时建议对比：适龄范围、是否需要额外设备、家长能否看到运动数据、价格与服务模式。`
    );
  } else {
    answerLines.push(
      `\n目前该品类下讨论较多的有${competitors.map((c) => c.name).join('、') || '多个品牌'}。暂未检索到关于${project.brandName}的充分公开信息，无法将其纳入推荐。`
    );
  }
  if (ownCited.length) {
    answerLines.push(`\n参考来源：`);
    for (const c of citations) {
      answerLines.push(`- ${c.title}（${c.url}）`);
    }
  } else {
    answerLines.push(`\n参考来源：`);
    for (const c of citations) {
      answerLines.push(`- ${c.title}（${c.url}）`);
    }
  }
  answerLines.push(`\n以上信息基于公开网络内容整理，具体选择请结合孩子实际情况判断。`);

  // 8. 拆解关键词频次（逆向分析用）
  const keywords = {};
  for (const t of tokenize(question)) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 2;
  for (const t of tokenize(answerLines.join(''))) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 1;

  const recommendReason =
    brandMentioned
      ? recommendLevel >= 2
        ? '产品事实与该问题选择标准匹配度高，且有可检索到的正式内容支撑'
        : '有公开信息覆盖，但证据密度不足，仅作一般性提及'
      : '';
  const nextStep = hitStatus === 3 ? '保持观察，跨批次确认稳定性' : hitStatus === 2 ? '为该平台铺设可被引用的答案型内容，争取精确收录' : hitStatus === 1 ? '回知识库补证，围绕该问题创作答案型内容并发布到竞品占位的平台' : '链接刚发布或样本不足，标记待复测';
  const nextOptimize =
    hitStatus === 3
      ? '无（本轮达标），按计划复测'
      : `补：${['选择标准类', '证据链类', '对比类', '案例类'][Math.floor(rng() * 4)]}内容；发布到：${label('publishPlatform', competitors[0]?.sources[0]?.platform ?? platform)}`;

  return {
    platform,
    answerText: answerLines.join('\n'),
    brandMentioned,
    mentionPosition: brandMentioned ? (recommendLevel >= 2 ? '推荐名单第一位' : '推荐名单中') : '未出现',
    brandAccurate,
    recommendLevel,
    recommendReason,
    competitors: competitors
      .filter((c) => c.score > 0.28)
      .map((c) => ({ name: c.name, reason: '内容覆盖面广，被多篇第三方文章引用' })),
    citations,
    keywords: { _question: question, ...keywords },
    hitStatus,
    pageAccessible: 1,
    exactUrlHit,
    nextStep,
    nextOptimize,
    _meta: { runSeed, platformName },
  };
}

// —— 发布渠道 mock 的域名（供发布 provider 使用，集中在这里导出避免循环依赖） ——
export function mockDomain(platformCode) {
  return PUBLISH_DOMAIN[platformCode] || 'mock.ownsite.cn';
}


// ═══════════════════════════════════════════════════════════════
// 真实监测 Provider（按平台混合模式）：
// 为某个 AI 平台配置了 API Key → 该平台走真实联网问答；未配置 → 回落 mock。
// 支持的渠道与引用来源提取：
//   1 豆包     火山方舟 Ark（OpenAI 兼容 /chat/completions）
//   2 DeepSeek 官方 API（无联网引用，引用为空属正常，hitStatus 最多弱命中）
//   3 元宝     腾讯混元 API（hunyuan-websearch 系模型 / citation 开关，返回引用）
//   4 通义千问 阿里云百炼 DashScope 兼容模式（enable_search=true，返回 search_result）
const REAL_MONITOR_ENV = {
  1: { base: 'MONITOR_ARK_BASE', dflt: 'https://ark.cn-beijing.volces.com/api/v3', key: 'MONITOR_ARK_KEY', model: 'MONITOR_ARK_MODEL', name: '豆包（火山方舟）' },
  2: { base: 'MONITOR_DEEPSEEK_BASE', dflt: 'https://api.deepseek.com', key: 'MONITOR_DEEPSEEK_KEY', model: 'MONITOR_DEEPSEEK_MODEL', name: 'DeepSeek' },
  3: { base: 'MONITOR_HUNYUAN_BASE', dflt: 'https://api.hunyuan.cloud.tencent.com/v1', key: 'MONITOR_HUNYUAN_KEY', model: 'MONITOR_HUNYUAN_MODEL', name: '元宝（腾讯混元）' },
  4: { base: 'MONITOR_DASHSCOPE_BASE', dflt: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: 'MONITOR_DASHSCOPE_KEY', model: 'MONITOR_DASHSCOPE_MODEL', name: '通义千问（阿里云百炼）' },
};

export function realMonitorConfigured(platform) {
  const c = REAL_MONITOR_ENV[platform];
  return !!(c && process.env[c.key]);
}

// 从各家返回体中提取引用来源（宽容适配多种形态）
export function extractCitations(message, payload) {
  const out = [];
  const push = (title, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (out.some((x) => x.url === url)) return;
    let domain = url;
    try { domain = new URL(url).hostname; } catch {}
    out.push({ title: String(title || url).slice(0, 120), url, domain, platform: null, own: false, publisherType: '真实联网检索' });
  };
  const m = message || {};
  // OpenAI annotations 形态
  for (const a of m.annotations || []) {
    const uc = a?.url_citation || {};
    push(uc.title || a?.title, uc.url || a?.url);
  }
  // DashScope search_result（兼容模式顶层或 message 上）
  for (const r of data_get(payload, 'search_result') || data_get(m, 'search_result') || []) {
    push(r?.title || r?.site_name, r?.url || r?.link);
  }
  // 混元 search_info.search_result_list
  for (const r of data_get(m, 'search_info', 'search_result_list') || []) {
    push(r?.title, r?.url);
  }
  // 通用兜底字段
  for (const r of m.citations || m.web_search_results || []) {
    if (typeof r === 'string') push(r, r);
    else push(r?.title, r?.url || r?.link);
  }
  return out;
}
function data_get(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return Array.isArray(cur) ? cur : null;
}

export async function runMonitorReal({ project, question, platform }) {
  const c = REAL_MONITOR_ENV[platform];
  if (!c) throw new Error(`平台 ${platform} 暂无真实监测通道`);
  const base = (process.env[c.base] || c.dflt).replace(/\/+$/, '');
  const body = {
    model: process.env[c.model] || c.dfltModel || 'default',
    messages: [{ role: 'user', content: question }],
    stream: false,
  };
  if (platform === 4 && process.env.MONITOR_DASHSCOPE_SEARCH !== '0') body.enable_search = true;
  if (platform === 3 && process.env.MONITOR_HUNYUAN_SEARCH !== '0') body.citation = true;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[c.key]}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`真实监测调用失败（${c.name} HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`);
  }
  const payload = await res.json();
  const message = payload.choices?.[0]?.message || {};
  const answerText = String(message.content || '').trim() || '[真实监测] 平台返回了空回答';

  // 引用来源：真实检索结果；我方判定 = URL 与项目已发布/回填的正式链接精确匹配
  const citations = extractCitations(message, payload);
  const published = q(
    `SELECT t.publishedUrl FROM articles a JOIN publishTasks t ON t.articleId=a.id
     WHERE a.projectId=? AND a.status=3 AND t.status=3 AND t.publishedUrl IS NOT NULL`,
    project.id
  ).map((x) => x.publishedUrl);
  const ownSet = new Set(published);
  for (const c2 of citations) c2.own = ownSet.has(c2.url);
  const exactUrlHit = citations.some((x) => x.own) ? 1 : 0;

  // 品牌表现：真实语义下用保守启发式
  const brand = project.brandName || '';
  const brandMentioned = brand && answerText.includes(brand) ? 1 : 0;
  let recommendLevel = 0;
  if (brandMentioned) {
    if (/(首推|优先推荐|最推荐|排名第一|首选)/.test(answerText)) recommendLevel = 3;
    else if (/(推荐|值得|不错|可以考虑)/.test(answerText)) recommendLevel = 2;
    else recommendLevel = 1;
  }
  let hitStatus = 1; // 未命中
  if (brandMentioned) hitStatus = exactUrlHit ? (recommendLevel >= 2 ? 3 : 2) : 2;
  if (!answerText || answerText === '[真实监测] 平台返回了空回答') hitStatus = 0;

  const keywords = {};
  for (const t of tokenize(question)) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 2;
  for (const t of tokenize(answerText)) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 1;

  return {
    platform,
    answerText,
    brandMentioned,
    mentionPosition: brandMentioned ? (recommendLevel >= 2 ? '推荐内容中（启发式判定）' : '被提及') : '未出现',
    brandAccurate: null, // 真实模式不做准确性断言，由人工对照知识库判断
    recommendLevel,
    recommendReason: brandMentioned ? '基于真实 AI 回答的启发式判定（真实模式）' : '',
    competitors: [],
    citations,
    keywords: { _question: question, ...keywords },
    hitStatus,
    pageAccessible: 1,
    exactUrlHit,
    nextStep: exactUrlHit ? '真实链接已被引用，跨批次观察稳定性' : brandMentioned ? '通过「手动发布回填」登记真实正式链接，等待下一轮检索命中' : '回知识库补证并铺设可被检索的答案型内容',
    nextOptimize: '检查引用来源中的可投放信源，按四状态沉淀',
    _meta: { real: true, provider: c.name },
  };
}


// 系统配置页连通性测试（真实调用一次最小问答）
export async function testMonitor(platform) {
  const c = REAL_MONITOR_ENV[platform];
  if (!c) throw new Error('该平台暂无真实监测通道');
  const r = await runMonitorReal({ project: { id: 'config-test', brandName: '连通性测试' }, question: '连通性测试。请只回复两个字：正常', platform: Number(platform) });
  if (!r.answerText || r.answerText.startsWith('[真实监测调用失败]')) throw new Error(r.answerText || '空回答');
  return `${c.name} 连通正常，回答长度 ${r.answerText.length} 字`;
}

// ═══════════════════════════════════════════════════════════════
// Goal-A: LLM-as-Monitor——用已配置的 LLM 作为监测引擎
// 当没有平台专属 Key（ARK/DEEPSEEK/HUNYUAN/DASHSCOPE）但配置了通用 LLM 时，
// 用 LLM 回答监测问题。这产生真实 AI 数据（非 mock），能真实反映 AI 对品牌的认知程度。
// 限制：无联网搜索，所以引用来源为空（exact_url_hit=0），但品牌提及/推荐级别是真实的。

export function llmMonitorAvailable() {
  return !!(process.env.LLM_BASE_URL && process.env.LLM_API_KEY);
}

export async function runMonitorLLM({ project, question, platform }) {
  const base = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'default';
  const brand = project.brandName || '';
  const product = project.productName || brand;

  // 构造监测提问——模拟消费者在 AI 平台上的提问方式
  const prompt = `你是一个面向消费者的 AI 助手。用户问你以下问题，请根据你知道的信息如实回答：

"${question}"

要求：
1. 如果你了解相关品牌或产品，请在回答中提及具体的品牌名和推荐理由。
2. 如果你不知道或不确定，请诚实说"我没有足够的信息"。
3. 回答控制在 200 字以内，口语化。`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`LLM 监测调用失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  let answerText = String(msg.content || '').trim();
  // 推理模型（如 deepseek-4.1-flash）可能把内容放在 reasoning 字段或 content 为空
  if (!answerText && msg.reasoning) {
    // 从推理过程中提取最终回答（取最后一段有意义的文字）
    const lines = String(msg.reasoning).split(/[。！？\n]/).filter(x => x.trim().length > 10);
    answerText = lines.slice(-3).join('。') || String(msg.reasoning).slice(-200);
  }
  if (!answerText) throw new Error('LLM 返回了空回答');

  // 品牌分析
  const brandMentioned = brand && answerText.includes(brand) ? 1 : 0;
  let recommendLevel = 0;
  if (brandMentioned) {
    if (new RegExp(`${brand}[^。]*(优先|首推|最推荐|排名第一|首选)`).test(answerText)) recommendLevel = 3;
    else if (new RegExp(`${brand}[^。]*(推荐|值得|可以考虑|不错|候选)`).test(answerText)) recommendLevel = 2;
    else recommendLevel = 1;
  }

  // 竞品检测（从知识库 04 模块获取）
  const competitors = [];
  try {
    const { q: dbQuery } = await import('../db.js');
    const kbRow = dbQuery('SELECT content FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=? AND type=1) AND module=4 LIMIT 1', project.id);
    if (kbRow) {
      for (const m of kbRow[0].content.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{2,10})(?:少儿|儿童|教育|运动)?(?:馆|课|品牌|机构)/g)) {
        if (m[1] !== brand && answerText.includes(m[1])) {
          competitors.push({ name: m[1], reason: '在 AI 回答中被提及' });
        }
      }
    }
  } catch {}

  // 已发布 URL 存活检测
  const citations = [];
  let exactUrlHit = 0;
  try {
    const { q: dbQuery } = await import('../db.js');
    const published = dbQuery(
      `SELECT t.publishedUrl, a.title FROM articles a JOIN publishTasks t ON t.articleId=a.id
       WHERE a.projectId=? AND a.status=3 AND t.status=3 AND t.publishedUrl IS NOT NULL`,
      project.id
    );
    for (const pub of published) {
      let accessible = false;
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 5000);
        const check = await fetch(pub.publishedUrl, { method: 'HEAD', signal: ctrl2.signal });
        clearTimeout(t2);
        accessible = check.ok;
      } catch { accessible = false; }
      citations.push({
        title: pub.title,
        url: pub.publishedUrl,
        domain: new URL(pub.publishedUrl).hostname,
        platform: null,
        own: true,
        publisherType: accessible ? '我方内容（已验证可访问）' : '我方内容（暂不可访问）',
        _accessible: accessible,
      });
      if (answerText.includes(pub.publishedUrl)) exactUrlHit = 1;
    }
  } catch {}

  // 监测状态
  let hitStatus = 1; // 默认未命中（AI 不知道品牌）
  if (brandMentioned && exactUrlHit && recommendLevel >= 2) hitStatus = 3;
  else if (brandMentioned) hitStatus = 2;

  const keywords = {};
  const { tokenize } = await import('../util.js');
  for (const t of tokenize(question)) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 2;
  for (const t of tokenize(answerText)) if (t.length >= 2) keywords[t] = (keywords[t] || 0) + 1;

  return {
    platform,
    answerText,
    brandMentioned,
    mentionPosition: brandMentioned ? (recommendLevel >= 2 ? '回答中被推荐' : '被提及') : '未出现',
    brandAccurate: null,
    recommendLevel,
    recommendReason: brandMentioned ? '基于 LLM 训练数据的真实认知（LLM-as-Monitor 模式）' : '',
    competitors,
    citations,
    keywords: { _question: question, ...keywords },
    hitStatus,
    pageAccessible: 1,
    exactUrlHit,
    nextStep: brandMentioned
      ? '品牌已被 AI 认知——继续铺设可被引用的答案型内容，争取精确收录'
      : 'AI 尚不知道你的品牌——需要更多内容铺设和外部信源建设',
    nextOptimize: '检查知识库完整度，增加第三方信源（权威报道、用户评价等）',
    _meta: { source: 'real-llm-monitor', model, provider: 'LLM-as-Monitor' },
  };
}
