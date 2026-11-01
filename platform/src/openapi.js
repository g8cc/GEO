// Open API（/api/open/v1）：
// - 统一包络：{ ok, code, data } / { ok:false, code, message, nextAction? }
// - read 能力直接 call；write 能力必须 plan →（用户确认）→ apply，没有例外
// - 编码字段成对返回 *Label；展示用 Label，过滤和程序判断用数值
// - 所有列表默认每页 20 条、最多 100 条
import { q, q1, run, insert } from './db.js';
import { id, nowIso, parseJsonSafe } from './util.js';
import { withLabels, withRowLabels } from './enums.js';
import { authOpenKey } from './auth.js';
import { audit } from './db.js';
import * as svc from './services.js';
import { GUIDES } from './guides.js';
import { guideList } from './guides.js';

const PLAN_TTL_MIN = 30;

function ok(data) {
  return { ok: true, code: 'OK', data };
}
function fail(code, message, nextAction) {
  const out = { ok: false, code, message };
  if (nextAction) out.nextAction = nextAction;
  return out;
}

function capError(message, nextAction) {
  const e = new Error(message);
  e.code = 'CAPABILITY_ERROR';
  e.nextAction = nextAction;
  return e;
}

// —— 能力注册表 ——
// mode: read | write。write 必须走 plan/apply。
export const CAPABILITIES = {
  'projects.list': {
    kind: 'project',
    mode: 'read',
    guide: 'project',
    summary: '列出当前密钥已授权的 GEO 项目',
    exec(ctx) {
      return svc.listProjects(ctx.userId, ctx.authorizedProjectIds);
    },
  },
  'projects.create': {
    kind: 'project',
    mode: 'write',
    guide: 'project',
    summary: (i) => `创建 GEO 项目「${i.name}」（公司 ${i.companyId}），并自动就绪品牌/产品两个知识库`,
    async exec(ctx, i) {
      return svc.createProject(ctx.userId, i);
    },
  },
  'projects.update': {
    kind: 'project',
    mode: 'write',
    guide: 'project',
    summary: (i) => `更新 GEO 项目 ${i.projectId} 的：${Object.keys(i).filter((k) => k !== 'projectId').join('、') || '（无字段）'}`,
    exec(ctx, i) {
      return svc.updateProject(ctx.userId, i);
    },
  },
  'questions.list': {
    kind: 'question',
    mode: 'read',
    guide: 'question',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      const rows = q('SELECT * FROM questions WHERE projectId=? ORDER BY priority, createdAt LIMIT ?', i.projectId, limit);
      return rows;
    },
  },
  'questions.create': {
    kind: 'question',
    mode: 'write',
    guide: 'question',
    summary: (i) => `在项目 ${i.projectId} 新增问题「${(i.text || '').slice(0, 30)}」`,
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.addQuestion(i.projectId, i);
    },
  },
  'questions.batchCreate': {
    kind: 'question',
    mode: 'write',
    guide: 'question',
    summary: async (i, ctx) => {
      requireProject(ctx, i);
      const items = i.items || [];
      let dup = 0;
      for (const item of items) {
        if (q1('SELECT id FROM questions WHERE projectId=? AND text=?', i.projectId, String(item.text || '').trim())) dup++;
      }
      return `批量导入 ${items.length} 条问题：将新增 ${items.length - dup} 条，已存在跳过 ${dup} 条，重复/空值跳过以实际执行为准（整体导入，不追加到已有集合之外另有说明）`;
    },
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.batchAddQuestions(i.projectId, i);
    },
  },
  'questions.generate': {
    kind: 'question',
    mode: 'write',
    guide: 'question-task',
    summary: (i) => `在项目 ${i.projectId} 按方法论生成 ${i.mode === '40' ? '40 问结构' : '50 个搜索问题'} 并导入问题库`,
    async exec(ctx, i) {
      requireProject(ctx, i);
      return i.mode === '40' ? svc.simplifyTo40(i.projectId) : svc.generateQuestions(i.projectId);
    },
  },
  'questions.update': {
    kind: 'question',
    mode: 'write',
    guide: 'question',
    summary: (i) => `更新问题 ${i.questionId} 的：${Object.keys(i).filter((k) => k !== 'questionId').join('、') || '（无字段）'}`,
    exec(ctx, i) {
      return svc.updateQuestion(i);
    },
  },
  'knowledge.list': {
    kind: 'kb',
    mode: 'read',
    guide: 'knowledge',
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.listKbDocs(i.projectId, i.type ?? 1);
    },
  },
  'knowledge.uploadDoc': {
    kind: 'kb',
    mode: 'write',
    guide: 'knowledge',
    summary: (i) => `向项目 ${i.projectId} 的${i.type === 2 ? '产品' : '品牌'}知识库上传文档「${i.title}」（模块 ${i.module ?? 2}）`,
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.uploadKbDoc(i.projectId, i);
    },
  },
  'knowledge.organize': {
    kind: 'kb',
    mode: 'write',
    guide: 'knowledge',
    summary: (i) => `对项目 ${i.projectId} 的${i.type === 2 ? '产品' : '品牌'}知识库执行六模块标准化整理（含 QA 索引与口径冲突清单）`,
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.organizeKnowledge(i.projectId, i);
    },
  },
  'articles.list': {
    kind: 'article',
    mode: 'read',
    guide: 'article',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM articles WHERE projectId=? ORDER BY createdAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'articles.get': {
    kind: 'article',
    mode: 'read',
    guide: 'article',
    exec(ctx, i) {
      const a = q1('SELECT * FROM articles WHERE id=?', i.articleId);
      if (!a) throw capError('文章不存在');
      requireProject(ctx, { projectId: a.projectId });
      return a;
    },
  },
  'articles.create': {
    kind: 'article',
    mode: 'write',
    guide: 'article-task',
    summary: async (i, ctx) => {
      const question = q1('SELECT text FROM questions WHERE id=?', i.questionId);
      const typeName = { 1: 'AI 答案卡', 2: '品牌优化文章', 3: '产品推荐文章' }[Number(i.type)] || '文章';
      return `基于问题「${question?.text ?? i.questionId}」创作${typeName}，并生成封面配图（文章进入平台后状态为「已上传」）`;
    },
    async exec(ctx, i) {
      const question = q1('SELECT * FROM questions WHERE id=?', i.questionId);
      if (!question) throw capError('问题不存在：articles.create 需要有效 questionId');
      requireProject(ctx, { projectId: question.projectId });
      return svc.createContent(question.projectId, i);
    },
  },
  'articles.update': {
    kind: 'article',
    mode: 'write',
    guide: 'article',
    summary: (i) => `更新文章 ${i.articleId} 的：${Object.keys(i).filter((k) => k !== 'articleId').join('、') || '（无字段）'}`,
    exec(ctx, i) {
      const a = q1('SELECT * FROM articles WHERE id=?', i.articleId);
      if (!a) throw capError('文章不存在');
      requireProject(ctx, { projectId: a.projectId });
      return svc.updateArticle(i);
    },
  },
  'articles.delete': {
    kind: 'article',
    mode: 'write',
    guide: 'article',
    summary: (i) => `删除文章 ${i.articleId}。删除是唯一不可逆的操作：删掉的内容找不回来，已关联的审核记录一并删除`,
    exec(ctx, i) {
      const a = q1('SELECT * FROM articles WHERE id=?', i.articleId);
      if (!a) throw capError('文章不存在');
      requireProject(ctx, { projectId: a.projectId });
      return svc.deleteArticle(i.articleId);
    },
  },
  'articles.audit': {
    kind: 'article',
    mode: 'write',
    guide: 'article',
    summary: (i) => `对文章 ${i.articleId} 执行三道关审核（知识库一致性 / 媒体投稿标准 / GEO 相关性与可信度），生成审核记录`,
    exec(ctx, i) {
      const a = q1('SELECT * FROM articles WHERE id=?', i.articleId);
      if (!a) throw capError('文章不存在');
      requireProject(ctx, { projectId: a.projectId });
      return svc.auditArticle(i.articleId, ctx.keyRow?.name || 'Open API');
    },
  },
  'materials.list': {
    kind: 'material',
    mode: 'read',
    guide: 'material',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM materials WHERE projectId=? ORDER BY createdAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'materials.upload': {
    kind: 'material',
    mode: 'write',
    guide: 'material',
    summary: (i) => `向项目 ${i.projectId} 上传素材「${i.name || '未命名'}」并取得 URL`,
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.uploadMaterial(i.projectId, i);
    },
  },
  'accounts.list': {
    kind: 'account',
    mode: 'read',
    guide: 'publication',
    exec(ctx, i) {
      requireProject(ctx, i);
      return q('SELECT * FROM publishAccounts WHERE projectId=?', i.projectId);
    },
  },
  'publishTasks.create': {
    kind: 'publishTask',
    mode: 'write',
    guide: 'publication',
    summary: async (i, ctx) => {
      const a = q1('SELECT title FROM articles WHERE id=?', i.articleId);
      const acc = i.accountId ? q1('SELECT accountName FROM publishAccounts WHERE id=?', i.accountId) : null;
      return `为文章「${a?.title ?? i.articleId}」创建发布任务：平台=${i.platform}，账号=${acc?.accountName ?? '未指定'}。创建后状态为「已创建」，需人工确认预览、账号、素材、链接后才进入发布；任务排队不等于任务完成`;
    },
    exec(ctx, i) {
      const a = q1('SELECT * FROM articles WHERE id=?', i.articleId);
      if (!a) throw capError('文章不存在');
      requireProject(ctx, { projectId: a.projectId });
      return svc.createPublishTask(a.projectId, i);
    },
  },
  'publishTasks.confirm': {
    kind: 'publishTask',
    mode: 'write',
    guide: 'publication',
    summary: (i) => `确认发布任务 ${i.taskId} 的预览、账号、素材与链接，开始发布（异步；完成后可回查 publishedUrl）`,
    exec(ctx, i) {
      const t = q1('SELECT * FROM publishTasks WHERE id=?', i.taskId);
      if (!t) throw capError('发布任务不存在');
      requireProject(ctx, { projectId: t.projectId });
      return svc.confirmPublishTask(i.taskId);
    },
  },
  'publishTasks.list': {
    kind: 'publishTask',
    mode: 'read',
    guide: 'publication',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM publishTasks WHERE projectId=? ORDER BY createdAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'publishTasks.get': {
    kind: 'publishTask',
    mode: 'read',
    guide: 'publication',
    exec(ctx, i) {
      const t = q1('SELECT * FROM publishTasks WHERE id=?', i.taskId);
      if (!t) throw capError('发布任务不存在');
      requireProject(ctx, { projectId: t.projectId });
      return t;
    },
  },
  'publishTasks.markPublished': {
    kind: 'publishTask',
    mode: 'write',
    guide: 'publication',
    summary: (i) => `手动发布回填：将发布任务 ${i.taskId} 标记为已正式发布，登记真实正式链接 ${i.publishedUrl}（渠道无公开 API 时使用；链接将参与真实监测的 exact_url_hit 判定）`,
    exec(ctx, i) {
      const t = q1('SELECT * FROM publishTasks WHERE id=?', i.taskId);
      if (!t) throw capError('发布任务不存在');
      requireProject(ctx, { projectId: t.projectId });
      return svc.markPublishedTask(i);
    },
  },
  'monitorTasks.create': {
    kind: 'monitorTask',
    mode: 'write',
    guide: 'scheduled-monitor',
    summary: (i) => `创建上榜监测任务：${(i.questionIds || []).length} 个问题 × ${(i.platforms || [1]).length} 个 AI 平台，模式=${i.mode === 2 ? `周期复测（第 ${(i.scheduleDays || []).join('/')} 天）` : '一次性'}。第 0 天立即执行，保存完整 AI 回答与引用来源`,
    async exec(ctx, i) {
      const first = q1('SELECT * FROM questions WHERE id=?', (i.questionIds || [])[0]);
      if (!first) throw capError('问题不存在：monitorTasks.create 需要有效 questionIds');
      requireProject(ctx, { projectId: first.projectId });
      return svc.createMonitorTask(first.projectId, i);
    },
  },
  'monitorTasks.list': {
    kind: 'monitorTask',
    mode: 'read',
    guide: 'scheduled-monitor',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'monitorTasks.get': {
    kind: 'monitorTask',
    mode: 'read',
    guide: 'scheduled-monitor',
    exec(ctx, i) {
      const t = q1('SELECT * FROM monitorTasks WHERE id=?', i.taskId);
      if (!t) throw capError('监测任务不存在');
      requireProject(ctx, { projectId: t.projectId });
      const checkpoints = q('SELECT * FROM monitorCheckpoints WHERE taskId=? ORDER BY day', t.id);
      return { ...t, checkpoints };
    },
  },
  'monitorTasks.runNext': {
    kind: 'monitorTask',
    mode: 'write',
    guide: 'scheduled-monitor',
    summary: (i) => `执行监测任务 ${i.taskId} 的下一个到期检查点（复测；若无待执行检查点则报错）`,
    async exec(ctx, i) {
      const t = q1('SELECT * FROM monitorTasks WHERE id=?', i.taskId);
      if (!t) throw capError('监测任务不存在');
      requireProject(ctx, { projectId: t.projectId });
      return await svc.forceRunNextCheckpoint(i.taskId);
    },
  },
  'monitorResults.list': {
    kind: 'monitorResult',
    mode: 'read',
    guide: 'indexing-query',
    exec(ctx, i) {
      const task = i.taskId ? q1('SELECT * FROM monitorTasks WHERE id=?', i.taskId) : null;
      if (i.taskId) {
        if (!task) throw capError('监测任务不存在');
        requireProject(ctx, { projectId: task.projectId });
        return q('SELECT * FROM monitorResults WHERE taskId=? ORDER BY ranAt', i.taskId);
      }
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM monitorResults WHERE projectId=? ORDER BY ranAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'monitorResults.reverse': {
    kind: 'monitorResult',
    mode: 'write',
    guide: 'indexing-query',
    summary: (i) => `逆向分析：对问题「${(i.question || '').slice(0, 30)}」在指定平台重复提问 ${i.times || 10} 次，保存每次原始回答并生成逆向分析报告`,
    async exec(ctx, i) {
      const rows = q('SELECT * FROM projects WHERE id=?', i.projectId);
      if (!rows.length) throw capError('项目不存在');
      requireProject(ctx, { projectId: i.projectId });
      return await svc.runReverseAnalysis(i.projectId, i);
    },
  },
  'reputation.create': {
    kind: 'monitorTask',
    mode: 'write',
    guide: 'scheduled-monitor',
    summary: (i) => `创建口碑监测任务：自动生成 8 个口碑探测问题（靠谱吗/投诉/差评/维权/跑路/避坑…，风险判断类）× ${(i.platforms || [1]).length} 个 AI 平台，并立即执行首轮`,
    async exec(ctx, i) {
      requireProject(ctx, i);
      return await svc.createReputationMonitor(i.projectId, i);
    },
  },
  'auto-geo.run': {
    kind: 'project',
    mode: 'write',
    guide: 'project',
    summary: (i) => `一键 GEO：从项目描述自动创建公司、知识库、问题池、内容、监测（AI 全自动）`,
    async exec(ctx, i) {
      if (!i.profile || i.profile.length < 50) throw capError('profile 内容太短（至少 50 字）');
      const { autoGeo } = await import('./auto-geo.js');
      return await autoGeo(ctx.keyUserId, ctx.keyUserId, i.profile, i);
    },
  },
  'sources.list': {
    kind: 'sourceAsset',
    mode: 'read',
    guide: 'sources',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 50);
      return q('SELECT * FROM sourceAssets WHERE projectId=? ORDER BY updatedAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'sources.collect': {
    kind: 'sourceAsset',
    mode: 'write',
    guide: 'sources',
    summary: (i) => `从${i.taskId ? `监测任务 ${i.taskId}` : '全部监测结果'}提取真实引用来源，沉淀为引用源资产库（已引用/潜在/可投放/观察四状态）`,
    exec(ctx, i) {
      if (i.taskId) {
        const t = q1('SELECT * FROM monitorTasks WHERE id=?', i.taskId);
        if (!t) throw capError('监测任务不存在');
        requireProject(ctx, { projectId: t.projectId });
      } else {
        requireProject(ctx, i);
      }
      return svc.collectSourceAssets(i.projectId, i.taskId);
    },
  },
  'sources.upsert': {
    kind: 'sourceAsset',
    mode: 'write',
    guide: 'sources',
    summary: (i) => (i.id ? `更新信源资产 ${i.id} 的：${Object.keys(i).filter((k) => k !== 'id').join('、')}` : `新增信源资产「${(i.articleTitle || '').slice(0, 30)}」（${i.url}）`),
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.upsertSourceAsset(i.projectId, i);
    },
  },
  'reports.create': {
    kind: 'report',
    mode: 'write',
    guide: 'report',
    summary: (i) => `生成报告：type=${i.type}（1品牌诊断 2产品推荐诊断 3优化前后对比 4逆向分析 5一页纸诊断 6口碑监测摘要）`,
    async exec(ctx, i) {
      if (i.projectId) requireProject(ctx, { projectId: i.projectId });
      else {
        // 诊断类允许不传 projectId：取密钥授权的第一个项目
        const pid = ctx.authorizedProjectIds[0];
        if (!pid) throw capError('密钥未授权任何项目');
        i.projectId = pid;
      }
      return await svc.createReport(i.projectId, i);
    },
  },
  'reports.list': {
    kind: 'report',
    mode: 'read',
    guide: 'report',
    exec(ctx, i) {
      requireProject(ctx, i);
      const limit = pageLimit(i, 20);
      return q('SELECT * FROM reports WHERE projectId=? ORDER BY createdAt DESC LIMIT ?', i.projectId, limit);
    },
  },
  'reports.get': {
    kind: 'report',
    mode: 'read',
    guide: 'report',
    exec(ctx, i) {
      const r = q1('SELECT * FROM reports WHERE id=?', i.reportId);
      if (!r) throw capError('报告不存在');
      requireProject(ctx, { projectId: r.projectId });
      return r;
    },
  },
  'preflight.check': {
    kind: 'preflight',
    mode: 'read',
    guide: 'article',
    summary: '创作前输入检查（文档二 3.1）：已具备 / 待补充 / 不可使用',
    exec(ctx, i) {
      requireProject(ctx, i);
      return svc.preflight(i.projectId, i.questionId);
    },
  },
};


// 审计 R1：分页下限保护——SQLite 对负数 LIMIT 视为不限制，必须钳制到 [1,100]
function pageLimit(i, dflt = 20) {
  const n = Math.floor(Number(i?.limit) || dflt);
  return Math.max(1, Math.min(n, 100));
}

function requireProject(ctx, input) {
  const pid = input?.projectId;
  if (!pid) throw capError('缺少 projectId。不要猜：通过 projects.list 读取已授权项目，让用户选择', {
    type: 'ask_user',
    message: '请先选择一个 GEO 项目（projects.list）',
  });
  if (ctx.authorizedProjectIds && !ctx.authorizedProjectIds.includes(pid)) {
    const e = capError(`密钥未授权项目 ${pid}。让用户在「密钥管理」中编辑该密钥授权的项目，改完立即生效，不需要重新登录`, {
      type: 'ask_user',
      message: `请在 GEO 平台「系统设置 → Open Key」编辑当前密钥，勾选项目 ${pid}`,
    });
    throw e;
  }
  ctx.userId = ctx.keyUserId; // openkey 创建者
}

// —— 请求处理 ——
export async function handleOpenApi(req, res, pathname, body) {
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };

  // 密钥绑定（登录流程）：POST /api/open/v1/auth/verify {key, deviceId}
  if (pathname === '/api/open/v1/auth/verify') {
    const { sha256 } = await import('./auth.js');
    const keyHash = sha256(String(body.key || ''));
    try {
      const key = svc.bindKeyDevice(keyHash, String(body.deviceId || ''));
      const projects = q(
        `SELECT p.id, p.name FROM projects p WHERE p.id IN (${(parseJsonSafe(key.authorizedProjectIds, []) || [])
          .map(() => '?')
          .join(',') || "''"})`,
        ...parseJsonSafe(key.authorizedProjectIds, [])
      );
      return send(ok({ bound: true, keyId: key.id, projects, total: projects.length }));
    } catch (e) {
      return send(fail(e.code || 'AUTH_REQUIRED', e.message), 200);
    }
  }

  // guide（CLI 按需读取一份，不要一次全读）
  if (pathname === '/api/open/v1/guide/list') {
    return send(ok({ guides: guideList(), note: '按实际需求读取一个 guide；能力的 guide 字段就是指南名' }));
  }
  const gm = pathname.match(/^\/api\/open\/v1\/guide\/get\/(.+)$/);
  if (gm) {
    const g = GUIDES[gm[1]];
    if (!g) return send(fail('NOT_FOUND', `指南不存在：${gm[1]}。以 guide list 输出为准`));
    return send(ok({ name: gm[1], title: g.title, body: g.body }));
  }

  // 认证
  const auth = authOpenKey(req);
  if (!auth.ok) return send(fail(auth.code, auth.message));

  // 一键 GEO（专用端点：CLI geo scan 调用）
  if (pathname === '/api/open/v1/auto-geo') {
    if (req.method !== 'POST') return send(fail('METHOD_NOT_ALLOWED', 'POST only'));
    const profile = String(body.profile || '');
    if (profile.length < 50) return send(fail('VALIDATION_ERROR', 'profile 内容太短（至少 50 字）'));
    try {
      const { autoGeo } = await import('./auto-geo.js');
      const result = await autoGeo(auth.key.userId, auth.key.userId, profile, body);
      return send(ok(result));
    } catch (e) {
      if (e instanceof svc.BizError) return send(fail(e.code || 'CAPABILITY_ERROR', e.message));
      console.error('[auto-geo]', e);
      return send(fail('INTERNAL', e.message));
    }
  }

  const ctx = {
    keyRow: auth.key,
    authorizedProjectIds: auth.authorizedProjectIds,
    keyUserId: auth.key.userId,
    userId: auth.key.userId,
  };

  const m = pathname.match(/^\/api\/open\/v1\/(call|plan|apply)\/?([^/]*)$/);
  if (!m) return send(fail('NOT_FOUND', `未知路径 ${pathname}；能力以 capabilities 输出为准`), 404);
  const [, verb, capName] = m;

  if (verb === 'call' && !capName) {
    // 能力清单
    const caps = Object.entries(CAPABILITIES).map(([name, c]) => ({
      name,
      mode: c.mode,
      guide: c.guide,
      description: GUIDES[c.guide]?.title || '',
    }));
    return send(ok({ capabilities: caps, version: '1.6.0' }));
  }

  // apply：URL 参数是 planId，不是能力名。
  // 审计修复 P0-5：先用原子 UPDATE 占用计划（防并发双 apply 双写），占用成功才执行业务。
  if (verb === 'apply') {
    const claimed = run(
      'UPDATE plans SET usedAt=? WHERE id=? AND usedAt IS NULL AND expiresAt > ?',
      nowIso(),
      capName,
      nowIso()
    );
    if (claimed.changes === 0) {
      const plan = q1('SELECT * FROM plans WHERE id=?', capName);
      if (!plan) return send(fail('PLAN_NOT_FOUND', `计划不存在：${capName}`));
      if (plan.usedAt) {
        return send(fail('PLAN_USED', '该计划已执行过。apply 返回后不要重复执行；网络重试拿到的是第一次的结果，不会重复写入'));
      }
      return send(
        fail('PLAN_EXPIRED', '计划已失效（超过 30 分钟或数据在确认期间被改过）。重新 plan、把新摘要再给用户确认一次，不要拿旧 planId 重试', {
          type: 'plan_first',
          command: `geo plan ${plan.capability}`,
        })
      );
    }
    const plan = q1('SELECT * FROM plans WHERE id=?', capName);
    const cap2 = CAPABILITIES[plan.capability];
    try {
      const data = await cap2.exec(ctx, JSON.parse(plan.input));
      audit(ctx.keyUserId, `openkey:${ctx.keyRow.name}`, `openapi ${plan.capability}`, plan.summary.slice(0, 300), String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim());
      return send(ok({ planId: plan.id, capability: plan.capability, applied: true, data: wrapData(data, cap2.kind) }));
    } catch (e) {
      // 执行失败回滚占用，允许重新 apply（数据未变更）
      run('UPDATE plans SET usedAt=NULL WHERE id=?', capName);
      if (e.code === 'CAPABILITY_ERROR' || e instanceof svc.BizError) {
        return send(fail(e.code || 'CAPABILITY_ERROR', e.message, e.nextAction));
      }
      console.error('[openapi:apply]', e);
      return send(fail('INTERNAL', e.message));
    }
  }

  const cap = CAPABILITIES[capName];
  if (!cap) return send(fail('NOT_FOUND', `未知能力：${capName}。先调用 capabilities 获取能力清单`, { type: 'ask_user', command: 'geo capabilities' }));

  const input = body.input || {};

  try {
    if (verb === 'call') {
      if (cap.mode === 'write') {
        return send(
          fail(
            'WRITE_REQUIRES_PLAN',
            `${capName} 是写操作：必须先 plan（生成变更摘要），用户明确同意后 apply。没有例外。`,
            { type: 'plan_first', command: `geo plan ${capName} --input '${JSON.stringify(input)}'` }
          )
        );
      }
      const data = await cap.exec(ctx, input);
      return send(ok(wrapData(data, cap.kind)));
    }

    if (verb === 'plan') {
      const summary = typeof cap.summary === 'function' ? await cap.summary(input, ctx) : cap.summary;
      const planId = id();
      insert('plans', {
        id: planId,
        userId: ctx.userId,
        keyId: ctx.keyRow.id,
        capability: capName,
        input: JSON.stringify(input),
        summary,
        expiresAt: new Date(Date.now() + PLAN_TTL_MIN * 60000).toISOString(),
        usedAt: null,
        createdAt: nowIso(),
      });
      return send(ok({ planId, capability: capName, summary, expiresInMinutes: PLAN_TTL_MIN }));
    }
  } catch (e) {
    if (e.code === 'CAPABILITY_ERROR' || e instanceof svc.BizError) {
      return send(fail(e.code || 'CAPABILITY_ERROR', e.message, e.nextAction));
    }
    console.error('[openapi]', e);
    return send(fail('INTERNAL', e.message));
  }
}

function wrapData(data, kind) {
  if (Array.isArray(data)) return data.map((r) => (r && typeof r === 'object' ? withRowLabels(kind, r) : r));
  if (data && typeof data === 'object') {
    // 顶层对象先按行类型补 Label，再对数组/对象成员递归补 Label
    const out = withRowLabels(kind, data);
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v)) out[k] = v.map((r) => (r && typeof r === 'object' ? withRowLabels(kind, r) : r));
      else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = withRowLabels(kind, v);
    }
    return out;
  }
  return data;
}
