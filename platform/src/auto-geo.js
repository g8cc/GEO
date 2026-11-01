// 一键 GEO：从项目信息自动跑通完整 GEO 流程
// 用户粘贴项目文档（README/docs/代码说明等），AI 提取产品信息 → 自动创建全链路
import { q, q1, run, insert, ensureKbs, ensurePrimaryOrg, primaryOrgId } from './db.js';
import { id, nowIso } from './util.js';
import * as llm from './providers/llm.js';

const EXTRACT_PROMPT = `你是一个 GEO（生成式引擎优化）专家。分析以下项目文档，提取产品信息用于 GEO 优化。

严格输出一个 JSON 对象（不要输出其他任何文字）：
{
  "productName": "产品名称",
  "oneLine": "一句话定位（50字内）",
  "brandName": "品牌名",
  "business": "主营业务与目标人群（一句话）",
  "sellingPoints": "核心差异化卖点（用 / 分隔多个）",
  "keywords": "核心搜索关键词（逗号分隔，3-5个）",
  "region": "服务区域",
  "features": ["核心功能1", "核心功能2", "..."],
  "differentiators": ["差异化优势1", "..."],
  "useCases": ["使用场景1", "..."],
  "techStack": "技术架构简述",
  "pricing": "价格/计费模式（如有）",
  "competitors": ["竞品1", "..."],
  "boundaries": "明确不做的事",
  "evidence": "案例/数据/背书（如有）"
}

项目文档：
`;

export async function autoGeo(userId, userEmail, rawContent, options = {}) {
  const region = options?.region || '全国';

  // 1. AI 提取产品信息
  const llm = await import('./providers/llm.js');
  if (!llm.isReal()) throw new Error('请先在「系统配置 → 服务集成」配置 LLM API Key，才能使用一键 GEO');

  const prompt = EXTRACT_PROMPT + rawContent.slice(0, 8000);
  const raw = await llm.chat(prompt, null, 300000); // 3 分钟
  let extracted;
  try {
    const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    extracted = JSON.parse(cleaned);
  } catch {
    // LLM 未按 JSON 输出：降级用正则提取关键字段
    extracted = {
      productName: raw.match(/productName["\s:]+([^",\n}]+)/)?.[1] || '未命名产品',
      brandName: raw.match(/brandName["\s:]+([^",\n}]+)/)?.[1] || '未命名品牌',
      oneLine: raw.slice(0, 100),
      business: raw.slice(0, 200),
      sellingPoints: raw.slice(0, 300),
      keywords: 'AI, SaaS',
      region,
      features: [],
      differentiators: [],
      useCases: [],
      techStack: '',
      pricing: '',
      competitors: [],
      boundaries: '',
      evidence: '',
    };
  }

  // 0. LLM 提取已经在上面完成（extracted 变量）——如果到这里说明提取成功了
  // 不再先创建空壳再填数据

  // 2. 自动创建公司（挂到用户的主组织）
  const orgId = primaryOrgId(userId, userEmail);
  const compId = id();
  insert('companies', {
    id: compId, ownerUserId: userId, orgId,
    name: extracted.productName || extracted.brandName || '自动导入项目',
    industry: '自动导入', intro: extracted.oneLine || '', createdAt: nowIso(),
  });

  // 3. 自动创建 GEO 项目
  const pid = id();
  insert('projects', {
    id: pid, companyId: compId,
    name: `${extracted.productName || extracted.brandName}-GEO`,
    brandName: extracted.brandName || '', productName: extracted.productName || '',
    region: extracted.region || region,
    business: extracted.business || extracted.oneLine || '',
    sellingPoints: extracted.sellingPoints || '',
    keywords: extracted.keywords || '',
    defaultPlatforms: JSON.stringify([1, 2, 3, 4]),
    createdAt: nowIso(),
  });
  ensureKbs(pid);

  // 4. 知识库六模块整理（真实 AI）
  const svc = await import('./services.js');
  await svc.organizeKnowledge(pid, { type: 1, raw: rawContent });

  // 5. 生成 50 问 + 40 问
  await svc.generateQuestions(pid, '50');
  await new Promise(r => setTimeout(r, 1000));
  await svc.generateQuestions(pid, '40');

  // 6. 创作品牌文章（真实 AI，选一个评估类问题）
  const q = q1("SELECT id, text FROM questions WHERE projectId=? AND text LIKE ? LIMIT 1", pid, `%${extracted.brandName || extracted.productName}%`)
    || q1('SELECT id, text FROM questions WHERE projectId=? LIMIT 1', pid);
  let article = null;
  if (q) {
    article = await svc.createContent(pid, { questionId: q.id, type: 2, aiDeclaration: 1 });
    // 自动审核
    svc.auditArticle(article.id, '一键 GEO 自动审核');
  }

  // 7. 上榜监测（真实 LLM）
  const allQs = q('SELECT id FROM questions WHERE projectId=? AND withBrand=1 LIMIT 2', pid);
  let monitor = null;
  if (allQs.length) {
    monitor = await svc.createMonitorTask(pid, {
      questionIds: allQs.map(x => x.id),
      platforms: [1], mode: 1, runNow: true,
    });
  }

  return {
    projectId: pid,
    projectUrl: `/projects/${pid}`,
    extracted,
    knowledgeDocs: q1('SELECT COUNT(*) as n FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)', pid)?.n || 0,
    questionCount: q1('SELECT COUNT(*) as n FROM questions WHERE projectId=?', pid)?.n || 0,
    articleId: article?.id || null,
    articleTitle: article?.title || '',
    articleAuditVerdict: article ? q1('SELECT verdict FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC LIMIT 1', article.id)?.verdict : null,
    monitorTaskId: monitor?.task?.id || null,
    nextSteps: [
      '查看知识库六模块，补充缺失的「待补充」项',
      '查看生成的 50 问，标 P0 主攻问题',
      '查看品牌文章，人工微调后执行三道审核',
      '创建发布任务，发布到知乎/头条后回填 URL',
      '创建上榜监测，看 AI 是否开始推荐你的品牌',
    ],
  };
}


