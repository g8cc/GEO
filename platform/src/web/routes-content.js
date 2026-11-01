// Web 路由：内容创作 / 文章管理 / 三道审核 / 资源中心 / 授权账号 / 内容发布 / 付费媒体
import { q, q1, run } from '../db.js';
import { nowIso, parseJsonSafe, e } from '../util.js';
import * as svc from '../services.js';
import { pageHead, card, table, badge, empty, emptyCta, sel, ENUMS, fmtTime as ft, safeUrl } from './ui.js';
import { ARTICLE_TYPE, ARTICLE_STATUS, PUBLISH_PLATFORM, PUBLISH_TASK_STATUS, ACCOUNT_TYPE, AUDIT_GATE } from '../enums.js';

export const contentRoutes = [];
function route(method, pattern, handler) {
  contentRoutes.push({ method, pattern, handler });
}

// ============ 内容创作 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/content$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const questions = q('SELECT * FROM questions WHERE projectId=? ORDER BY priority, createdAt DESC', p.id);
  const preflightQid = c.query.preflight;
  let preflightHtml = '';
  if (preflightQid) {
    const items = svc.preflight(p.id, preflightQid);
    preflightHtml = card('创作前输入检查（已具备 / 待补充 / 不可使用）', table(
      ['检查项', '结果', '说明'],
      items.map((i) => `<tr><td class="wrap">${e(i.item)}</td><td>${i.status === '已具备' ? badge('通过') : i.status === '不可使用' ? badge('不通过') : badge('待复测')}${` <span class="kv">${e(i.status)}</span>`}</td><td class="wrap kv">${e(i.detail)}</td></tr>`)
    ));
  }
  c.body =
    pageHead('内容创作', '三类内容资产：AI 答案卡（结论先行）/ 品牌优化文章（身份、能力、案例、证据、边界）/ 产品推荐文章（场景、条件、差异、限制、行动入口）') +
    card('选择问题与内容类型', questions.length ? `
      <form method="get" action="/projects/${p.id}/content">
        <div class="row">
          <div style="flex:2"><label class="f">目标问题 *</label>${sel('preflight', questions.map((x) => [x.id, x.text]), preflightQid, '— 选择问题 —')}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">创作前输入检查</button></div>
        </div>
      </form>
      <form method="post" action="/projects/${p.id}/content/create" style="margin-top:14px">
        <div class="row">
          <div style="flex:2"><label class="f">目标问题 *</label>${sel('questionId', questions.map((x) => [x.id, `${x.text}`]), '', '— 选择问题 —', true)}</div>
          <div><label class="f">内容类型 *</label>${sel('type', [[1, 'AI 答案卡'], [2, '品牌优化文章'], [3, '产品推荐文章']], '2')}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn">生成内容 + 封面</button></div>
        </div>
        <label class="f" style="font-weight:400;margin-top:10px"><input type="checkbox" name="aiDeclaration" value="1" checked style="width:auto"> 按《人工智能生成合成内容标识办法》在发布包中携带 AI 生成声明（推荐保持勾选）</label>
        <div class="kv" style="margin-top:8px">生成后进入「文章管理」完成三道审核，再创建发布任务。答案卡图片需按平台要求手动发布到抖音图文。</div>
      </form>` : '<div class="notice warn">请先在「问题拓展」建立问题库</div>') +
    preflightHtml;
  c.render('内容创作', 'content', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/content\/create$/, async (req, res, c) => {
  if (!c.body.questionId) {
    res.writeHead(302, { Location: `/projects/${c.params[0]}/content?e=${encodeURIComponent('请先选择一个目标问题')}` });
    return res.end();
  }
  const org = q1('SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?', c.params[0]);
  const jobId = svc.createJob('content.create', { projectId: c.params[0], questionId: c.body.questionId, type: Number(c.body.type) || 2 }, org?.orgId);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, jobId, redirectUrl: `/projects/${c.params[0]}/articles?job=${jobId}` }));
});

// ============ 文章管理 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/articles$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM articles WHERE projectId=? ORDER BY createdAt DESC', p.id);
  c.body =
    pageHead('文章管理', '状态机：已生成 → 已上传 → 已创建发布任务 → 已正式发布。文章 ID ≠ 已发布。') +
    (rows.length ? '' : emptyCta('还没有内容——去「内容创作」选一个问题生成第一篇文章（AI 答案卡 / 品牌文章 / 产品文章）', `/projects/${p.id}/content`)) +
    card('文章列表', table(['标题', '类型', '状态', '创建时间', ''], rows.map((r) => `
      <tr><td class="wrap"><a href="/articles/${r.id}"><b>${e(r.title)}</b></a></td>
      <td>${badge(ENUMS.ARTICLE_TYPE[r.type])}</td>
      <td>${badge(ENUMS.ARTICLE_STATUS[r.status])}</td>
      <td>${ft(r.createdAt)}</td>
      <td><a class="btn small" href="/articles/${r.id}">查看</a></td></tr>`)));
  c.render('文章管理', 'articles', p.id);
});

route('GET', /^\/articles\/([a-f0-9-]+)$/, async (req, res, c) => {
  const a = q1('SELECT * FROM articles WHERE id=?', c.params[0]);
  if (!a) return c.notFound();
  const p = svc.getProjectSafe(c.user.id, a.projectId);
  if (!p) return c.notFound();
  const audits = q('SELECT * FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC', a.id);
  const meta = parseJsonSafe(a.meta, {});
  const cover = a.coverMaterialId ? q1('SELECT * FROM materials WHERE id=?', a.coverMaterialId) : null;
  const publishTasks = q('SELECT * FROM publishTasks WHERE articleId=? ORDER BY createdAt DESC', a.id);
  c.body =
    pageHead(a.title, `${ENUMS.ARTICLE_TYPE[a.type]} · ${badge(ENUMS.ARTICLE_STATUS[a.status])}`, `<a class="btn ghost" href="/projects/${p.id}/articles">返回列表</a>`) +
    (cover ? card('封面配图', `<img src="${safeUrl(cover.url)}" style="max-width:420px;border-radius:10px;border:1px solid var(--line)">`) : '') +
    card('正文', `<div class="md-box md">${e(a.content)}</div>${meta.question ? `<div class="kv" style="margin-top:8px">目标问题：${e(meta.question)}</div>` : ''}`) +
    card('三道审核（知识库一致性 / 媒体投稿标准 / GEO 相关性与可信度）', `
      ${audits.length ? table(['时间', '第一关 知识库一致性', '第二关 媒体投稿标准', '第三关 GEO 相关性与可信度', '总体', '审核人'], audits.map((r) => `
        <tr><td>${ft(r.createdAt)}</td>
        <td>${badge(ENUMS.AUDIT_GATE[r.gate1])}<div class="kv wrap">${e(r.gate1Issues)}</div></td>
        <td>${badge(ENUMS.AUDIT_GATE[r.gate2])}<div class="kv wrap">${e(r.gate2Issues)}</div></td>
        <td>${badge(ENUMS.AUDIT_GATE[r.gate3])}<div class="kv wrap">${e(r.gate3Issues)}</div></td>
        <td>${badge(ENUMS.AUDIT_VERDICT ? ENUMS.AUDIT_VERDICT[r.verdict] : '')}</td>
        <td class="kv">${e(r.auditor)}</td></tr>`).join('')) : '<div class="empty">尚未审核</div>'}
      ${r3note(audits)}
      <form method="post" action="/articles/${a.id}/audit" style="margin-top:10px">
        <button class="btn">执行三道审核</button>
        <span class="kv">　任何一道不通过，都不应直接进入重点投放；事实缺口先回知识库补证。</span>
      </form>`) +
    card('发布记录', publishTasks.length ? table(['时间', '平台', '状态', '正式链接'], publishTasks.map((t) => `
      <tr><td>${ft(t.createdAt)}</td><td>${badge(ENUMS.PUBLISH_PLATFORM[t.platform])}</td>
      <td>${badge(ENUMS.PUBLISH_TASK_STATUS[t.status])}${t.failReason ? `<div class="kv">${e(t.failReason)}</div>` : ''}</td>
      <td>${t.publishedUrl ? `<a href="${safeUrl(t.publishedUrl)}" class="mono">${e(t.publishedUrl)}</a>` : '—'}</td></tr>`).join('')) : '<div class="empty">尚未创建发布任务</div>');
  c.render('文章详情', 'articles', p.id);
});

function r3note(audits) {
  const latest = audits[0];
  if (!latest) return '';
  if (latest.verdict === 2) return '<div class="notice">✅ 三道审核全部通过，可进入发布流程。</div>';
  return '<div class="notice warn">⚠️ 审核未全通过：事实缺口 → 回知识库补证；相关性不足 → 重写问题和答案结构；媒体标准不合格 → 按目标平台重新编辑。</div>';
}

route('POST', /^\/articles\/([a-f0-9-]+)\/audit$/, async (req, res, c) => {
  await svc.auditArticle(c.params[0], 'Web 手动审核');
  res.writeHead(302, { Location: `/articles/${c.params[0]}` });
  res.end();
});

// ============ 资源中心 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/materials$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM materials WHERE projectId=? ORDER BY createdAt DESC', p.id);
  c.body =
    pageHead('资源中心', '图片、视频与答案卡图组素材') +
    (rows.length ? '' : emptyCta('素材库为空——文章封面会自动存入这里；也可上传图片/视频', `javascript:void(0)`, '↑ 文章创作后自动生成')) +
    card('素材列表', table(['名称', '类型', '预览', '时间'], rows.map((r) => `
      <tr><td class="wrap">${e(r.name)}</td><td>${badge(ENUMS.MATERIAL_TYPE[r.type])}</td>
      <td>${r.type === 1 ? `<img src="${safeUrl(r.url)}" style="height:56px;border-radius:6px;border:1px solid var(--line)">` : `<a href="${safeUrl(r.url)}">${e(r.url)}</a>`}</td>
      <td>${ft(r.createdAt)}</td></tr>`)));
  c.render('资源中心', 'materials', p.id);
});

// ============ 授权账号 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/accounts$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM publishAccounts WHERE projectId=?', p.id);
  c.body =
    pageHead('授权账号', '发布账号与账号类型（mock 授权）。相同平台上企业号、媒体机构号、专家号和普通用户号，可信度、内容责任和可控性都可能不同。') +
    card('添加授权账号（mock）', `
      <form method="post" action="/projects/${p.id}/accounts/create" class="row">
        <div><label class="f">平台 *</label>${sel('platform', Object.entries(ENUMS.PUBLISH_PLATFORM).map(([k, v]) => [k, v]))}</div>
        <div style="flex:2"><label class="f">账号名称 *</label><input type="text" name="accountName" required></div>
        <div><label class="f">账号类型</label>${sel('accountType', Object.entries(ENUMS.ACCOUNT_TYPE).map(([k, v]) => [k, v]), 2)}</div>
        <div><label class="f">额度</label><input type="number" name="quota" value="10"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>`) +
    (rows.length ? '' : emptyCta('还没有授权账号——添加一个（mock 授权），发布需要账号和额度', `javascript:void(0)`, '↑ 往上看添加表单')) +
    card('账号列表', table(['平台', '账号', '账号类型', '授权状态', '剩余额度'], rows.map((r) => `
      <tr><td>${badge(ENUMS.PUBLISH_PLATFORM[r.platform])}</td><td><b>${e(r.accountName)}</b></td>
      <td>${badge(ENUMS.ACCOUNT_TYPE[r.accountType])}</td><td>${badge(ENUMS.ACCOUNT_AUTH_STATUS[r.authStatus])}</td>
      <td>${r.quota}</td></tr>`)));
  c.render('授权账号', 'accounts', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/accounts\/create$/, async (req, res, c) => {
  svc.createPublishAccount(c.params[0], c.body);
  res.writeHead(302, { Location: `/projects/${c.params[0]}/accounts` });
  res.end();
});

// ============ 内容发布 / 自媒体发布 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/publish$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const articles = q('SELECT * FROM articles WHERE projectId=? AND status>=1 ORDER BY createdAt DESC', p.id);
  const accounts = q('SELECT * FROM publishAccounts WHERE projectId=? AND authStatus=1', p.id);
  const tasks = q('SELECT * FROM publishTasks WHERE projectId=? ORDER BY createdAt DESC', p.id);
  c.body =
    pageHead('内容发布 / 自媒体发布', '预览 → 创建发布任务 → 人工确认 → 正式发布 → 回查 publishedUrl。发布任务是异步的。') +
    (process.env.PUBLISH_MODE === 'mock'
      ? '<div class="notice warn">当前为演示模式（PUBLISH_MODE=mock）：发布会在几秒后模拟完成。生产请移除该变量。</div>'
      : '<div class="notice">当前为真实发布流程：确认后任务进入「发布中」——渠道有 API 时由 Webhook 自动回传链接，否则请到渠道后台手动发布后使用下方「手动发布回填」。</div>') +
    (c.query.e ? `<div class="notice warn">${e(c.query.e)}</div>` : '') +
    card('创建发布任务', articles.length && accounts.length ? `
      <form method="post" action="/projects/${p.id}/publish/create">
        <div class="row">
          <div style="flex:2"><label class="f">文章（需先通过三道审核）*</label>${sel('articleId', articles.map((x) => [x.id, `${x.title}`]), '', '— 选择文章 —', true)}</div>
          <div><label class="f">目标平台 *</label>${sel('platform', Object.entries(ENUMS.PUBLISH_PLATFORM).map(([k, v]) => [k, v]))}</div>
          <div><label class="f">发布账号 *</label>${sel('accountId', accounts.map((x) => [x.id, `${x.accountName}`]), '', '— 选择账号 —', true)}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn">生成发布包预览</button></div>
        </div>
      </form>` : '<div class="notice warn">需要至少一篇「已上传」文章和一个已授权账号。AI 答案卡图片需按平台要求手动发布到抖音图文。</div>') +
    card('手动发布回填（真实渠道）', tasks.length ? `
      <div class="notice">渠道无公开 API 时（知乎、搜狐、小红书图文等）：按发布包内容到平台后台<strong>手动发布</strong>，然后把真实正式链接回填到这里——回填后参与真实监测的 exact_url_hit 判定。</div>
      <form method="post" action="/publish/mark" class="row">
        <div style="flex:2"><label class="f">发布任务</label>${sel('taskId', tasks.map((t) => [t.id, `${ft(t.createdAt).slice(5)} · ${ENUMS.PUBLISH_PLATFORM[t.platform]} · ${t.status === 3 && t.publishedUrl ? '已回填' : ENUMS.PUBLISH_TASK_STATUS[t.status]}`]), '', '— 选择任务 —')}</div>
        <div style="flex:2"><label class="f">真实正式 URL *</label><input type="text" name="publishedUrl" placeholder="https://www.zhihu.com/answer/…" required></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">回填并标记已发布</button></div>
      </form>` : '<div class="empty">先创建发布任务</div>') +
    (tasks.length ? '' : emptyCta('还没有发布任务——先完成三道审核，然后到上方创建发布任务；渠道没有 API 时可发布后手动回填链接', `/projects/${p.id}/content`)) +
    card('发布任务', table(['创建时间', '平台', '状态', '正式链接 / 失败原因', '操作'], tasks.map((t) => `
      <tr><td>${ft(t.createdAt)}</td><td>${badge(ENUMS.PUBLISH_PLATFORM[t.platform])}</td>
      <td>${badge(ENUMS.PUBLISH_TASK_STATUS[t.status])}</td>
      <td>${t.publishedUrl ? `<a href="${safeUrl(t.publishedUrl)}" class="mono">${e(t.publishedUrl)}</a>` : t.failReason ? `<span style="color:var(--bad)">${e(t.failReason)}</span>` : '—'}</td>
      <td>${t.status === 1 ? `<form method="post" action="/publish/${t.id}/confirm" class="inline"><button class="btn small">确认发布</button></form>` : ''}
          ${t.status === 2 ? `<form method="post" action="/publish/${t.id}/refresh" class="inline"><button class="btn small ghost">回查状态</button></form>` : ''}
          ${t.status === 4 ? `<form method="post" action="/publish/${t.id}/retry" class="inline"><button class="btn small ghost">重新发布</button></form>` : ''}</td></tr>`)));
  c.render('内容发布', 'publish', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/publish\/create$/, async (req, res, c) => {
  // 创建前强制三道审核检查：未审核或未通过 → 拒绝
  const a = q1('SELECT * FROM articles WHERE id=?', c.body.articleId);
  const latestAudit = a ? q1('SELECT * FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC LIMIT 1', a.id) : null;
  if (!latestAudit || latestAudit.verdict !== 2) {
    res.writeHead(302, {
      Location: `/projects/${c.params[0]}/publish?e=` + encodeURIComponent('文章尚未通过三道审核（或最近一次审核未全部通过），不能进入发布'),
    });
    return res.end();
  }
  const task = svc.createPublishTask(c.params[0], c.body);
  res.writeHead(302, { Location: `/publish/${task.id}` });
  res.end();
});

route('GET', /^\/publish\/([a-f0-9-]+)$/, async (req, res, c) => {
  const t = q1('SELECT * FROM publishTasks WHERE id=?', c.params[0]);
  if (!t) return c.notFound();
  const p = svc.getProjectSafe(c.user.id, t.projectId);
  if (!p) return c.notFound();
  const pkg = parseJsonSafe(t.packageJson, {});
  c.body =
    pageHead('发布确认清单（发布包）', '发布前先让我确认：文章、封面、账号、额度和发布范围') +
    (c.query.e ? `<div class="notice warn">${e(c.query.e)}</div>` : '') +
    card('发布包（文档 3.6 七字段）', `<table>
      <tr><th>字段</th><th>内容</th></tr>
      <tr><td>1. 平台</td><td>${badge(pkg.platformLabel || ENUMS.PUBLISH_PLATFORM[t.platform])}</td></tr>
      <tr><td>2. 标题</td><td><b>${e(pkg.title || '')}</b></td></tr>
      <tr><td>3. 正文</td><td><details><summary>展开正文（${(pkg.content || '').length} 字）</summary><div class="md-box md" style="margin-top:8px">${e(pkg.content || '')}</div></details></td></tr>
      <tr><td>4. 图片/视频</td><td>${(pkg.media || []).map((m) => `<img src="${safeUrl(m.file)}" style="height:60px;border-radius:6px"> ${e(m.note)}`).join('　') || '—'}</td></tr>
      <tr><td>5. 账号</td><td>${e(pkg.account?.name || '未指定')}（${e(pkg.account?.type || '')}）</td></tr>
      <tr><td>6. 链接</td><td class="kv">${e(pkg.links?.evidence || '')} · ${e(pkg.links?.cta || '')}</td></tr>
      <tr><td>7. 回填字段</td><td class="mono">${e(JSON.stringify(pkg.backfill || {}))}</td></tr>
    </table>
    <form method="post" action="/publish/${t.id}/confirm" style="margin-top:14px">
      <label class="f"><input type="checkbox" required style="width:auto"> 我已核对：账号、平台、文章版本和正式链接承接方式</label>
      <div style="margin-top:8px"><button class="btn">确认并创建发布</button>
      <a class="btn ghost" href="/projects/${p.id}/publish">返回</a></div>
    </form>`);
  c.render('发布确认', 'publish', p.id);
});

route('POST', /^\/publish\/([a-f0-9-]+)\/confirm$/, async (req, res, c) => {
  svc.confirmPublishTask(c.params[0]);
  res.writeHead(302, { Location: `/projects/${q1('SELECT projectId FROM publishTasks WHERE id=?', c.params[0]).projectId}/publish` });
  res.end();
});

route('POST', /^\/publish\/([a-f0-9-]+)\/refresh$/, async (req, res, c) => {
  const t = q1('SELECT * FROM publishTasks WHERE id=?', c.params[0]);
  res.writeHead(302, { Location: `/projects/${t.projectId}/publish` });
  res.end();
});

route('POST', /^\/publish\/([a-f0-9-]+)\/retry$/, async (req, res, c) => {
  const t = q1('SELECT * FROM publishTasks WHERE id=?', c.params[0]);
  if (t && t.status === 4) {
    run(`UPDATE publishTasks SET status=2, failReason=NULL WHERE id=?`, t.id);
    const { createMockPublish } = await import('../providers/publish.js');
    createMockPublish(t.id, t.platform);
  }
  res.writeHead(302, { Location: `/projects/${t.projectId}/publish` });
  res.end();
});

route('POST', /^\/publish\/mark$/, async (req, res, c) => {
  const t = q1('SELECT projectId FROM publishTasks WHERE id=?', c.body.taskId);
  try {
    svc.markPublishedTask({ taskId: c.body.taskId, publishedUrl: c.body.publishedUrl });
  } catch (e) {
    const back = t ? `/projects/${t.projectId}/publish` : '/dashboard';
    res.writeHead(302, { Location: `${back}?e=${encodeURIComponent(e.message)}` });
    return res.end();
  }
  res.writeHead(302, { Location: `/projects/${t.projectId}/publish` });
  res.end();
});

// ============ 付费媒体（占位） ============
route('GET', /^\/projects\/([a-f0-9-]+)\/paid$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  c.body =
    pageHead('付费媒体', '付费媒体投放（方法论文档未展开，占位模块）') +
    card('', '<div class="empty">付费媒体能力按需自助开通；当前版本为占位页。</div>');
  c.render('付费媒体', 'paid', p.id);
});
