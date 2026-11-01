// 业务服务层：Web UI 与 Open API 共用的核心动作。
// 所有写操作在此实现；Open API 的 plan/dryRun 摘要也由这里生成。
import { q, q1, run, insert, ensureKbs, audit, UPLOADS_DIR, primaryOrgId, memberRole, usageIncrement } from './db.js';
import { id, nowIso, addDays, parseJsonSafe, sha256, shortId, safeUploadExt } from './util.js';
import * as llm from './providers/llm.js';
import { runMonitor, runMonitorReal, realMonitorConfigured, llmMonitorAvailable, runMonitorLLM } from './providers/monitor.js';
import * as imageProvider from './providers/image.js';
import { put as storagePut, storageConfigured } from './providers/storage.js';
import {
  createMockPublish,
  settle,
  generateCoverSvg,
} from './providers/publish.js';
import {
  QUESTION_CATEGORY,
  QUESTION_STAGE,
  ARTICLE_TYPE,
  label,
} from './enums.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class BizError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getProject(projectId) {
  const p = q1('SELECT * FROM projects WHERE id=?', projectId);
  if (!p) throw new BizError('NOT_FOUND', `GEO 项目不存在：${projectId}`);
  return p;
}

// Web 侧安全读取：用户必须是项目所属组织的成员（v1.4 组织模型）
export function getProjectSafe(userId, projectId) {
  return q1(
    `SELECT p.*, c.orgId FROM projects p JOIN companies c ON p.companyId=c.id
     JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=? WHERE p.id=?`,
    userId,
    projectId
  ) || null;
}
export function getKb(projectId, type) {
  ensureKbs(projectId);
  return q1('SELECT * FROM knowledgeBases WHERE projectId=? AND type=?', projectId, type);
}
function getKbDocs(kbId) {
  return q('SELECT * FROM kbDocuments WHERE kbId=? ORDER BY module, updatedAt', kbId);
}

// ============ 公司与项目 ============
export function createCompany(userId, email = '', { name, industry, intro } = {}) {
  if (!name) throw new BizError('VALIDATION_ERROR', '公司名称必填');
  const orgId = primaryOrgId(userId, email);
  const row = {
    id: id(),
    ownerUserId: userId,
    orgId,
    name,
    industry: industry || '',
    intro: intro || '',
    createdAt: nowIso(),
  };
  insert('companies', row);
  return row;
}

export function createProject(userId, input) {
  const { companyId, name } = input;
  const company = q1(
    `SELECT c.* FROM companies c JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=?
     WHERE c.id=? AND om.role IN ('owner','manager','operator')`,
    userId,
    companyId
  );
  if (!company) throw new BizError('VALIDATION_ERROR', `公司不存在、无权限或不属于当前用户：${companyId}`);
  if (!name) throw new BizError('VALIDATION_ERROR', '项目名称必填');
  const row = {
    id: id(),
    companyId,
    name,
    brandName: input.brandName || name,
    productName: input.productName || '',
    region: input.region || '',
    business: input.business || '',
    sellingPoints: input.sellingPoints || '',
    keywords: input.keywords || '',
    defaultPlatforms: JSON.stringify(input.defaultPlatforms || [1, 2, 3, 4]),
    createdAt: nowIso(),
  };
  insert('projects', row);
  ensureKbs(row.id);
  return row;
}

export function updateProject(userId, input) {
  const p = getProject(input.projectId);
  const role = memberRole(q1('SELECT orgId FROM companies WHERE id=?', p.companyId).orgId, userId);
  if (!role || role === 'viewer') throw new BizError('FORBIDDEN', '无权修改该项目（只读成员）');
  const fields = ['name', 'brandName', 'productName', 'region', 'business', 'sellingPoints', 'keywords'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (input[f] !== undefined) {
      sets.push(`${f}=?`);
      vals.push(input[f]);
    }
  }
  if (sets.length) {
    run(`UPDATE projects SET ${sets.join(',')} WHERE id=?`, ...vals, p.id);
  }
  return q1('SELECT * FROM projects WHERE id=?', p.id);
}

export function listProjects(userId, authorizedIds = null) {
  let rows = q(
    `SELECT p.*, c.name as companyName FROM projects p JOIN companies c ON p.companyId=c.id
     JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=?
     ORDER BY p.createdAt DESC`,
    userId
  );
  if (authorizedIds) rows = rows.filter((r) => authorizedIds.includes(r.id));
  return rows;
}

// ============ 知识库 ============
export function listKbDocs(projectId, type) {
  const kb = getKb(projectId, type);
  return { kb, docs: getKbDocs(kb.id) };
}

export function uploadKbDoc(projectId, { type = 1, module = 2, title, content, evidence, pending, source }) {
  if (!title || !content) throw new BizError('VALIDATION_ERROR', '标题与内容必填');
  const kb = getKb(projectId, type);
  const row = {
    id: id(),
    kbId: kb.id,
    module: Number(module) || 2,
    title,
    content,
    evidence: JSON.stringify(evidence || []),
    pending: pending || '',
    source: source || 'Open API',
    updatedAt: nowIso(),
  };
  insert('kbDocuments', row);
  run('UPDATE knowledgeBases SET updatedAt=? WHERE id=?', nowIso(), kb.id);
  return row;
}

// 知识库整理（文档二 1.5）：解析原始资料 → 六模块文档 + QA 索引 + 口径冲突清单
export async function organizeKnowledge(projectId, { type = 1, raw }) {
  const project = getProject(projectId);
  const kb = getKb(projectId, type);
  const result = llm.isReal()
    ? await organizeWithLlm(project, kb, raw)
    : llm.organizeKnowledge(project.brandName, raw);
  for (const doc of result.docs) {
    insert('kbDocuments', {
      id: id(),
      kbId: kb.id,
      module: doc.module,
      title: doc.title,
      content: doc.content,
      evidence: JSON.stringify([]),
      pending: doc.pending || '',
      source: llm.isReal() ? 'LLM 整理' : '知识库整理（mock）',
      updatedAt: nowIso(),
    });
  }
  run('UPDATE knowledgeBases SET qaIndex=?, conflictList=?, updatedAt=? WHERE id=?', JSON.stringify(result.qaIndex), (result.conflictList || []).join('\n'), nowIso(), kb.id);
  return result;
}

async function organizeWithLlm(project, kb, raw) {
  const text = await llm.chat(llm.PROMPTS.organizeKnowledge(project.brandName, raw));
  // 解析 LLM 输出中的 ## 模块段落
  const docs = [];
  const moduleTitles = {
    '01_定位与业务边界': 1,
    '02_产品与服务事实': 2,
    '03_客户与使用场景': 3,
    '04_优势与竞品差异': 4,
    '05_案例与结果': 5,
    '06_权威背书与外部证据': 6,
  };
  const sections = text.split(/\n(?=#{1,3}\s*\d{2}_)/g);
  for (const sec of sections) {
    const m = sec.match(/#{1,3}\s*(\d{2}_[^\n]+)/);
    if (m) {
      const module = moduleTitles[m[1].slice(0, 12)] || 2;
      docs.push({
        module,
        title: m[1].trim(),
        content: sec.slice(m.index + m[0].length).trim() || '【待补充：需业务部门提供】',
        pending: /待补充/.test(sec) ? '含待补充标记，请业务确认' : '',
      });
    }
  }
  if (!docs.length) {
    return { docs: [{ module: 2, title: '02_产品与服务事实', content: text, pending: '' }], qaIndex: { note: 'LLM 整理', items: [] }, conflictList: [] };
  }
  return { docs, qaIndex: { note: 'LLM 整理（答案必须能回溯到六大模块）', items: [] }, conflictList: [] };
}

// ============ 问题库 ============
export function addQuestion(projectId, { text, category = 1, stage, priority = 2, keywords = '', intentDimension = '', source = '人工', withBrand }) {
  if (!text) throw new BizError('VALIDATION_ERROR', '问题内容必填');
  const project = getProject(projectId);
  const dup = q1('SELECT id FROM questions WHERE projectId=? AND text=?', projectId, text.trim());
  if (dup) return { duplicate: true, id: dup.id };
  const row = {
    id: id(),
    projectId,
    text: text.trim(),
    category: Number(category),
    stage: Number(stage) || (Number(category) === 1 ? 1 : 1),
    priority: Number(priority),
    status: 1,
    withBrand: withBrand !== undefined ? (withBrand ? 1 : 0) : text.includes(project.brandName || '@@') ? 1 : 0,
    intentDimension: intentDimension || '',
    keywords,
    source,
    createdAt: nowIso(),
  };
  insert('questions', row);
  return { added: true, id: row.id, row };
}

export function batchAddQuestions(projectId, { items = [] }) {
  if (items.length > 500) throw new BizError('VALIDATION_ERROR', '单批最多导入 500 条问题'); // 审计 R1
  let added = 0,
    skipped = 0,
    duplicate = 0;
  const errors = [];
  for (const item of items) {
    try {
      const r = addQuestion(projectId, { ...item, source: item.source || '批量导入' });
      if (r.added) added++;
      else if (r.duplicate) duplicate++;
      else skipped++;
    } catch (e) {
      errors.push(`${item.text?.slice(0, 20)}: ${e.message}`);
      skipped++;
    }
  }
  return { added, skipped, duplicate, errors };
}

export async function generateQuestions(projectId, mode = '50') {
  const project = getProject(projectId);
  const { text, questions } = await llm.generateQuestions50(project);
  const result = batchAddQuestions(projectId, {
    items: questions.map((x) => ({
      text: x.text,
      category: 2, // 产品推荐（不带品牌名的选购问题）
      stage: 1,
      priority: 2,
      keywords: x.keywords,
      intentDimension: x.dimension,
      source: mode === '40' ? '40问精简' : '50问生成',
    })),
  });
  return { text, ...result, count: questions.length };
}

export async function simplifyTo40(projectId) {
  const project = getProject(projectId);
  const rows = q('SELECT * FROM questions WHERE projectId=? ORDER BY createdAt', projectId);
  const { table, questions } = llm.simplifyTo40(rows, project.brandName);
  const result = batchAddQuestions(projectId, {
    items: questions.map((x) => ({
      text: x.text,
      category: x.stage === 1 ? 2 : x.stage === 2 ? 3 : 5,
      stage: x.stage,
      priority: x.stage === 1 ? 2 : 1,
      keywords: x.keywords || '',
      intentDimension: x.dimension || '',
      source: '40问精简',
    })),
  });
  return { table, ...result };
}

export function updateQuestion(input) {
  const row = q1('SELECT * FROM questions WHERE id=?', input.questionId);
  if (!row) throw new BizError('NOT_FOUND', '问题不存在');
  const fields = ['priority', 'status', 'category', 'stage', 'intentDimension', 'keywords'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (input[f] !== undefined) {
      sets.push(`${f}=?`);
      vals.push(Number(input[f]) ?? input[f]);
    }
  }
  if (input.text !== undefined) {
    sets.push('text=?');
    vals.push(input.text);
  }
  if (sets.length) run(`UPDATE questions SET ${sets.join(',')} WHERE id=?`, ...vals, row.id);
  return q1('SELECT * FROM questions WHERE id=?', row.id);
}

// ============ 内容创作 ============
export function preflight(projectId, questionId) {
  const question = q1('SELECT * FROM questions WHERE id=?', questionId);
  if (!question) throw new BizError('NOT_FOUND', '请先在上方选择一个目标问题');
  if (question.projectId !== projectId) throw new BizError('VALIDATION_ERROR', '问题不属于该项目（审计 R1：跨项目引用拒绝）');
  const brand = listKbDocs(projectId, 1);
  const product = listKbDocs(projectId, 2);
  return llm.preflightCheck(getProject(projectId), question, brand.docs, product.docs);
}

export async function createContent(projectId, { questionId, type = 2, aiDeclaration }) {
  const project = getProject(projectId);
  const question = q1('SELECT * FROM questions WHERE id=?', questionId);
  if (!question) throw new BizError('NOT_FOUND', '请先在上方选择一个目标问题');
  const brandDocs = getKbDocs(getKb(projectId, 1).id);
  const productDocs = getKbDocs(getKb(projectId, 2).id);

  let gen = null;
  let genMeta = {};
  if (llm.isReal()) {
    // v1.2：配置 LLM 后走真实生成（方法论原文提示词）；失败显式回落模板并记录
    const facts = llm.pickFacts(brandDocs, question.text, 10).concat(llm.pickFacts(productDocs, question.text, 6));
    const kbContext = facts.map((f) => `- ${f.text}（${f.moduleTitle}）`).join('\n') || '（知识库为空，全部按待补充处理）';
    try {
      gen = await llm.createArticleWithLlm(Number(type), question.text, kbContext, project);
      usageIncrement(q1('SELECT orgId FROM companies WHERE id=?', project.companyId).orgId, 'llm.calls');
    } catch (e) {
      console.error('[llm] 文章真实生成失败，回落模板：', e.message);
      genMeta.llmFailed = e.message.slice(0, 120);
    }
  }
  if (!gen) {
    gen = Number(type) === 1
      ? llm.createAnswerCard(question.text, brandDocs, productDocs, project)
      : Number(type) === 2
        ? llm.createBrandArticle(question.text, brandDocs, project)
        : llm.createProductArticle(question.text, productDocs, brandDocs, project);
    gen.meta = { ...(gen.meta || {}), source: llm.isReal() ? 'llm-failed-template' : 'template' };
  }

  // v1.2：封面走图像生成 Provider（配置 IMAGE_API_KEY 即真实文生图；未配置/失败显式回落 SVG）
  const cover = await imageProvider.generateCover(projectId, gen.title, question.text);
  const material = insert('materials', {
    id: id(),
    projectId,
    type: 1,
    name: `封面：${gen.title.slice(0, 30)}`,
    url: cover.url,
    meta: JSON.stringify({ kind: 'cover', articleQuestion: question.text, coverSource: cover.source, imageGenerated: cover.imageGenerated, storage: cover.storage }),
    createdAt: nowIso(),
  });

  const declare = aiDeclaration === undefined ? 1 : Number(aiDeclaration) ? 1 : 0; // P0-3 AIGC 标识默认开
  const article = insert('articles', {
    id: id(),
    projectId,
    questionId,
    title: gen.title,
    content: gen.content,
    type: Number(type),
    coverMaterialId: material.id,
    status: 0, // 已生成（未上传）
    aiDeclaration: declare,
    meta: JSON.stringify({ ...(gen.meta || {}), aiDeclarationText: declare ? '本文由 AI 辅助生成，内容已经人工审核' : '' }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  // 文章在平台中即视为「已上传」？不——文档状态机：已生成→已上传(进入平台文章管理)。
  // Open API/Skills 创建的文章直接进入平台，标记已上传。
  run('UPDATE articles SET status=1 WHERE id=?', article.id);
  return q1('SELECT * FROM articles WHERE id=?', article.id);
}

export function updateArticle(input) {
  const row = q1('SELECT * FROM articles WHERE id=?', input.articleId);
  if (!row) throw new BizError('NOT_FOUND', '文章不存在');
  const sets = [];
  const vals = [];
  if (input.title !== undefined) {
    sets.push('title=?');
    vals.push(input.title);
  }
  if (input.content !== undefined) {
    sets.push('content=?');
    vals.push(input.content);
  }
  if (input.status !== undefined) {
    sets.push('status=?');
    vals.push(Number(input.status));
  }
  if (sets.length) {
    run(`UPDATE articles SET ${sets.join(',')}, updatedAt=? WHERE id=?`, ...vals, nowIso(), row.id);
  }
  return q1('SELECT * FROM articles WHERE id=?', row.id);
}

export function deleteArticle(articleId) {
  const used = q1('SELECT id FROM publishTasks WHERE articleId=? AND status IN (1,2,3)', articleId);
  if (used) throw new BizError('CONFLICT', '文章已关联发布任务，不能删除（连带影响：发布任务将失去内容）');
  // v1.6.1：删除文章时同时清理关联的封面图文件
  const cover = q1('SELECT url FROM materials WHERE id=(SELECT coverMaterialId FROM articles WHERE id=?)', articleId);
  if (cover && cover.url && cover.url.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(cover.url))); } catch {}
  }
  run('DELETE FROM auditRecords WHERE articleId=?', articleId);
  run('DELETE FROM articles WHERE id=?', articleId);
  return { deleted: articleId };
}

// 三道审核（文档二 3.5 / 3.7）
export function auditArticle(articleId, auditor = 'GEO 平台') {
  const article = q1('SELECT * FROM articles WHERE id=?', articleId);
  if (!article) throw new BizError('NOT_FOUND', '文章不存在');
  const project = getProject(article.projectId);
  const brandDocs = getKbDocs(getKb(article.projectId, 1).id);
  const productDocs = getKbDocs(getKb(article.projectId, 2).id);
  const result = llm.auditArticle(
    { ...article, meta: parseJsonSafe(article.meta, {}) },
    brandDocs,
    productDocs,
    project
  );
  const row = {
    id: id(),
    articleId,
    gate1: result.gate1,
    gate1Issues: result.gate1Issues,
    gate2: result.gate2,
    gate2Issues: result.gate2Issues,
    gate3: result.gate3,
    gate3Issues: result.gate3Issues,
    verdict: result.verdict,
    evidenceLinks: '',
    pendingFacts: result.pendingFacts || '',
    changes: '',
    auditor,
    createdAt: nowIso(),
  };
  insert('auditRecords', row);
  return row;
}

// ============ 素材 ============
export async function uploadMaterial(projectId, { name, type = 1, dataBase64, url }) {
  let finalUrl = url;
  if (dataBase64) {
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 10 * 1024 * 1024) throw new BizError('VALIDATION_ERROR', '素材超过 10MB 上限');
    // 审计修复 P0-3：扩展名白名单（原实现取自用户文件名，可构造 ../ 逃逸 uploads 目录）
    const ext = safeUploadExt(name || '');
    const fname = `mat-${shortId()}.${ext}`;
    // v1.2：配置 S3_* 时写对象存储（失败显式报错）；未配置回落本地 uploads
    const r = await storagePut('materials', fname, buf);
    finalUrl = r.url;
  }
  if (!finalUrl) throw new BizError('VALIDATION_ERROR', '需要 url 或 dataBase64 之一');
  const row = {
    id: id(),
    projectId,
    type: Number(type) || 1,
    name: name || '未命名素材',
    url: finalUrl,
    meta: '{}',
    createdAt: nowIso(),
  };
  insert('materials', row);
  return row;
}

// ============ 发布 ============
export function createPublishAccount(projectId, { platform, accountName, accountType = 2, quota = 10 }) {
  const row = {
    id: id(),
    projectId,
    platform: Number(platform),
    accountName,
    accountType: Number(accountType),
    authStatus: 1,
    quota: Number(quota),
    createdAt: nowIso(),
  };
  insert('publishAccounts', row);
  return row;
}

// 发布包（文档二 3.6 的 7 个字段）
export function buildPublishPackage(articleId, platform, accountId) {
  const article = q1('SELECT * FROM articles WHERE id=?', articleId);
  if (!article) throw new BizError('NOT_FOUND', '文章不存在');
  const account = accountId ? q1('SELECT * FROM publishAccounts WHERE id=?', accountId) : null;
  const cover = article.coverMaterialId ? q1('SELECT * FROM materials WHERE id=?', article.coverMaterialId) : null;
  return {
    platform,
    platformLabel: label('publishPlatform', platform),
    title: article.title,
    content: article.content,
    media: cover ? [{ file: cover.url, order: 1, note: '封面配图' }] : [],
    account: account ? { id: account.id, name: account.accountName, type: label('accountType', account.accountType) } : null,
    links: {
      evidence: '知识库证据链接（见文章证据清单）',
      cta: '预约/咨询入口（知识库 03 模块行动建议）',
    },
    aiDeclaration: article.aiDeclaration
      ? { required: true, text: '本文由 AI 辅助生成，内容已经人工审核。', note: '按《人工智能生成合成内容标识办法》，对外发布请按渠道要求粘贴 AI 声明' }
      : { required: false, note: '已关闭 AI 声明，请自行确认渠道合规要求' },
    backfill: {
      发布状态: '已创建',
      正式URL: '',
      发布时间: '',
      平台: label('publishPlatform', platform),
      账号: account?.accountName || '',
      版本号: 'v1',
    },
  };
}

export function createPublishTask(projectId, { articleId, platform, accountId }) {
  const article = q1('SELECT * FROM articles WHERE id=?', articleId);
  if (!article || article.projectId !== projectId) throw new BizError('NOT_FOUND', '文章不存在或不属于该项目');
  // Spec 02 §4.6：进入发布前必须已通过三道审核（任何一道不通过都不应直接进入重点投放）
  const latestAudit = q1('SELECT * FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC LIMIT 1', articleId);
  if (!latestAudit || Number(latestAudit.verdict) !== 2) {
    throw new BizError('CONFLICT', '文章尚未通过三道审核（或最近一次审核未全部通过），不能进入发布；先执行 articles.audit');
  }
  // 审计 R2-6：发布平台枚举校验（1-10）
  const plat = Number(platform);
  if (!Number.isInteger(plat) || plat < 1 || plat > 10) {
    throw new BizError('VALIDATION_ERROR', '发布平台枚举非法（1-9 为预置渠道，10 为其他）');
  }
  // Spec 02 §4.6：账号必须已授权且额度 > 0
  if (!accountId) throw new BizError('VALIDATION_ERROR', '必须指定发布账号');
  const account = q1('SELECT * FROM publishAccounts WHERE id=? AND projectId=?', accountId, projectId);
  if (!account) throw new BizError('NOT_FOUND', '发布账号不存在或不属于该项目');
  if (Number(account.authStatus) !== 1) throw new BizError('CONFLICT', '发布账号未授权，请先在「授权账号」完成授权');
  if (Number(account.quota) <= 0) throw new BizError('CONFLICT', '发布账号额度不足，请先补充额度');
  const pkg = buildPublishPackage(articleId, Number(platform), accountId);
  const row = {
    id: id(),
    projectId,
    articleId,
    platform: Number(platform),
    accountId: accountId || null,
    status: 1, // 已创建（等待人工确认预览）
    publishedUrl: null,
    publishedAt: null,
    failReason: null,
    packageJson: JSON.stringify(pkg),
    createdAt: nowIso(),
  };
  insert('publishTasks', row);
  run('UPDATE articles SET status=2, updatedAt=? WHERE id=? AND status<2', nowIso(), articleId);
  return row;
}

// 审计/真实接入：手动发布回填——渠道无公开 API 时（知乎/小红书图文/搜狐等），
// 学员按发布包手动发布后，把真实正式 URL 登记回平台，文章状态机与真实监测链路随之打通。
export function markPublishedTask({ taskId, publishedUrl }) {
  const task = q1('SELECT * FROM publishTasks WHERE id=?', taskId);
  if (!task) throw new BizError('NOT_FOUND', '发布任务不存在');
  if (task.status === 3 && task.publishedUrl) throw new BizError('CONFLICT', '该任务已有正式链接；如需更正请先与平台管理员确认');
  const url = String(publishedUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new BizError('VALIDATION_ERROR', '正式链接必须是 http(s) 开头的真实 URL');
  if (url.length > 500) throw new BizError('VALIDATION_ERROR', 'URL 过长');
  run(
    `UPDATE publishTasks SET status=3, publishedUrl=?, publishedAt=?, failReason=NULL WHERE id=?`,
    url,
    nowIso(),
    taskId
  );
  run('UPDATE articles SET status=3, updatedAt=? WHERE id=? AND status<3', nowIso(), task.articleId);
  const orgRowN = q1('SELECT orgId FROM companies WHERE id=?', (q1('SELECT companyId FROM projects WHERE id=?', task.projectId) || {}).companyId);
  if (orgRowN) notifyOrg(orgRowN.orgId, 'publish.done', { taskId, publishedUrl: url });
  return q1('SELECT * FROM publishTasks WHERE id=?', taskId);
}

export function confirmPublishTask(taskId) {
  const task = q1('SELECT * FROM publishTasks WHERE id=?', taskId);
  if (!task) throw new BizError('NOT_FOUND', '发布任务不存在');
  if (task.status !== 1) throw new BizError('CONFLICT', `任务状态为「${label('publishStatus', task.status)}」，只有「已创建」状态可确认发布`);
  run('UPDATE publishTasks SET status=2 WHERE id=?', taskId);
  run('UPDATE articles SET status=2 WHERE id=? AND status<2', task.articleId); // 仅前进不回退（审计 R1）
  // Spec 02 §4.6：确认发布扣减账号额度 1
  if (task.accountId) {
    run('UPDATE publishAccounts SET quota = MAX(quota - 1, 0) WHERE id=?', task.accountId);
  }
  // v1.2 发布模式：manual（默认，真实语义：人工/回填，无自动假结算）
  // | webhook（真实适配器：推送发布包到自建 RPA/客户端，回调 publishedUrl）
  // | mock（显式开启，仅演示培训用）
  const mode = process.env.PUBLISH_MODE || 'manual';
  if (mode === 'mock') {
    createMockPublish(taskId, task.platform);
  } else if (process.env.PUBLISH_WEBHOOK_URL) {
    fireWebhookPublish(taskId);
  }
  // manual / webhook 超时：任务停留在「发布中」，等待人工回填 markPublished
  return q1('SELECT * FROM publishTasks WHERE id=?', taskId);
}

// Webhook 发布适配器：把发布包推送到自建发布客户端/RPA，成功回包 {ok,publishedUrl}
async function fireWebhookPublish(taskId) {
  const task = q1('SELECT * FROM publishTasks WHERE id=?', taskId);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(process.env.PUBLISH_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PUBLISH_WEBHOOK_TOKEN ? { 'X-Geo-Token': process.env.PUBLISH_WEBHOOK_TOKEN } : {}),
      },
      body: JSON.stringify({ event: 'publish.request', taskId, package: parseJsonSafe(task.packageJson, {}) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 64 * 1024) throw new Error('webhook 回包异常（超过 64KB）');
    const data = JSON.parse(text);
    if (data.ok && data.publishedUrl && /^https?:\/\//.test(data.publishedUrl)) {
      run(
        `UPDATE publishTasks SET status=3, publishedUrl=?, publishedAt=? WHERE id=? AND status=2`,
        data.publishedUrl,
        nowIso(),
        taskId
      );
      run('UPDATE articles SET status=3, updatedAt=? WHERE id=? AND status<3', nowIso(), task.articleId);
      console.log('[publish:webhook] 已发布', taskId, data.publishedUrl);
    } else {
      console.warn('[publish:webhook] 回包无 publishedUrl，任务保持「发布中」等待手动回填');
    }
  } catch (e) {
    console.warn(`[publish:webhook] 推送失败（任务 ${taskId} 保持「发布中」，可手动回填）:`, e.message);
  }
}

export function getPublishTask(taskId) {
  const task = q1('SELECT * FROM publishTasks WHERE id=?', taskId);
  if (!task) throw new BizError('NOT_FOUND', '发布任务不存在');
  return task;
}

// ============ 上榜监测 ============
export async function createMonitorTask(projectId, { questionIds, platforms = [1], mode = 1, scheduleDays, runNow = true }) {
  if (!questionIds?.length) throw new BizError('VALIDATION_ERROR', '至少选择一个问题');
  // 审计 R1：跨项目问题拒绝；数量上限 50
  if (questionIds.length > 50) throw new BizError('VALIDATION_ERROR', '单次监测最多 50 个问题');
  for (const qid of questionIds) {
    const row = q1('SELECT projectId FROM questions WHERE id=?', qid);
    if (!row || row.projectId !== projectId) {
        throw new BizError('VALIDATION_ERROR', `问题不属于该项目：${qid}`);
    }
  }
  platforms = platforms.map(Number).filter((x) => x >= 1 && x <= 5);
  if (!platforms.length) throw new BizError('VALIDATION_ERROR', 'AI 平台枚举非法（1豆包 2DeepSeek 3元宝 4通义千问）');
  // P1-3 用量配额：org.quotaMonitorMonthly > 0 时，本月监测调用次数超限则拒绝
  const orgRow = q1(`SELECT c.orgId,
    CASE WHEN o.planCode IS NOT NULL AND o.planExpiresAt > ? THEN o.quotaMonitorMonthly ELSE o.quotaMonitorMonthly END AS quotaMonitorMonthly,
    o.planCode, o.planExpiresAt
    FROM projects p JOIN companies c ON p.companyId=c.id JOIN orgs o ON o.id=c.orgId WHERE p.id=?`, nowIso(), projectId);
  if (orgRow && Number(orgRow.quotaMonitorMonthly) > 0) {
    const month = nowIso().slice(0, 7);
    const used = q1('SELECT COUNT(*) as n FROM monitorResults r JOIN projects p ON r.projectId=p.id JOIN companies c ON p.companyId=c.id WHERE c.orgId=? AND r.ranAt LIKE ?', orgRow.orgId, `${month}%`).n;
    const planned = questionIds.length * platforms.length;
    if (used + planned > Number(orgRow.quotaMonitorMonthly)) {
      throw new BizError('CONFLICT', `本月监测调用配额已用尽（已用 ${used}/${orgRow.quotaMonitorMonthly}），请在「团队成员」页调高配额或下月再试`);
    }
  }
  const row = {
    id: id(),
    projectId,
    questionIds: JSON.stringify(questionIds),
    platforms: JSON.stringify(platforms.map(Number)),
    mode: Number(mode),
    scheduleDays: JSON.stringify(scheduleDays || []),
    status: 2, // 运行中
    createdAt: nowIso(),
  };
  insert('monitorTasks', row);
  const checkpoints = [];
  // 第 0 天立即执行
  checkpoints.push({ id: id(), taskId: row.id, day: 0, dueAt: nowIso(), status: 1, resultIds: '[]', ranAt: null });
  for (const d of scheduleDays || []) {
    checkpoints.push({
      id: id(),
      taskId: row.id,
      day: Number(d),
      dueAt: addDays(nowIso(), Number(d)),
      status: 1,
      resultIds: '[]',
      ranAt: null,
    });
  }
  for (const c of checkpoints) insert('monitorCheckpoints', c);
  if (runNow) await runCheckpoint(checkpoints[0].id);
  return { task: q1('SELECT * FROM monitorTasks WHERE id=?', row.id), checkpoints };
}

export async function runCheckpoint(checkpointId, runSeedBase = 0) {
  const cp = q1('SELECT * FROM monitorCheckpoints WHERE id=?', checkpointId);
  if (!cp) throw new BizError('NOT_FOUND', '监测检查点不存在');
  const task = q1('SELECT * FROM monitorTasks WHERE id=?', cp.taskId);
  const project = getProject(task.projectId);
  const questionIds = parseJsonSafe(task.questionIds, []);
  const platforms = parseJsonSafe(task.platforms, [1]);
  const resultIds = [];
  for (const qid of questionIds) {
    const question = q1('SELECT * FROM questions WHERE id=?', qid);
    if (!question) continue;
    for (const platform of platforms) {
      let r;
      let dataSource = 'mock';
      const monitorMockAllowed = process.env.MONITOR_MOCK !== '0';
      if (realMonitorConfigured(platform)) {
        dataSource = 'real-platform';
        try {
          r = await runMonitorReal({ project, question: question.text, platform });
        } catch (e) {
          // 审计/稳定性：真实调用失败必须可观测，不静默回落 mock 假数据
          r = {
            platform,
            answerText: `[真实监测调用失败] ${e.message}`,
            brandMentioned: 0, mentionPosition: '未执行', brandAccurate: null,
            recommendLevel: 0, recommendReason: '', competitors: [], citations: [],
            keywords: { _question: question.text }, hitStatus: 0, pageAccessible: 0,
            exactUrlHit: 0, nextStep: '检查该平台 API 配置（key/model/联网开关）后重试', nextOptimize: '',
          };
        }
      } else if (llmMonitorAvailable()) {
        // Goal-A: LLM-as-Monitor——用已配置的 LLM 产生真实 AI 回答
        dataSource = 'real-llm';
        try {
          r = await runMonitorLLM({ project, question: question.text, platform });
        } catch (e) {
          console.error('[monitor-llm]', e.message);
          r = {
            platform,
            answerText: `[LLM 监测调用失败] ${e.message}`,
            brandMentioned: 0, mentionPosition: '未执行', brandAccurate: null,
            recommendLevel: 0, recommendReason: '', competitors: [], citations: [],
            keywords: { _question: question.text }, hitStatus: 0, pageAccessible: 0,
            exactUrlHit: 0, nextStep: '检查 LLM 配置后重试', nextOptimize: '',
            _meta: { source: 'real-llm-error' },
          };
        }
      } else if (monitorMockAllowed) {
        r = runMonitor({ project, question: question.text, platform, runSeed: runSeedBase + cp.day });
      } else {
        // MONITOR_MOCK=0 严格模式：拒绝演示假数据，显式失败
        r = {
          platform,
          answerText: '[真实监测未配置] 该平台未配置 MONITOR_*_KEY，且 MONITOR_MOCK=0 已禁用演示回退',
          brandMentioned: 0, mentionPosition: '未执行', brandAccurate: null,
          recommendLevel: 0, recommendReason: '', competitors: [], citations: [],
          keywords: { _question: question.text }, hitStatus: 0, pageAccessible: 0,
          exactUrlHit: 0, nextStep: '在部署环境配置该平台的 MONITOR_*_KEY 后重试', nextOptimize: '',
        };
      }
      const row = {
        id: id(),
        taskId: task.id,
        checkpointId: cp.id,
        projectId: project.id,
        questionId: qid,
        platform,
        ranAt: nowIso(),
        answerText: r.answerText,
        brandMentioned: r.brandMentioned,
        mentionPosition: r.mentionPosition,
        brandAccurate: r.brandAccurate === null ? null : r.brandAccurate ? 1 : 0,
        recommendLevel: r.recommendLevel,
        recommendReason: r.recommendReason,
        competitors: JSON.stringify(r.competitors),
        citations: JSON.stringify(r.citations),
        keywords: JSON.stringify(r.keywords),
        hitStatus: r.hitStatus,
        pageAccessible: r.pageAccessible,
        nextStep: r.nextStep,
        nextOptimize: r.nextOptimize,
        exactUrlHit: r.exactUrlHit,
      };
      row.dataSource = dataSource;
      insert('monitorResults', row);
      resultIds.push(row.id);
      usageIncrement(q1('SELECT orgId FROM companies WHERE id=?', project.companyId).orgId, 'monitor.calls');
      // 问题状态联动
      run('UPDATE questions SET status=2 WHERE id=? AND status=1', qid);
      if (r.hitStatus >= 2) run('UPDATE questions SET status=3 WHERE id=?', qid);
    }
  }
  run('UPDATE monitorCheckpoints SET status=2, resultIds=?, ranAt=? WHERE id=?', JSON.stringify(resultIds), nowIso(), cp.id);
  const remaining = q1('SELECT COUNT(*) as c FROM monitorCheckpoints WHERE taskId=? AND status=1', cp.taskId).c;
  run('UPDATE monitorTasks SET status=? WHERE id=?', remaining > 0 ? 2 : 3, cp.taskId);
  // 终局-C：监测完成事件通知
  const orgRowN = q1('SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?', task.projectId);
  if (orgRowN) {
    const hits = resultIds.map((rid) => q1('SELECT exactUrlHit, hitStatus FROM monitorResults WHERE id=?', rid)).filter(Boolean);
    notifyOrg(orgRowN.orgId, 'monitor.done', {
      taskId: task.id,
      checkpointDay: cp.day,
      results: hits.length,
      exactUrlHits: hits.filter((x) => x.exactUrlHit === 1).length,
    });
  }
  return { checkpoint: q1('SELECT * FROM monitorCheckpoints WHERE id=?', cp.id), resultIds };
}

// P1-4 调度器：全站到期复测点（由 server.js 定时调用，不依赖页面访问）
export async function runDueCheckpointsAll() {
  const due = q(
    `SELECT cp.id FROM monitorCheckpoints cp WHERE cp.status=1 AND cp.dueAt<=?`,
    nowIso()
  );
  for (const cp of due) {
    try {
      await runCheckpoint(cp.id);
    } catch (e) {
      console.error('[scheduler]', cp.id, e.message);
    }
  }
  return due.length;
}

export async function runDueCheckpoints(projectId) {
  const due = q(
    `SELECT cp.* FROM monitorCheckpoints cp JOIN monitorTasks t ON cp.taskId=t.id
     WHERE t.projectId=? AND cp.status=1 AND cp.day>0 AND cp.dueAt<=?`,
    projectId,
    nowIso()
  );
  const done = [];
  for (const cp of due) {
    await runCheckpoint(cp.id);
    done.push(cp.id);
  }
  return done;
}

export async function forceRunNextCheckpoint(taskId) {
  const cp = q1('SELECT * FROM monitorCheckpoints WHERE taskId=? AND status=1 ORDER BY day LIMIT 1', taskId);
  if (!cp) throw new BizError('CONFLICT', '该任务没有待执行的检查点');
  return runCheckpoint(cp.id);
}

// 逆向分析（文档一六(五) + 文档二 4.3）：同题同平台重复 N 次
export async function runReverseAnalysis(projectId, { question, platform = 1, times = 10 }) {
  const project = getProject(projectId);
  times = Math.max(1, Math.min(Number(times) || 10, 30)); // 审计 R1：次数上限 30，防滥用
  const results = [];
  for (let i = 0; i < Number(times); i++) {
    if (realMonitorConfigured(platform)) {
      try {
        results.push(await runMonitorReal({ project, question, platform }));
      } catch {
        results.push(runMonitor({ project, question, platform, runSeed: 1000 + i * 7 }));
      }
    } else {
      results.push(runMonitor({ project, question, platform, runSeed: 1000 + i * 7 }));
    }
  }
  // 生成逆向分析报告
  const rows = results.map((r, i) => ({
    ...r,
    platformLabel: label('aiPlatform', platform),
    runIndex: i + 1,
  }));
  const reportContent = llm.reverseAnalysisReport(rows, project);
  const report = insert('reports', {
    id: id(),
    projectId,
    type: 4,
    title: `逆向分析：${question.slice(0, 24)}（${label('aiPlatform', platform)} × ${times}）`,
    content: reportContent,
    relatedTaskIds: JSON.stringify([]),
    createdAt: nowIso(),
  });
  return { results: rows, report };
}

// ============ 信源资产（文档二 4.1 / 文档一六(三)） ============
export function collectSourceAssets(projectId, taskId = null) {
  let results;
  if (taskId) {
    results = q('SELECT * FROM monitorResults WHERE taskId=?', taskId);
  } else {
    results = q(
      `SELECT r.* FROM monitorResults r JOIN monitorTasks t ON r.taskId=t.id WHERE r.projectId=? ORDER BY r.ranAt DESC`,
      projectId
    );
  }
  let upserted = 0;
  for (const r of results) {
    const citations = parseJsonSafe(r.citations, []);
    const question = q1('SELECT text FROM questions WHERE id=?', r.questionId)?.text || '';
    for (const c of citations) {
      const existing = q1('SELECT * FROM sourceAssets WHERE projectId=? AND url=?', projectId, c.url);
      if (existing) {
        run('UPDATE sourceAssets SET citedCount=citedCount+1, updatedAt=? WHERE id=?', nowIso(), existing.id);
        if (c.own) run('UPDATE sourceAssets SET pageStatus=4, status=1 WHERE id=?', existing.id);
        upserted++;
        continue;
      }
      const platform = q1('SELECT platform FROM publishTasks WHERE publishedUrl=?', c.url);
      const row = {
        id: id(),
        projectId,
        question,
        aiPlatform: r.platform,
        articleTitle: c.title,
        url: c.url,
        publishPlatform: platform?.platform ?? guessPlatformFromDomain(c.domain),
        publisher: c.own ? 8 : guessPublisher(c.domain),
        accountType: c.own ? 2 : 3,
        evidenceType: c.own ? 2 : 5,
        citedCount: 1,
        brandPerformance: c.own ? (r.recommendLevel >= 2 ? '品牌被明确推荐并引用' : '品牌被提及') : `与 ${parseJsonSafe(r.competitors, [])[0]?.name || '竞品'} 关联出现`,
        competitorLink: c.own ? '' : c.url,
        controllability: c.own ? 1 : 3,
        pageStatus: c.own ? 4 : 3,
        status: c.own ? 1 : 4, // 我方→已引用信源；竞品/第三方→观察信源
        nextAction: c.own ? '保持页面可访问，跨批次观察引用稳定性' : '研究其被引用规律，判断是否可争取同类信源',
        adaptPlatforms: JSON.stringify([r.platform]),
        needProve: '',
        remark: '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      insert('sourceAssets', row);
      upserted++;
    }
  }
  return { upserted };
}

function guessPlatformFromDomain(domain) {
  const map = {
    'mock.toutiao.com': 1,
    'mock.sohu.com': 2,
    'mock.163.com': 3,
    'mock.douyin.com': 4,
    'mock.zhihu.com': 5,
    'mock.xiaohongshu.com': 6,
    'mock.mp.weixin.qq.com': 7,
    'mock.smzdm.com': 8,
    'mock.ownsite.cn': 9,
  };
  return map[domain] ?? 10;
}
function guessPublisher(domain) {
  if (domain === 'mock.gov.cn') return 3;
  if (domain === 'mock.news.cn') return 1;
  if (domain === 'mock.industry.com') return 5;
  if (domain === 'mock.b2b.com') return 6;
  if (domain === 'mock.toutiao.com' || domain === 'mock.163.com') return 4;
  if (domain === 'mock.zhihu.com') return 9;
  return 10;
}

export function upsertSourceAsset(projectId, input) {
  if (input.id) {
    const existing = q1('SELECT * FROM sourceAssets WHERE id=? AND projectId=?', input.id, projectId);
    if (!existing) throw new BizError('NOT_FOUND', '信源资产不存在');
    const fields = ['articleTitle', 'url', 'publishPlatform', 'publisher', 'accountType', 'evidenceType', 'brandPerformance', 'competitorLink', 'controllability', 'pageStatus', 'status', 'nextAction', 'needProve', 'remark', 'question', 'aiPlatform'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (input[f] !== undefined) {
        sets.push(`${f}=?`);
        vals.push(input[f]);
      }
    }
    if (sets.length) run(`UPDATE sourceAssets SET ${sets.join(',')}, updatedAt=? WHERE id=?`, ...vals, nowIso(), existing.id);
    return q1('SELECT * FROM sourceAssets WHERE id=?', existing.id);
  }
  if (!input.url || !input.articleTitle) throw new BizError('VALIDATION_ERROR', 'url 与 articleTitle 必填');
  const row = {
    id: id(),
    projectId,
    question: input.question || '',
    aiPlatform: input.aiPlatform ?? null,
    articleTitle: input.articleTitle,
    url: input.url,
    publishPlatform: input.publishPlatform ?? 10,
    publisher: input.publisher ?? 10,
    accountType: input.accountType ?? 3,
    evidenceType: input.evidenceType ?? 6,
    citedCount: input.citedCount ?? 0,
    brandPerformance: input.brandPerformance || '',
    competitorLink: input.competitorLink || '',
    controllability: input.controllability ?? 2,
    pageStatus: input.pageStatus ?? 1,
    status: input.status ?? 2,
    nextAction: input.nextAction || '',
    adaptPlatforms: JSON.stringify(input.adaptPlatforms || []),
    needProve: input.needProve || '',
    remark: input.remark || '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  insert('sourceAssets', row);
  return row;
}

// ============ 报告 ============
export async function createReport(projectId, { type, taskIdA, taskIdB, question, platform, times }) {
  const project = getProject(projectId);
  const numType = Number(type);

  if (numType === 1 || numType === 2) {
    // 品牌/产品诊断：取最近一个监测任务的全部结果
    const task = taskIdA
      ? q1('SELECT * FROM monitorTasks WHERE id=?', taskIdA)
      : q1('SELECT * FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC LIMIT 1', projectId);
    if (!task) throw new BizError('CONFLICT', '没有可用监测任务：先创建上榜监测任务，不要凭想象诊断');
    const results = q('SELECT * FROM monitorResults WHERE taskId=?', task.id).map((r) => ({
      ...r,
      competitors: parseJsonSafe(r.competitors, []),
      citations: parseJsonSafe(r.citations, []),
    }));
    const content =
      numType === 1 ? llm.brandDiagnosisReport(results, project) : llm.productDiagnosisReport(results, project);
    return insert('reports', {
      id: id(),
      projectId,
      type: numType,
      title: `${numType === 1 ? '品牌诊断' : '产品推荐诊断'}：${project.name}（任务 ${task.id.slice(0, 8)}）`,
      content,
      relatedTaskIds: JSON.stringify([task.id]),
      createdAt: nowIso(),
    });
  }

  if (numType === 3) {
    if (!taskIdA || !taskIdB) throw new BizError('VALIDATION_ERROR', '优化前后对比需要两个监测任务 ID（taskIdA=优化前, taskIdB=优化后）');
    const before = q('SELECT * FROM monitorResults WHERE taskId=?', taskIdA);
    const after = q('SELECT * FROM monitorResults WHERE taskId=?', taskIdB);
    if (!before.length || !after.length) throw new BizError('CONFLICT', '监测任务没有结果数据');
    const content = llm.compareReport(before, after, project);
    return insert('reports', {
      id: id(),
      projectId,
      type: 3,
      title: `优化前后对比：${before[0].ranAt.slice(0, 10)} → ${after[0].ranAt.slice(0, 10)}`,
      content,
      relatedTaskIds: JSON.stringify([taskIdA, taskIdB]),
      createdAt: nowIso(),
    });
  }

  if (numType === 4) {
    if (!question) throw new BizError('VALIDATION_ERROR', '逆向分析需要 question 参数');
    const { report } = await runReverseAnalysis(projectId, { question, platform: Number(platform) || 1, times: Number(times) || 10 });
    return report;
  }

  if (numType === 6) {
    return insert('reports', {
      id: id(),
      projectId,
      type: 6,
      title: `口碑监测摘要：${project.brandName || project.name}`,
      content: reputationReport(projectId, taskIdA),
      relatedTaskIds: JSON.stringify(taskIdA ? [taskIdA] : []),
      createdAt: nowIso(),
    });
  }

  if (numType === 5) {
    // 一页纸诊断（文档二 7.1）：抽样实测 + 现状 + 竞品 + 最扎眼问题 + 三个首问
    const sampleQuestions = q('SELECT * FROM questions WHERE projectId=? AND withBrand=1 LIMIT 2', projectId);
    if (!sampleQuestions.length) throw new BizError('CONFLICT', '没有品牌认知问题可抽样，请先建立问题库');
    const plat = Number(platform) || 1;
    const samples = [];
    for (const question of sampleQuestions) {
      if (realMonitorConfigured(plat)) {
        try {
          samples.push(await runMonitorReal({ project, question: question.text, platform: plat }));
        } catch {
          samples.push(runMonitor({ project, question: question.text, platform: plat, runSeed: 77 }));
        }
      } else {
        samples.push(runMonitor({ project, question: question.text, platform: plat, runSeed: 77 }));
      }
    }
    const mentioned = samples.filter((s) => s.brandMentioned).length;
    const inaccurate = samples.filter((s) => s.brandMentioned && s.brandAccurate === 0).length;
    const competitors = {};
    for (const s of samples) for (const c of s.competitors) competitors[c.name] = 1;
    const content = `${project.brandName || project.name} · AI 现状一页纸诊断（日期：${nowIso().slice(0, 10)}）
1. 抽样实测：${label('aiPlatform', plat)} + ${samples.length} 个核心问题抽样
2. 现状诊断：
   - 探索层表现：${samples.some((s) => s.brandMentioned) ? '已进入推荐名单' : '未进入推荐名单'}、当前排位：${samples[0]?.mentionPosition || '未出现'}
   - 评估层表现：AI 描述${mentioned > 0 ? (inaccurate > 0 ? '存在不准确（' + inaccurate + ' 次）' : '准确') : '暂无描述'}
   - 行动层表现：预约/官网通路${samples.some((s) => s.citations.some((c) => c.own)) ? '有内容承接' : '暂未打通'}
3. 竞品差距：${Object.keys(competitors).join('、') || '无'} —— 竞品在 AI 中的优势表现：第三方测评与榜单内容覆盖更全
4. 最扎眼的问题：${inaccurate > 0 ? 'AI 对品牌核心卖点描述不准确' : mentioned === 0 ? 'AI 尚未认识品牌，推荐名单中完全缺席' : '我方正式链接未被 AI 引用'}
5. 预设 3 个开场首问：
   - 认知水位问：您平时问 AI「${sampleQuestions[0].text}」这类问题时，期望看到什么？
   - 获客成本问：目前主要获客渠道及单客获取成本是多少？
   - 决策流程问：这类项目内部的决策流程与大致预算区间如何？
6. 下一步推进建议：${mentioned === 0 ? '先止血修错——补齐品牌事实信源，让 AI 认识并准确描述品牌' : '后铺设增量——铺设答案型内容争取精确收录'}（一句话明确首期重点）`;
    return insert('reports', {
      id: id(),
      projectId,
      type: 5,
      title: `AI 现状一页纸诊断：${project.brandName || project.name}`,
      content,
      relatedTaskIds: JSON.stringify([]),
      createdAt: nowIso(),
    });
  }

  throw new BizError('VALIDATION_ERROR', `未知报告类型：${type}`);
}

// ============ 口碑监测（真实能力：口碑问题模板 × 监测 Provider）============
export async function createReputationMonitor(projectId, { platforms = [1], mode = 2, scheduleDays } = {}) {
  const project = getProject(projectId);
  const templates = llm.reputationQuestions(project.brandName);
  const added = batchAddQuestions(projectId, {
    items: templates.map((text) => ({ text, category: 6, stage: 2, priority: 1, source: '口碑监测' })),
  });
  const qids = q(
    `SELECT id FROM questions WHERE projectId=? AND source='口碑监测'`,
    projectId
  ).map((r) => r.id);
  if (!qids.length) throw new BizError('CONFLICT', '口碑问题创建失败');
  const { task, checkpoints } = await createMonitorTask(projectId, {
    questionIds: qids,
    platforms: platforms.map(Number).filter((x) => x >= 1 && x <= 5),
    mode: Number(mode),
    scheduleDays: Number(mode) === 2 ? scheduleDays || [3, 7, 14] : [],
    runNow: true,
  });
  return { added, task, checkpoints, questionCount: qids.length };
}

// 负面信号词表（口碑报告聚合用）
const NEGATIVE_WORDS = ['投诉', '差评', '维权', '退款', '跑路', '暴雷', '避坑', '骗', '风险', '违规', '翻车', '失效', '不推荐', '慎选'];

export function reputationReport(projectId, taskId) {
  const project = getProject(projectId);
  let results;
  if (taskId) {
    results = q('SELECT * FROM monitorResults WHERE taskId=?', taskId);
  } else {
    results = q(
      `SELECT r.* FROM monitorResults r JOIN monitorTasks t ON r.taskId=t.id
       JOIN questions qs ON r.questionId=qs.id
       WHERE r.projectId=? AND qs.source='口碑监测' ORDER BY r.ranAt DESC`,
      projectId
    );
  }
  if (!results.length) throw new BizError('CONFLICT', '没有口碑监测结果：先在「口碑监测」页创建口碑任务');
  const freq = {};
  const quotes = [];
  let negCount = 0;
  for (const r of results) {
    const text = String(r.answerText || '');
    const hits = NEGATIVE_WORDS.filter((w) => text.includes(w));
    for (const w of hits) freq[w] = (freq[w] || 0) + 1;
    if (hits.length) {
      negCount++;
      if (quotes.length < 5) {
        const idx = text.search(new RegExp(hits.join('|')));
        quotes.push(`[${label('aiPlatform', r.platform)}] …${text.slice(Math.max(0, idx - 30), idx + 50).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  const citations = {};
  for (const r of results) {
    for (const c of parseJsonSafe(r.citations, [])) {
      if (c && c.url) citations[c.url] = (citations[c.url] || 0) + 1;
    }
  }
  const topCite = Object.entries(citations).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `# 口碑监测摘要 —— ${project.brandName}

**监测样本：** ${results.length} 条口碑类问题回答
**含负面信号：** ${negCount} 条（${results.length ? Math.round((negCount / results.length) * 100) : 0}%）

## 负面信号词频次
| 词 | 次数 |
|---|---|
${Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n') || '| （未检出） | 0 |'}

## 负面语境摘录（人工复核用）
${quotes.map((q) => '- ' + q).join('\n') || '- 未检出负面语境'}

## 被引用最多的来源（可信度参考）
${topCite.map(([u, n]) => `- ${u}（${n} 次）`).join('\n') || '- 无'}

## 下一步
${negCount > 0 ? '1. 对每条负面语境人工核实（截图留证）；2. 若属实→知识库补正面证据+客服话术；3. 若不实→准备澄清内容发布到同一批信源；4. 第 3/7/14 天复测负面占比。' : '未检出负面信号：保持周期复测（3/7/14 天），关注新增差评。'}`;
}

// ============ 事件通知（终局-C：org 级 Webhook，复用安全模式）============
function notifyOrg(orgId, event, data) {
  try {
    const org = q1('SELECT notifyWebhook, notifyEvents FROM orgs WHERE id=?', orgId);
    if (!org?.notifyWebhook) return;
    const events = parseJsonSafe(org.notifyEvents, ['monitor.done', 'publish.done']);
    if (!events.includes(event)) return;
    const payload = JSON.stringify({ event, orgId, at: nowIso(), data });
    fetch(org.notifyWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    }).then((r) => {
      if (!r.ok) console.warn(`[notify] ${event} 回执 HTTP ${r.status}`);
    }).catch((e) => console.warn(`[notify] ${event} 推送失败:`, e.message));
  } catch (e) {
    console.warn('[notify]', e.message);
  }
}

// ============ 后台任务系统（v1.6：LLM 操作异步化）============
// 原理：POST 提交 → 立即返回 jobId + redirectUrl → 后台执行 → 前端轮询 → 完成后跳转
export function createJob(type, input, orgId) {
  const jobId = id();
  insert('jobs', { id: jobId, type, status: 'pending', input: JSON.stringify(input), result: null, error: null, redirectUrl: null, orgId: orgId || null, createdAt: nowIso(), completedAt: null });
  // 后台执行（setImmediate 让当前请求先返回）
  setImmediate(() => processJob(jobId));
  return jobId;
}

async function processJob(jobId) {
  const job = q1('SELECT * FROM jobs WHERE id=?', jobId);
  if (!job || job.status !== 'pending') return;
  run('UPDATE jobs SET status=? WHERE id=?', 'processing', jobId);
  try {
    const input = JSON.parse(job.input || '{}');
    let result = {};
    let redirectUrl = '';
    if (job.type === 'content.create') {
      const article = await createContent(input.projectId, { questionId: input.questionId, type: input.type, aiDeclaration: 1 });
      result = { articleId: article.id, title: article.title };
      redirectUrl = '/articles/' + article.id;
    } else if (job.type === 'kb.organize') {
      const kbResult = await organizeKnowledge(input.projectId, { type: input.type || 1, raw: input.raw });
      result = { docs: kbResult.docs.length };
      redirectUrl = '/projects/' + input.projectId + '/kb?type=' + (input.type || 1);
    } else if (job.type === 'questions.generate') {
      const r = input.mode === '40' ? await simplifyTo40(input.projectId) : await generateQuestions(input.projectId);
      result = { mode: input.mode };
      redirectUrl = '/projects/' + input.projectId + '/questions';
    } else if (job.type === 'monitor.create') {
      const mon = await createMonitorTask(input.projectId, input);
      result = { taskId: mon.task.id };
      redirectUrl = '/projects/' + input.projectId + '/monitor';
    } else if (job.type === 'auto-geo') {
      const { autoGeo } = await import('./auto-geo.js');
      const r = await autoGeo(input.userId, input.userEmail, input.rawContent, {});
      result = { projectId: r.projectId };
      redirectUrl = '/projects/' + r.projectId;
    }
    run('UPDATE jobs SET status=?, result=?, redirectUrl=?, completedAt=? WHERE id=?', 'completed', JSON.stringify(result), redirectUrl, nowIso(), jobId);
  } catch (e) {
    run('UPDATE jobs SET status=?, error=?, completedAt=? WHERE id=?', 'failed', e.message, nowIso(), jobId);
  }
}

export function getJob(jobId) {
  return q1('SELECT id, type, status, result, error, redirectUrl FROM jobs WHERE id=?', jobId);
}

// ============ 订阅与卡密（终局-A：无需支付接口的收款闭环）============
export const PLANS = {
  trial: { name: '体验版', durationDays: 7, monitorQuotaMonthly: 50, maxMembers: 2, maxProjects: 1 },
  basic: { name: '基础版', durationDays: 30, monitorQuotaMonthly: 500, maxMembers: 3, maxProjects: 3 },
  pro: { name: '专业版', durationDays: 30, monitorQuotaMonthly: 2000, maxMembers: 10, maxProjects: 10 },
};

// 生成卡密（管理员）
export function generateLicenseKeys(planCode, count = 1, note = '') {
  const plan = PLANS[planCode];
  if (!plan) throw new BizError('VALIDATION_ERROR', `未知套餐：${planCode}`);
  const n = Math.max(1, Math.min(Number(count) || 1, 100));
  const keys = [];
  for (let i = 0; i < n; i++) {
    const key = `GEO-${planCode.toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    insert('licenseKeys', { key, planCode, status: 'unused', usedByOrg: null, usedAt: null, note, createdAt: nowIso() });
    keys.push(key);
  }
  return keys;
}

// 兑换卡密（组织所有者）
export function redeemLicenseKey(orgId, userId, key) {
  const k = String(key || '').trim().toUpperCase();
  const row = q1('SELECT * FROM licenseKeys WHERE key=?', k);
  if (!row) throw new BizError('NOT_FOUND', '卡密不存在');
  if (row.status === 'used') throw new BizError('CONFLICT', '卡密已被使用');
  if (row.status === 'revoked') throw new BizError('CONFLICT', '卡密已作废');
  const plan = PLANS[row.planCode];
  const base = row.usedByOrg === orgId && q1('SELECT planExpiresAt FROM orgs WHERE id=?', orgId)?.planExpiresAt
    ? new Date(q1('SELECT planExpiresAt FROM orgs WHERE id=?', orgId).planExpiresAt) // 续费叠加
    : new Date();
  const expires = new Date(base.getTime() + plan.durationDays * 86400_000).toISOString();
  run(`UPDATE orgs SET planCode=?, planExpiresAt=?, quotaMonitorMonthly=? WHERE id=?`, row.planCode, expires, plan.monitorQuotaMonthly, orgId);
  run(`UPDATE licenseKeys SET status='used', usedByOrg=?, usedAt=? WHERE key=?`, orgId, nowIso(), k);
  audit(userId, '', 'license.redeem', `${row.planCode} → ${k}`, '');
  return { planCode: row.planCode, planName: plan.name, planExpiresAt: expires, monitorQuotaMonthly: plan.monitorQuotaMonthly };
}

// ============ Open Key ============
export function createOpenKey(userId, { name, authorizedProjectIds = [] }) {
  const key = `gk-${crypto.randomBytes(24).toString('hex')}`;
  const row = {
    id: id(),
    userId,
    name: name || '默认密钥',
    keyPrefix: key.slice(0, 11),
    keyHash: sha256(key),
    authorizedProjectIds: JSON.stringify(authorizedProjectIds),
    boundDeviceId: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: nowIso(),
  };
  insert('openKeys', row);
  return { row, key }; // 明文只返回这一次
}

export function bindKeyDevice(keyHash, deviceId) {
  const key = q1('SELECT * FROM openKeys WHERE keyHash=?', keyHash);
  if (!key) throw new BizError('AUTH_REQUIRED', '密钥无效');
  if (key.revokedAt) throw new BizError('AUTH_REQUIRED', '密钥已吊销');
  if (key.boundDeviceId && key.boundDeviceId !== deviceId) {
    throw new BizError('DEVICE_MISMATCH', '密钥已绑定其他设备');
  }
  if (!key.boundDeviceId) run('UPDATE openKeys SET boundDeviceId=? WHERE id=?', deviceId, key.id);
  return q1('SELECT * FROM openKeys WHERE id=?', key.id);
}

export function revokeOpenKey(userId, keyId) {
  const key = q1('SELECT * FROM openKeys WHERE id=? AND userId=?', keyId, userId);
  if (!key) throw new BizError('NOT_FOUND', '密钥不存在');
  run('UPDATE openKeys SET revokedAt=? WHERE id=?', nowIso(), keyId);
  return { revoked: keyId };
}
