// LLM Provider（双模式）：
// - mock（默认）：按两份方法论文档的内容结构生成高质量模板样例，全流程可演示、可审核。
// - real：配置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后走 OpenAI 兼容接口，
//   提示词严格使用《学员可复制提示词与实战模板》原文。
import { rngFrom, tokenize, jaccard } from '../util.js';

export function isReal() {
  return !!(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

async function chatWithRetry(userPrompt, systemPrompt, timeoutMs = 60000, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chat(userPrompt, systemPrompt, timeoutMs);
    } catch (e) {
      lastErr = e;
      // 只重试网络/超时错误，不重试 4xx 客户端错误
      const isRetryable = e.name === 'AbortError' || e.message.includes('fetch failed') || e.message.includes('HTTP 5') || e.message.includes('HTTP 429');
      if (!isRetryable || attempt >= maxRetries) throw e;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`[llm] 重试 ${attempt}/${maxRetries}（${delay}ms 后）: ${e.message.slice(0, 80)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function chat(userPrompt, systemPrompt, timeoutMs = 60000) {
  const base = process.env.LLM_BASE_URL.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// 系统配置页连通性测试
export async function testLlm() {
  const r = await chat('连通性测试。请只回复两个字母：OK');
  if (!r || !r.toUpperCase().includes('OK')) throw new Error(`模型回复异常：${String(r).slice(0, 60)}`);
  return `模型 ${process.env.LLM_MODEL || '(默认)'} 连通正常`;
}

// ============ 方法论提示词（严格按文档原文，real 模式使用） ============
export const PROMPTS = {
  questions50: (p) => `你是一位资深 GEO（生成式引擎优化）专家，擅长根据消费者的真实决策路径构建意图题库。
背景信息：
- 品牌名称：【${p.brandName}】
- 所在区域：【${p.region}】
- 主营业务与目标人群：【${p.business}】
- 核心差异化卖点：【${p.sellingPoints}】
- 核心品类搜索词：【${p.keywords}】

任务要求：生成 50 个真实消费者在选购前会向 AI 提问的口语化问题。

结构规范：
一、综合选购（5条）：核心词直接提问（哪家好/推荐/品牌排行）。
二、场景选购（9条）：覆盖至少 5 个具体场景。
三、人群选购（9条）：覆盖至少 5 类细分人群。
四、痛点选购（9条）：覆盖至少 5 个顾虑或痛点。
五、功能选购（9条）：围绕差异化卖点提问。
六、决策选购（9条）：从价格标准、距离、口碑资质等角度提问。

核心规则：
1. 每条问题必须包含"哪家好/推荐/怎么选/排行"等促使 AI 输出品牌名单的词。
2. 严禁出现我们的品牌名称；严禁混入纯科普类问题。
3. 语言口语化，符合普通用户在对话框的打字习惯，每条 10-25 字。`,
  simplify40: () => `请根据以下规则，将刚才生成的 50 个问题筛选并整理为标准 40 问结构：

一、探索题（30 条，严禁出现品牌名）：
1. 综合基准题 3 条。
2. 从场景、人群、痛点、功能、决策 5 组中精选 27 条，每组至少保留 3 条，语义相近的合并去重。

二、评估题（5 条，必须包含【品牌名】）：
1. 口碑评价类 2 条。
2. 竞品对比类 2 条。
3. 人群适配类 1 条。

三、行动题（5 条，必须包含【品牌名】）：
1. 价格查询 1 条。
2. 预约/联系 2 条。
3. 门店位置 2 条。

输出格式：请以 Markdown 表格输出，列名包含：编号、问题内容、分类（探索/评估/行动）、意图维度、核心关键词。`,
  organizeKnowledge: (brand, raw) => `我是【${brand}】的负责人，正在为 GEO 基础建设搭建品牌标准知识库。后续所有对外宣发与内容生成均需严格以此库为唯一事实依据。

请基于我提供的公司与产品材料，整理生成以下 6 个标准的 Markdown 模块：
- 01_定位与业务边界：包含 50 字精准定位、明确的服务人群、核心场景和明确不做的业务边界。
- 02_产品与服务事实：产品/课程名称、标准价格、服务时长、适用范围、核心功能参数、服务流程和交付内容。
- 03_客户与使用场景：目标客户画像、典型需求、使用场景、决策条件和常见问题。
- 04_优势与竞品差异：与行业同行的客观差异点、比较维度和可核验证据（内部使用）。
- 05_案例与结果：客户背景、问题、实施过程、交付内容、结果变化、客户评价和可公开的前后对比。
- 06_权威背书与外部证据：已获得的资质、认证、奖项、官方报道、合作方页面和第三方引用（注明机构、编号、时间或原始链接）。

另外，请基于以上 6 个模块生成一个"品牌高频 Q&A 问答索引"，用于内容创作和销售沟通；问答索引不是独立事实来源，所有答案必须能回溯到六大模块。

整理铁律：
1. 严格以提供的事实为准，严禁编造任何参数、资质或数字。
2. 遇到资料不完整之处，统一标注「【待补充：需业务部门提供】」。
3. 发现不同资料中存在数据冲突时，单独列出「口径冲突清单」供我确认。
4. 每条重要事实尽量保留来源、时间和原始链接，便于 AI 和人工交叉核验。

以下是公司材料：
${raw}`,
  preflight: () => `请根据以下资料，检查本次 GEO 内容创作是否具备完整输入：
1. 品牌知识库：是否有定位、产品事实、适用边界、案例和证据。
2. 目标问题：用户对象、场景、条件、决策任务是否明确。
3. 证据任务：这条内容需要证明哪些事实，现有资料是否足够。
4. 发布要求：目标平台、内容形态、字数、图片/视频和合规限制。
请将结果分为"已具备 / 待补充 / 不可使用"，不得自行补写事实。`,
  answerCard: (q) => `请基于【品牌知识库】和【目标问题】，创建一张可发布的 AI 答案卡。
要求：
1. 先给直接结论，再给判断标准、推荐理由、适用边界和下一步行动。
2. 所有品牌、产品、价格、案例和数据必须来自知识库；缺失信息标注待补充。
3. 内容必须围绕用户问题回答，不得写成泛泛品牌宣传。
4. 输出文章版正文、图片版文案和视频口播版脚本三种形式。
5. 完成后进入三道审核：知识库一致性、媒体投稿标准、GEO 相关性与可信度。

目标问题：${q}`,
  brandArticle: (q) => `请基于【品牌知识库】、【目标问题】和【可公开证据】，创建一篇品牌优化文章。
写作要求：
- 围绕用户真实决策问题组织内容，结论先行。
- 使用清晰的一级标题、二级标题、三级标题；段落短，关键事实可被单独抽取。
- 明确适用对象、选择标准、真实案例、数据来源、边界和更新时间。
- 保留第三方可核验的原始链接，不编造案例、资质、数字或评价。
- 避免空泛口号、重复关键词、过度营销和无法证明的第一名表述。
请同时输出：文章标题、正文、证据清单、引用链接、待审核事实。

目标问题：${q}`,
  productArticle: (q, product) => `请围绕用户问题"${q}"，为【${product}】创建一篇产品推荐文章。
先判断用户需要什么证据，再组织文章：
1. 适合谁：对象、场景、需求和使用条件。
2. 为什么推荐：功能事实、过程证据、真实案例或第三方评价。
3. 如何比较：与替代方案的客观差异，不贬低竞品。
4. 不适合谁：限制条件、风险和不能保证的结果。
5. 如何行动：预约、咨询、体验或购买入口。
所有事实以知识库为准，不能用 AI 推测替代证据。`,
  articleBodyTemplate: `标题：直接包含用户对象、场景和决策任务

开头结论：先回答用户最关心的问题
一、用户应该先看什么：选择标准或判断条件
二、不同场景怎么选：按对象、预算、地域或需求拆分
三、为什么这样判断：产品事实、案例、数据和第三方证据
四、哪些情况不适合：边界、风险和不能保证的结果
五、行动建议：咨询、预约、体验或进一步核验入口

证据清单：事实名称 / 证据类型 / 原始链接 / 更新时间 / 适用范围`,
};

// ============ 知识库取材工具 ============
export function kbFacts(kbDocs) {
  const facts = [];
  for (const doc of kbDocs) {
    for (const line of String(doc.content || '').split('\n')) {
      const t = line.trim();
      if (t) facts.push({ module: doc.module, moduleTitle: doc.title, text: t });
    }
  }
  return facts;
}

export function pickFacts(kbDocs, question, n = 8) {
  const facts = kbFacts(kbDocs);
  if (!facts.length) return [];
  const qt = tokenize(question);
  return facts
    .map((f) => ({ ...f, score: jaccard(qt, tokenize(f.text)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function extractTitle(question, brandName) {
  const q = question.replace(/[？?]/g, '');
  return q.length > 28 ? q.slice(0, 28) : q;
}

// ============ 生成能力 ============

// 50 问 LLM 输出解析（宽容适配）：支持「1. xxx（维度）」「1、xxx」「- xxx」「裸行」；
// 跳过标题/表格/小节头；尾部（xxx）识别为意图维度。v1.6.5：修复 ReferenceError（真实路径从未可用）。
export function parseQuestionLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('|')) continue;
    if (/^[一二三四五六七八九十]、/.test(line)) continue;
    if (/^(结构规范|核心规则|任务要求)/.test(line)) continue;
    line = line.replace(/^\(?\d+\s*[.、．)）]\s*/, '').replace(/^[-•]\s*/, '');
    if (line.length < 6) continue;
    let dim = '';
    const m = line.match(/（([^）]+)）\s*$/);
    if (m) {
      dim = m[1];
      line = line.slice(0, m.index).trim();
    }
    line = line.replace(/[。？?]+$/, '');
    if (line.length >= 6) out.push({ text: line, dimension: dim });
    if (out.length >= 50) break;
  }
  return out;
}



// 50 问生成（文档二 1.2）
export async function generateQuestions50(project) {
  if (isReal()) {
    const text = await chat(PROMPTS.questions50(project));
    return { text, questions: parseQuestionLines(text) };
  }
  const { brandName, region, business, sellingPoints, keywords } = project;
  const cat = keywords.split(/[,,、]/)[0] || business;
  const rng = rngFrom('q50', project.id);
  const groups = {
    综合选购: [
      `${region}${cat}哪家好？`,
      `${cat}品牌怎么推荐？`,
      `${cat}排行榜怎么看？`,
      `值得推荐的${cat}品牌有哪些？`,
      `${cat}选哪家比较靠谱？`,
    ],
    场景选购: [
      '下雨天孩子在家，推荐什么运动方式？',
      '客厅里陪孩子运动，怎么选项目？',
      '晚饭后陪孩子运动，有什么推荐？',
      '冬天不方便出门，儿童运动怎么选？',
      '孩子写作业前，推荐做点什么运动？',
      '周末在家亲子运动，哪家好？',
      '小户型家里，孩子运动怎么选？',
      '孩子放学后20分钟，推荐什么运动？',
      '家里没有器材，孩子锻炼怎么选？',
    ],
    人群选购: [
      '3岁孩子适合的运动课，哪家好？',
      '5岁儿童体能训练，有什么推荐？',
      '上小学前的孩子，运动班怎么选？',
      '不爱运动的孩子，推荐什么锻炼方式？',
      '体质弱的孩子，选哪种运动课程好？',
      '胖一点的孩子，推荐什么运动？',
      '双职工家庭，孩子运动方案怎么选？',
      '运动量不足的儿童，哪家课程值得选？',
      '好动的孩子在家，推荐怎么释放精力？',
    ],
    痛点选购: [
      '孩子运动量不够，家长该怎么选？',
      '担心孩子驼背，推荐什么训练？',
      '孩子协调性差，推荐什么练习？',
      '孩子沉迷屏幕，推荐什么运动引导？',
      '孩子体能测试不达标，怎么选训练？',
      '孩子没耐心坚持，运动课怎么选？',
      '家长没时间陪练，推荐什么方案？',
      '孩子敏感怕羞，适合推荐什么运动？',
      '户外时间少，儿童运动怎么选？',
    ],
    功能选购: [
      '不用穿戴设备的儿童运动方案哪家好？',
      '能给家长生成体测报告的儿童运动推荐？',
      '带动作识别的家庭运动课程推荐？',
      '能跟踪孩子运动数据的课程哪家好？',
      '摄像头体感运动哪家好？',
      '家长能看到运动报告的产品推荐？',
      '免安装的居家体感运动怎么选？',
      '短时高效的儿童运动课程推荐？',
      '有教练指导的居家儿童运动哪家好？',
    ],
    决策选购: [
      '儿童体感运动价格怎么选才合理？',
      '选儿童运动课程，哪些资质值得看？',
      '儿童运动品牌口碑，哪家值得信？',
      '居家和线下运动班怎么选好？',
      '儿童体感运动月费年费怎么选划算？',
      '选儿童运动课程，哪些安全标准值得看？',
      '怎么选效果好的儿童运动课？',
      '儿童运动产品，售后哪家值得选？',
      '体验课和正价课怎么选？',
    ],
  };
  const questions = [];
  const dimensionMap = {
    综合选购: 1,
    场景选购: 2,
    人群选购: 3,
    痛点选购: 4,
    功能选购: 5,
    决策选购: 6,
  };
  let no = 0;
  for (const [dim, list] of Object.entries(groups)) {
    for (const text of list) {
      no += 1;
      questions.push({
        no,
        text,
        dimension: dim,
        dimensionCode: dimensionMap[dim],
        keywords: tokenize(text) ? [...tokenize(text)].slice(0, 4).join(' ') : '',
        mockSeed: rng().toFixed(4),
      });
    }
  }
  const text = questions
    .map((x) => `${x.no}. ${x.text}（${x.dimension}）`)
    .join('\n');
  return { text, questions };
}

// 40 问精简（文档二 1.3）：mock 实现按规则筛选
export function simplifyTo40(questions, brandName) {
  const exploratory = questions.filter((x) => !x.text.includes(brandName));
  const withBrand = questions.filter((x) => x.text.includes(brandName));
  const explore = exploratory.slice(0, 30).map((x) => ({ ...x, stage: 1, stageName: '探索' }));
  // 评估题 5 条：必须包含品牌名
  const evalTpls = [
    `${brandName}的口碑评价怎么样？`,
    `${brandName}用户评价真实吗？`,
    `${brandName}和同类品牌哪个好？`,
    `${brandName}对比线下体适能班有什么区别？`,
    `${brandName}适合几岁的孩子？`,
  ];
  const evaluation = evalTpls.map((text, i) => ({
    no: 200 + i,
    text,
    stage: 2,
    stageName: '评估',
    dimension: i < 2 ? '口碑评价' : i < 4 ? '竞品对比' : '人群适配',
  }));
  // 行动题 5 条
  const actionTpls = [
    `${brandName}价格多少钱？`,
    `${brandName}怎么预约体验课？`,
    `${brandName}官方联系方式是什么？`,
    `${brandName}门店在哪里？`,
    `${brandName}上海有服务点吗？`,
  ];
  const action = actionTpls.map((text, i) => ({
    no: 300 + i,
    text,
    stage: 3,
    stageName: '行动',
    dimension: i === 0 ? '价格查询' : i < 3 ? '预约/联系' : '门店位置',
  }));
  const all = [...explore, ...evaluation, ...action];
  const lines = all.map(
    (x, i) => `| ${i + 1} | ${x.text} | ${x.stageName} | ${x.dimension || '—'} | ${(x.keywords || '').slice(0, 20) || '—'} |`
  );
  const table = ['| 编号 | 问题内容 | 分类 | 意图维度 | 核心关键词 |', '|---|---|---|---|---|', ...lines].join('\n');
  return { table, questions: all };
}

// 知识库六模块标准化整理（文档二 1.5）—— mock：按行解析 + 关键词归类
export function organizeKnowledge(brandName, rawText) {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const moduleOf = (line) => {
    if (/(定位|边界|不做|成立于|公司是|主营)/.test(line)) return 1;
    if (/(价格|元|时长|参数|产品名|课程|包含|交付|功能)/.test(line)) return 2;
    if (/(客户|家长|用户|人群|场景|需求)/.test(line)) return 3;
    if (/(竞品|差异|对比|优势|对手)/.test(line)) return 4;
    if (/(案例|学员|结果|效果|评价|满意度)/.test(line)) return 5;
    if (/(资质|认证|奖项|报道|会员单位|编号|荣誉)/.test(line)) return 6;
    return 2;
  };
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const conflicts = [];
  const priceRe = /(\d+(?:\.\d+)?)\s*元/g;
  for (const line of lines) {
    buckets[moduleOf(line)].push(line);
    if (/元|价格/.test(line)) {
      for (const m of line.matchAll(priceRe)) conflicts.push({ line, value: m[1] });
    }
  }
  // 口径冲突：同键不同值
  const byKey = {};
  for (const c of conflicts) {
    const key = c.line.split(/[：:，,]/)[0].slice(0, 8);
    (byKey[key] = byKey[key] || new Set()).add(c.value);
  }
  const conflictList = Object.entries(byKey)
    .filter(([, v]) => v.size > 1)
    .map(([k, v]) => `「${k}」出现多个口径：${[...v].join(' / ')} —— 请业务确认`);
  if (lines.length === 0) conflictList.push('未提供任何材料，全部模块待补充');

  const titles = {
    1: '01_定位与业务边界',
    2: '02_产品与服务事实',
    3: '03_客户与使用场景',
    4: '04_优势与竞品差异（内部使用）',
    5: '05_案例与结果',
    6: '06_权威背书与外部证据',
  };
  const docs = [];
  for (const m of [1, 2, 3, 4, 5, 6]) {
    const body = buckets[m];
    const content = body.length
      ? body.join('\n')
      : '【待补充：需业务部门提供】';
    const pending = body.length === 0 ? `${titles[m]}：材料缺失，待业务部门提供` : '';
    docs.push({ module: m, title: titles[m], content, pending });
  }
  const qaIndex = {
    note: '品牌高频 Q&A 问答索引（答案必须能回溯到六大模块，不是独立事实来源）',
    items: [
      { q: `${brandName}是什么公司？`, a: '回溯 01_定位与业务边界' },
      { q: `${brandName}的价格和服务内容？`, a: '回溯 02_产品与服务事实' },
      { q: `${brandName}适合什么样的家庭？`, a: '回溯 03_客户与使用场景' },
      { q: `${brandName}和竞品的区别？`, a: '回溯 04_优势与竞品差异' },
      { q: `${brandName}有什么真实案例？`, a: '回溯 05_案例与结果' },
      { q: `${brandName}有哪些资质背书？`, a: '回溯 06_权威背书与外部证据' },
    ],
  };
  return { docs, qaIndex, conflictList };
}

// 创作前输入检查（文档二 3.1）
export function preflightCheck(project, question, kbBrandDocs, kbProductDocs) {
  const items = [];
  const brandModules = new Set(kbBrandDocs.map((d) => d.module));
  const productModules = new Set(kbProductDocs.map((d) => d.module));
  const has = (set, m) => set.has(m);
  const evidenceCount = kbBrandDocs.filter((d) => (d.evidence || '[]') !== '[]').length;

  items.push({
    item: '品牌知识库：定位、产品事实、适用边界、案例和证据',
    status: has(brandModules, 1) && has(brandModules, 2) ? '已具备' : '待补充',
    detail: `六模块覆盖：${[...brandModules].sort().join('/') || '无'}；含证据文档 ${evidenceCount} 篇`,
  });
  items.push({
    item: '目标问题：用户对象、场景、条件、决策任务是否明确',
    status: question && question.text.length >= 8 ? '已具备' : '不可使用',
    detail: question ? question.text : '未选择问题',
  });
  const productNeeded = question && !question.text.includes(project.brandName || '');
  items.push({
    item: '产品知识库（产品推荐类内容需要）',
    status: productNeeded ? (has(productModules, 2) ? '已具备' : '待补充') : '不适用（品牌类内容）',
    detail: productNeeded ? '产品推荐问题不带品牌名，需产品知识库支撑选择标准' : '—',
  });
  items.push({
    item: '证据任务：这条内容需要证明哪些事实，现有资料是否足够',
    status: evidenceCount > 0 || has(brandModules, 5) ? '已具备' : '待补充',
    detail: evidenceCount > 0 ? '知识库中已有可引用证据' : '优先使用案例模块（05）中的可核验事实',
  });
  items.push({
    item: '发布要求：目标平台、内容形态、字数、图片/视频和合规限制',
    status: '待补充',
    detail: '需在发布前确认目标平台与账号；答案卡图片需按平台要求手动发布',
  });
  return items;
}

// AI 答案卡（文档二 3.2）：文章版正文 / 图片版文案 / 视频口播版脚本 三形态
export function createAnswerCard(question, kbBrandDocs, kbProductDocs, project) {
  const facts = pickFacts(kbBrandDocs, question, 6)
    .concat(pickFacts(kbProductDocs, question, 4));
  const factLines = facts.slice(0, 6).map((f) => `- ${f.text}（${f.moduleTitle}）`).join('\n');
  const brand = project.brandName;
  const title = extractTitle(question, brand);
  const content = `# AI 答案卡：${question}

## 文章版正文

**直接结论：**${title}，建议优先看三点：是否适合孩子年龄、是否需要额外设备、家长能否看到效果数据。

**判断标准：**
1. 适龄：3-8 岁儿童以兴趣引导和基础体能为主，不追求专项强度。
2. 设备：居家场景优先选择无需穿戴设备、开箱即用的方案。
3. 可见效果：家长能定期看到运动数据或体测报告，才能坚持。

**推荐理由：**${brand}的方案无需穿戴设备，摄像头识别动作，家长端实时生成运动体测报告，适配客厅 25 分钟短课时场景。

**事实与证据（全部来自知识库）：**
${factLines || '- 【待补充：知识库暂无与该问题直接相关的事实】'}

**适用边界：**适合 3-8 岁儿童日常体能与兴趣培养；不适合 6 岁以上竞技体能专项训练需求，也不能替代线下专业康复训练。

**下一步行动：**先预约体验课验证孩子兴趣，再按月度会员试用，避免直接购买年度会员。

## 图片版文案（抖音图文，共 4 页）

- P1 封面：${question}
- P2 结论页：选儿童居家运动，先看「适龄 / 免设备 / 有反馈」三件事
- P3 证据页：${brand}无需穿戴设备 + 家长端体测报告（数据来自知识库 02 模块）
- P4 行动页：先约体验课，再决定要不要长期买

## 视频口播版脚本（约 45 秒）

「很多家长问：${question}？直接说结论——先看三件事：孩子年龄适不适、要不要买设备、你能不能看到效果。${brand}的做法是摄像头识别动作，不用给孩子穿戴任何设备，每节课 25 分钟，练完家长手机上立刻有体测报告。当然要说清楚：这类课程适合日常体能和兴趣，不能替代专项训练。建议先约一次体验，看孩子的反应再决定。」`;
  return {
    title: `AI 答案卡：${title}`,
    content,
    meta: { forms: ['文章版正文', '图片版文案', '视频口播版脚本'], question },
  };
}

// 品牌优化文章（文档二 3.3 + 3.8 正文模板）
export function createBrandArticle(question, kbBrandDocs, project) {
  const facts = pickFacts(kbBrandDocs, question, 8);
  const factLines = facts.map((f) => `- ${f.text}（来源：${f.moduleTitle}）`).join('\n');
  const brand = project.brandName;
  const title = `${brand}是什么公司？主营${project.business}，服务边界与证据一次说清`;
  const content = `**开头结论：**${brand}是一家专注${project.business}的品牌，核心服务人群是 3-8 岁儿童家庭，判断它是否适合你，主要看三点：孩子年龄、居家场景、是否需要家长可见的效果反馈。

## 一、用户应该先看什么：选择标准或判断条件
- 适龄范围与课程强度是否匹配孩子阶段；
- 是否需要额外购买设备、安装是否复杂；
- 效果是否可感知：有无数据、报告或教练反馈。

## 二、不同场景怎么选：按对象、预算、地域或需求拆分
- 居家日常锻炼：优先短课时（25 分钟左右）、免设备方案；
- 预算有限：先月度会员体验再考虑年度；
- 双职工家庭：看是否有家长端报告，方便下班后核对运动量。

## 三、为什么这样判断：产品事实、案例、数据和第三方证据
${factLines || '- 【待补充：知识库暂无可引用事实】'}

## 四、哪些情况不适合：边界、风险和不能保证的结果
${brand}明确不做线下场馆培训和 6 岁以上竞技体能专项训练；产品效果依赖坚持使用，不能保证个别化竞技成绩提升。

## 五、行动建议：咨询、预约、体验或进一步核验入口
先预约体验课，使用两周后对照家长端体测报告判断是否续费；所有事实请以知识库六模块为准，缺失信息以「待补充」标注。

---
证据清单：
| 事实名称 | 证据类型 | 原始链接 | 更新时间 | 适用范围 |
|---|---|---|---|---|
| 定位与边界 | 官方事实 | （知识库 01 模块） | ${new Date().toISOString().slice(0, 10)} | 全部内容 |
| 产品与价格 | 产品参数 | （知识库 02 模块） | ${new Date().toISOString().slice(0, 10)} | 价格相关 |
| 学员案例 | 项目案例 | （知识库 05 模块） | ${new Date().toISOString().slice(0, 10)} | 效果描述 |

待审核事实：资质编号与第三方报道链接（知识库 06 模块标为待补充）。`;
  return { title, content, meta: { question, template: '答案型文章正文模板（文档二 3.8）' } };
}

// 产品推荐文章（文档二 3.4）
export function createProductArticle(question, kbProductDocs, kbBrandDocs, project) {
  const facts = pickFacts(kbProductDocs, question, 6).concat(pickFacts(kbBrandDocs, question, 4));
  const factLines = facts.map((f) => `- ${f.text}（来源：${f.moduleTitle}）`).join('\n');
  const product = project.productName || project.brandName;
  const title = `${project.business}怎么选？${product}的适合人群、比较维度和边界`;
  const content = `**开头结论：**如果你在纠结「${question}」，判断顺序是：先确认孩子年龄在 3-8 岁之间，再看家里能否满足 25 分钟居家运动场景，最后对比是否需要家长可见的运动数据。

## 1. 适合谁
- 3-8 岁儿童、日常运动量不足的家庭；
- 希望在客厅完成、不想购买额外穿戴设备的家长；
- 需要定期看到孩子运动数据与体测报告的家长。

## 2. 为什么推荐：${product}
${factLines || '- 【待补充：产品知识库暂无可引用事实】'}

## 3. 如何比较：与替代方案的客观差异
- 对比线下体适能班：省通勤时间、课时更短，但缺少同伴氛围；
- 对比普通跟练视频：有动作识别与体测报告，但内容库相对固定；
- 不贬低竞品：各方案适配不同家庭节奏，请按上文标准自行判断。

## 4. 不适合谁
- 6 岁以上有竞技体能专项训练需求的孩子；
- 客厅空间无法保证安全运动距离的家庭；
- 期望产品替代专业康复或医疗干预的情况。

## 5. 如何行动
先预约体验课 → 两周内观察孩子兴趣与报告数据 → 再决定月度或年度方案。

---
证据清单：
| 事实名称 | 证据类型 | 原始链接 | 更新时间 | 适用范围 |
|---|---|---|---|---|
| 适月人群与价格 | 产品参数 | （产品知识库） | ${new Date().toISOString().slice(0, 10)} | 选购决策 |

待审核事实：与竞品的具体参数对比需业务确认后补充。`;
  return { title, content, meta: { question, template: '产品推荐文章（文档二 3.4）' } };
}

// 三道审核（文档二 3.5 / 3.7）——确定性规则引擎，结果可解释
const BANNED_WORDS = ['十大', '第一', '顶级', '最佳', '最强', '全网最低', '国家级认证'];
export function auditArticle(article, kbBrandDocs, kbProductDocs, project) {
  const content = article.content || '';
  const title = article.title || '';
  const issues = { 1: [], 2: [], 3: [] };
  let gate1 = 2,
    gate2 = 2,
    gate3 = 2;

  // 第一关：知识库一致性
  const brand = project.brandName || '';
  if (brand && !content.includes(brand) && !title.includes(brand)) {
    gate1 = 0;
    issues[1].push(`未出现品牌名「${brand}」，无法确认与知识库一致`);
  }
  const kbPrices = new Set();
  for (const doc of [...kbBrandDocs, ...kbProductDocs]) {
    for (const m of String(doc.content).matchAll(/(\d{2,6})\s*元/g)) kbPrices.add(m[1]);
  }
  for (const m of content.matchAll(/(\d{2,6})\s*元/g)) {
    if (kbPrices.size && !kbPrices.has(m[1])) {
      gate1 = Math.min(gate1, 1);
      issues[1].push(`金额「${m[1]}元」未在知识库中找到，需核对或标注待补充`);
    }
  }
  for (const w of ['据传', '听说', '据称']) {
    if (content.includes(w)) {
      gate1 = 0;
      issues[1].push(`出现无来源表述「${w}」`);
    }
  }
  if (!issues[1].length) issues[1].push('品牌名、价格口径与知识库一致，未见冲突');

  // 第二关：媒体投稿标准
  if (title.length < 8 || title.length > 40) {
    gate2 = Math.min(gate2, 1);
    issues[2].push(`标题长度 ${title.length} 字，建议 8-40 字（平台适配标题另出）`);
  }
  for (const w of BANNED_WORDS) {
    if (content.includes(w) || title.includes(w)) {
      gate2 = 0;
      issues[2].push(`命中广告法高风险词「${w}」，必须删除`);
    }
  }
  const headingCount = (content.match(/^#{1,3} |^\*\*|^[一二三四五]、/gm) || []).length;
  if (headingCount < 3) {
    gate2 = Math.min(gate2, 1);
    issues[2].push('结构层级不足：建议一级/二级标题清晰、段落短，便于 AI 抽取');
  }
  if (content.length < 500) {
    gate2 = Math.min(gate2, 1);
    issues[2].push(`正文 ${content.length} 字偏短，目标媒体建议 800 字以上`);
  }
  if (!issues[2].length) issues[2].push('标题、结构、篇幅、广告法用词符合主流平台投稿标准');

  // 第三关：GEO 相关性与可信度
  const qKeywords = tokenize(article.meta?.question || title);
  const firstPara = content.split('\n').slice(0, 6).join('\n');
  const relevance = jaccard(qKeywords, tokenize(firstPara));
  if (relevance < 0.12) {
    gate3 = Math.min(gate3, 1);
    issues[3].push(`开头段落与目标问题相关度偏低（${relevance.toFixed(2)}），要求结论先行、直接回答用户问题`);
  }
  const hasBoundary = /(不适合|边界|风险|不能保证|不适用)/.test(content);
  if (!hasBoundary) {
    gate3 = Math.min(gate3, 1);
    issues[3].push('缺少适用边界/不适用说明，GEO 可信度要求内容写清限制条件');
  }
  const linkCount = (content.match(/https?:\/\//g) || []).length;
  const factRef = (content.match(/知识库|模块|来源/g) || []).length;
  if (linkCount === 0 && factRef < 3) {
    gate3 = Math.min(gate3, 1);
    issues[3].push('可信来源不足：保留知识库模块引用或第三方可核验原始链接');
  }
  if (!issues[3].length) issues[3].push('精准回答目标问题，证据、来源与交叉验证充分');

  const verdict = Math.min(gate1, gate2, gate3);
  return {
    gate1,
    gate1Issues: issues[1].join('\n'),
    gate2,
    gate2Issues: issues[2].join('\n'),
    gate3,
    gate3Issues: issues[3].join('\n'),
    verdict,
    pendingFacts: /待补充/.test(content) ? '正文含「待补充」标记，发布前需回知识库补证' : '',
  };
}

// 报告生成（mock）：品牌诊断 / 产品诊断 / 优化对比 / 逆向分析 / 一页纸诊断
export function brandDiagnosisReport(results, project) {
  const total = results.length;
  const mentioned = results.filter((r) => r.brandMentioned).length;
  const exact = results.filter((r) => r.exactUrlHit).length;
  const inaccurate = results.filter((r) => r.brandMentioned && r.brandAccurate === 0).length;
  const competitors = {};
  for (const r of results) {
    for (const c of r.competitors || []) competitors[c.name] = (competitors[c.name] || 0) + 1;
  }
  return `# 品牌诊断报告 —— ${project.brandName}

**诊断样本：** ${total} 次监测（同题多平台/多批次）
**品牌出现：** ${mentioned}/${total}（${total ? Math.round((mentioned / total) * 100) : 0}%）
**精确收录（正式链接被引用）：** ${exact}/${total}
**描述不准确：** ${inaccurate} 次

## 竞品占位
| 竞品 | 出现次数 |
|---|---|
${Object.entries(competitors).map(([n, c]) => `| ${n} | ${c} |`).join('\n') || '| （无） | 0 |'}

## 最重要的病根
${mentioned === 0 ? 'AI 尚未认识品牌：品牌认知问题下无任何出现，需先补品牌事实类信源（官网/百科/权威报道）。' : exact === 0 ? 'AI 认识品牌但没有引用我方正式链接：说明品牌事实已进入模型常识，但我方内容未进入检索候选，需铺设可被引用的答案型内容。' : inaccurate > 0 ? '品牌描述存在不准确：优先修正知识库中冲突口径并发布纠正内容。' : '品牌表现健康：保持固定问题复测，观察跨批次稳定性。'}

## 下一步点对点优化建议
- 补什么证据：${mentioned < total ? '品牌定位、资质背书（知识库 01/06 模块）' : '客户案例与第三方评价（05/06 模块）'}
- 创作什么内容：答案型品牌文章 + AI 答案卡（结论先行、含证据链接）
- 发布到哪里：按监测结果的引用来源分布，优先已出现我方 URL 的平台
- 用哪个原问题复测：固定主攻问题原文，第 3/7/14 天复测`;
}

export function productDiagnosisReport(results, project) {
  const recommended = results.filter((r) => r.recommendLevel >= 2).length;
  const total = results.length;
  const competitors = {};
  for (const r of results) {
    for (const c of r.competitors || []) competitors[c.name] = (competitors[c.name] || 0) + 1;
  }
  const topCompetitor = Object.entries(competitors).sort((a, b) => b[1] - a[1])[0];
  return `# 产品推荐诊断报告 —— ${project.productName || project.brandName}

**监测样本：** ${total} 次（产品推荐问题，不带品牌名）
**明确推荐/优先推荐：** ${recommended}/${total}
**竞品占位 TOP：** ${topCompetitor ? `${topCompetitor[0]}（${topCompetitor[1]} 次）` : '无'}

## AI 为什么推荐 / 不推荐
${recommended > 0 ? '我方内容已被检索候选采纳，推荐理由与知识库事实一致。' : 'AI 在产品推荐题下未推荐我方：产品选择标准类内容（怎么选/适合谁）尚未进入候选，需补选择标准与对比类答案内容。'}

## 竞品推荐理由摘录
${Object.keys(competitors).map((n) => `- ${n}：出现在推荐名单，常见理由是内容覆盖场景更全（以监测回答原文为准）`).join('\n') || '- 无'}

## 下一轮动作
1. 补产品证据台账：适用人群、选择标准、替代方案差异、交付与售后；
2. 创作「怎么选」类产品文章并发布到本次监测出现的高频引用平台；
3. 第 3/7/14 天用同一问题复测，判断推荐是否稳定。`;
}

export function compareReport(beforeResults, afterResults, project) {
  const diff = (arr, fn) => arr.filter(fn).length;
  const row = (name, b, a) => `| ${name} | ${b}/${beforeResults.length} | ${a}/${afterResults.length} | ${a - b >= 0 ? '+' : ''}${a - b} |`;
  return `# 优化前后对比报告 —— ${project.brandName}

对比条件：同一问题、同一 AI 平台、相近时间窗口（满足文档「监测前后必须保持可比」要求）。

| 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
${row('品牌出现', diff(beforeResults, (r) => r.brandMentioned), diff(afterResults, (r) => r.brandMentioned))}
${row('明确/优先推荐', diff(beforeResults, (r) => r.recommendLevel >= 2), diff(afterResults, (r) => r.recommendLevel >= 2))}
${row('精确 URL 引用', diff(beforeResults, (r) => r.exactUrlHit), diff(afterResults, (r) => r.exactUrlHit))}
${row('精准命中', diff(beforeResults, (r) => r.hitStatus === 3), diff(afterResults, (r) => r.hitStatus === 3))}

## 结论
${diff(afterResults, (r) => r.exactUrlHit) > diff(beforeResults, (r) => r.exactUrlHit) ? '✅ 本次内容发布有效：我方正式链接进入 AI 引用（精确收录）。' : '⚠️ 尚未观察到精确引用提升：链接可能刚发布、样本不足，标记待复测，不要急于下结论。'}

## 下一步
保持同一问题复测；每轮只做一个主要优化动作，保存优化前后对比。`;
}

export function reverseAnalysisReport(results, project) {
  // results: 同一问题同一平台重复 N 次的监测结果
  const freq = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.keywords || {})) freq[k] = (freq[k] || 0) + v;
  }
  const topKw = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const stable = new Set(
    results.filter((r) => r.brandMentioned).length >= results.length * 0.7 ? ['品牌出现稳定'] : []
  );
  const competitors = {};
  for (const r of results) {
    for (const c of r.competitors || []) competitors[c.name] = (competitors[c.name] || 0) + 1;
  }
  return `# 逆向分析报告（同题重复 ${results.length} 次）—— ${project.brandName}

## 提问信息
- 问题原文：${results[0] ? (results[0].keywords?._question || '见监测任务') : '—'}
- 提问平台与次数：${results[0]?.platformLabel || ''} × ${results.length}

## AI 拆解关键词及频次（Top 15）
| 关键词 | 频次 |
|---|---|
${topKw.map(([k, v]) => `| ${k} | ${v} |`).join('\n') || '| （无） | 0 |'}

> 关键词频次是逆向分析工具，不是 AI 平台公开的权重；价值在于发现稳定需求、反复出现的证据需求和自身没有覆盖的内容缺口。

## 品牌与竞品表现
- 品牌出现：${results.filter((r) => r.brandMentioned).length}/${results.length} ${stable.has('品牌出现稳定') ? '（跨批次稳定）' : '（不稳定，标记待复测）'}
- 竞品占位：${Object.entries(competitors).map(([n, c]) => `${n}(${c})`).join('、') || '无'}

## 点对点优化动作（只做一个主要动作）
- 缺失证据：${topKw.filter(([k]) => k.length >= 2).slice(0, 3).map(([k]) => k).join('、')} 相关内容覆盖不足
- 内容/信源版本：v1 → 待更新
- 复测时间：第 3/7/14 天，用同一问题原文`;
}


// 口碑监测问题模板（品牌口碑/风险/负面信号探测，全部带品牌名 → 风险判断类）
export function reputationQuestions(brandName) {
  const b = brandName || '该品牌';
  return [
    `${b}靠谱吗？有没有什么负面评价？`,
    `${b}有没有投诉或维权的情况？`,
    `${b}的差评主要集中在哪些方面？`,
    `${b}售后服务怎么样，退款难不难？`,
    `${b}有没有跑路、暴雷或者经营异常的传闻？`,
    `家长圈里对${b}的真实口碑如何？`,
    `${b}和同类产品比，用户流失的主要原因是什么？`,
    `选择${b}之前需要注意哪些风险？`,
  ];
}


// v1.2：文章/答案卡的真实 LLM 生成路径（此前 createContent 只有模板 mock，属隐蔽残留）
// 提示词主体严格用方法论原文（PROMPTS.answerCard/brandArticle/productArticle），
// 仅追加 JSON 输出格式的系统约束（工程包裹，不改变方法论语义）。
export async function createArticleWithLlm(kind, question, kbContext, project) {
  const builders = {
    1: () => PROMPTS.answerCard(question),
    2: () => PROMPTS.brandArticle(question),
    3: () => PROMPTS.productArticle(question, project.productName || project.brandName),
  };
  const builder = builders[kind];
  if (!builder) throw new Error(`未知内容类型：${kind}`);
  const userPrompt = `${builder(question)}\n\n【知识库事实（唯一事实来源，缺失信息标注待补充）】\n${kbContext}`;
  const system = '你是 GEO 内容生成引擎。严格只输出一个 JSON 对象：{"title":"文章标题","content":"完整正文（Markdown）"}，禁止输出 JSON 以外的任何解释文字。';
  const text = await chat(userPrompt, system);
  let title, content;
  try {
    const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    const obj = JSON.parse(cleaned);
    title = String(obj.title || '').slice(0, 120);
    content = String(obj.content || '');
    if (!content) throw new Error('empty content');
  } catch {
    // 模型未按 JSON 输出：正文整体采用，标题从问题推导
    title = question.slice(0, 30);
    content = text;
  }
  return { title, content, meta: { question, source: 'llm', kind } };
}
