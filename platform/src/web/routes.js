// Web 路由：认证 / 工作台 / 公司 / 项目 / 知识库 / 问题库
import { q, q1, run, insert, ensureKbs } from '../db.js';
import { id, nowIso, fmtTime, parseJsonSafe, e } from '../util.js';
import { createSession, destroySession, userProjectIds } from '../auth.js';
import { hashPassword, verifyPassword, audit } from '../db.js';
import { destroyOtherSessions } from '../auth.js';
import { passwordPolicyError } from '../util.js';
import * as svc from '../services.js';
import { layout, pageHead, card, table, badge, empty, emptyCta, sel, ENUMS, fmtTime as ft, safeUrl } from './ui.js';
import { KB_MODULE, KB_TYPE } from '../enums.js';
import { contentRoutes } from './routes-content.js';
import { monitorRoutes } from './routes-monitor.js';

const ROUTES = [];
function route(method, pattern, handler) {
  ROUTES.push({ method, pattern, handler });
}

// ============ 认证 ============
// 登录 / 注册共用分屏品牌版式（与 Rust 版 rust/src/web.rs auth_shell 逐字节同源）
function authShell(h2, intro, errHtml, formInner, foot, action = '/login') {
  return `<style>main.main{max-width:100%;padding:0}</style>
<div class="auth-wrap">
  <div class="auth-brand">
    <div class="auth-logo">G</div>
    <h1>GEO 营销平台</h1>
    <p class="auth-tag">让 AI 在用户提问时，准确认识你、推荐你、引用你。</p>
    <ul class="auth-points">
      <li><b>存事实</b>知识库六模块沉淀品牌事实，AI 只用已确认的事实写作，绝不编造</li>
      <li><b>做内容</b>答案卡 / 品牌文章 / 产品文章，三道审核后按平台规范发布</li>
      <li><b>看结果</b>上榜监测告诉你「AI 引用了你没有」，沉淀信源，逐轮优化</li>
    </ul>
    <div class="auth-foot">GEO Platform v1.6 ｜ 用户协议 · 隐私政策</div>
  </div>
  <div class="auth-panel">
    <form method="post" class="auth-card" action="${action}">
      <h2>${e(h2)}</h2>
      <p class="kv" style="margin:0 0 10px">${intro}</p>
      ${errHtml}
      ${formInner}
      <p class="kv" style="margin-top:14px">${foot}</p>
    </form>
  </div>
</div>`;
}

const PWD_EYE = (id) => `<button type="button" class="pwd-eye" onclick="var p=document.getElementById('${id}');p.type=p.type==='password'?'text':'password';this.textContent=p.type==='password'?'显示':'隐藏'">显示</button>`;

route('GET', /^\/login$/, async (req, res, c) => {
  const errHtml = c.query.error ? `<div class="auth-error">${e(c.query.error)}</div>` : '';
  c.body = authShell(
    '登录',
    'Skills 负责让 AI 帮你执行，平台负责保存项目、执行发布、监测结果和沉淀数据。',
    errHtml,
    `
        <label class="f">邮箱</label><input type="email" name="email" required value="demo@geo.local" autocomplete="username">
        <label class="f">密码</label>
        <div class="pwd-row">
          <input type="password" name="password" id="geo-pwd" required placeholder="请输入密码" autocomplete="current-password" autofocus>
          ${PWD_EYE('geo-pwd')}
        </div>
        <div style="margin-top:16px"><button class="btn" style="width:100%">登录</button></div>`,
    '没有账号？<a href="/register">注册</a> · 演示账号已预填<br><a href="/terms" target="_blank">用户协议</a> · <a href="/privacy" target="_blank">隐私政策</a>',
  );
  c.render('登录');
});

const LOGIN_MAX_FAILS = 5;
const LOCK_MINUTES = 15;

route('POST', /^\/login$/, async (req, res, c) => {
  const ip = c.ip;
  const user = q1('SELECT * FROM users WHERE email=?', c.body.email);
  if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    audit(user.id, user.email, 'login.locked', '', ip);
    res.writeHead(302, { Location: '/login?error=' + encodeURIComponent(`账号已临时锁定（连续失败 ${LOGIN_MAX_FAILS} 次），请 ${LOCK_MINUTES} 分钟后再试`) });
    return res.end();
  }
  if (!user || !verifyPassword(c.body.password, user.salt, user.passwordHash)) {
    if (user) {
      const fails = Number(user.failedAttempts || 0) + 1;
      const lock = fails >= LOGIN_MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
      run('UPDATE users SET failedAttempts=?, lockedUntil=? WHERE id=?', lock ? 0 : fails, lock, user.id);
      audit(user.id, user.email, lock ? 'login.locked.out' : 'login.failed', `第 ${fails} 次失败`, ip);
    } else {
      audit(null, c.body.email, 'login.failed.unknown_user', '', ip);
    }
    res.writeHead(302, { Location: '/login?error=' + encodeURIComponent('邮箱或密码错误' + (user && Number(user.failedAttempts) + 1 >= LOGIN_MAX_FAILS ? `；连续失败 ${LOGIN_MAX_FAILS} 次将临时锁定 15 分钟` : '')) });
    return res.end();
  }
  run('UPDATE users SET failedAttempts=0, lockedUntil=NULL WHERE id=?', user.id);
  createSession(res, user.id);
  audit(user.id, user.email, 'login.success', '', ip);
  // P0-4：标记了「必须改密」的账号强制先改密
  res.writeHead(302, { Location: user.mustChangePassword ? '/change-password' : '/dashboard' });
  res.end();
});

// 强制/主动修改密码
route('GET', /^\/change-password$/, async (req, res, c) => {
  const forced = !!c.user.mustChangePassword;
  c.body = card(forced ? '安全要求：请先修改初始密码' : '修改密码', `
    ${c.query.error ? `<div class="notice warn">${e(c.query.error)}</div>` : ''}
    ${forced ? '<div class="notice warn">当前账号仍在使用初始/临时密码，修改后才能继续使用平台。</div>' : ''}
    <div style="max-width:420px">
      <form method="post" action="/change-password">
        <label class="f">当前密码</label><input type="password" name="current" required>
        <label class="f">新密码（至少 8 位，须同时包含字母和数字）</label><input type="password" name="password" required minlength="8">
        <label class="f">确认新密码</label><input type="password" name="confirm" required>
        <div style="margin-top:12px"><button class="btn">修改并${forced ? '进入平台' : '保存'}</button>
        ${forced ? '' : '<a class="btn ghost" href="/dashboard">返回</a>'}</div>
      </form>
    </div>`);
  c.render('修改密码', 'changepwd');
});

route('POST', /^\/change-password$/, async (req, res, c) => {
  const user = q1('SELECT * FROM users WHERE id=?', c.user.id);
  if (!verifyPassword(c.body.current, user.salt, user.passwordHash)) {
    res.writeHead(302, { Location: '/change-password?error=' + encodeURIComponent('当前密码不正确') });
    return res.end();
  }
  if (c.body.password !== c.body.confirm) {
    res.writeHead(302, { Location: '/change-password?error=' + encodeURIComponent('两次输入的新密码不一致') });
    return res.end();
  }
  const policyErr = passwordPolicyError(c.body.password);
  if (policyErr) {
    res.writeHead(302, { Location: '/change-password?error=' + encodeURIComponent(policyErr) });
    return res.end();
  }
  const { hash, salt } = hashPassword(c.body.password);
  run('UPDATE users SET passwordHash=?, salt=?, mustChangePassword=0, failedAttempts=0, lockedUntil=NULL WHERE id=?', hash, salt, user.id);
  audit(user.id, user.email, 'password.change', '', c.ip);
  // P0 安全补强：改密后失效该用户所有其他会话（当前会话保留）
  const currentSid = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('geo_session='));
  destroyOtherSessions(user.id, currentSid ? currentSid.split('=')[1] : '');
  createSession(res, user.id); // 签发新会话，旧 cookie 全部作废
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
});

route('GET', /^\/register$/, async (req, res, c) => {
  if (process.env.DISABLE_REGISTER === '1') {
    res.writeHead(302, { Location: '/login?error=' + encodeURIComponent('注册已关闭，请联系管理员开通账号') });
    return res.end();
  }
  const errHtml = c.query.error ? `<div class="auth-error">${e(c.query.error)}</div>` : '';
  c.body = authShell(
    '注册 GEO 平台',
    '注册后即可创建公司、知识库与 GEO 项目，开始你的第一次 GEO 优化闭环。',
    errHtml,
    `
        <label class="f">邮箱</label><input type="email" name="email" required autocomplete="username" autofocus>
        <label class="f">密码（至少 8 位，须含字母和数字）</label>
        <div class="pwd-row">
          <input type="password" name="password" id="geo-pwd" required minlength="8" autocomplete="new-password">
          ${PWD_EYE('geo-pwd')}
        </div>
        <label class="f" style="font-weight:400"><input type="checkbox" name="agree" value="1" required style="width:auto"> 我已阅读并同意 <a href="/terms" target="_blank">《用户协议》</a> 与 <a href="/privacy" target="_blank">《隐私政策》</a></label>
        <div style="margin-top:14px"><button class="btn" style="width:100%">创建账号</button></div>`,
    '已有账号？<a href="/login">直接登录</a>',
    '/register',
  );
  c.render('注册');
});

route('POST', /^\/register$/, async (req, res, c) => {
  if (process.env.DISABLE_REGISTER === '1') {
    res.writeHead(302, { Location: '/login?error=' + encodeURIComponent('注册已关闭，请联系管理员开通账号') });
    return res.end();
  }
  if (c.body.agree !== '1') {
    res.writeHead(302, { Location: '/register?error=' + encodeURIComponent('请阅读并勾选同意《用户协议》与《隐私政策》') });
    return res.end();
  }
  if (!c.body.email || !c.body.password) {
    res.writeHead(302, { Location: '/register?error=' + encodeURIComponent('请填写邮箱和密码') });
    return res.end();
  }
  const policyErr = passwordPolicyError(c.body.password);
  if (policyErr) {
    res.writeHead(302, { Location: '/register?error=' + encodeURIComponent(policyErr) });
    return res.end();
  }
  if (q1('SELECT id FROM users WHERE email=?', c.body.email)) {
    res.writeHead(302, { Location: '/register?error=' + encodeURIComponent('该邮箱已注册') });
    return res.end();
  }
  const { hash, salt } = hashPassword(c.body.password);
  const userId = id();
  insert('users', { id: userId, email: c.body.email, passwordHash: hash, salt, role: 'member', createdAt: nowIso() });
  audit(userId, c.body.email, 'register', '', c.ip);
  createSession(res, userId);
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
});

// ---- 用户协议 / 隐私政策（公开页；模板文本，正式商用前请法务审阅）----
const TERMS_HTML = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · GEO 平台</title><link rel="stylesheet" href="/style.css"></head><body><main class="main" style="max-width:860px;margin:0 auto"><div class="card"><h1 style="font-size:20px">${title}</h1><div class="md-box md" style="max-height:none">${body}</div><p class="kv"><a href="/login">返回登录</a></p></div></main></body></html>`;

route('GET', /^\/terms$/, async (req, res, c) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(TERMS_HTML('用户协议（模板版）', `更新日期：${new Date().toISOString().slice(0, 10)}　｜　<span style="color:var(--warn)">本协议为模板版本，正式商用前应经法务审阅并以双方签署的版本为准。</span>

一、服务说明
1. 本平台为生成式引擎优化（GEO）运营工具，提供知识库管理、AI 辅助内容生成、内容审核、发布任务管理、AI 平台监测与数据分析等功能。
2. 平台可能调用第三方大模型服务（内容生成）与联网检索服务（监测）完成相关功能，具体可用性以平台实际配置为准。

二、账号与使用责任
1. 您应对账号与密码安全负责，不得出借、转让账号。
2. 您通过平台对外发布的内容，由您承担最终审核责任。平台提供的三道审核为辅助检查，不构成对内容真实性、合法性的担保。
3. AI 生成内容可能存在错误或幻觉。您确认：所有对外发布的事实、数据、资质均应经人工核验；涉及 AI 生成内容的对外发布，您应遵守所在平台规则及法律法规中关于生成合成内容标识的规定。

三、数据权利
1. 您在平台中录入的知识库、问题、文章等业务数据的所有权归您所有。
2. 为提供服务的目的，平台将在服务期间存储和处理上述数据；您可随时导出或要求删除。
3. 平台不会将您的业务数据用于训练公开模型或提供给其他客户。

四、付费与服务变更
1. 付费服务的价格、周期与配额以双方确认的订单/套餐为准。
2. 平台如需变更重大服务条款，将提前 15 天公告。

五、免责与责任限制
1. 因不可抗力、第三方服务（AI 平台、发布渠道）变更或故障导致的服务中断，平台不承担由此产生的间接损失。
2. 平台对「AI 是否收录/引用」等结果不作承诺，相关数据仅作运营参考。

六、协议终止
您可随时停止使用并要求数据导出；若您严重违反本协议（包括违法使用），平台可中止服务。`));
});

route('GET', /^\/privacy$/, async (req, res, c) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(TERMS_HTML('隐私政策（模板版）', `更新日期：${new Date().toISOString().slice(0, 10)}　｜　<span style="color:var(--warn)">本政策为模板版本，正式商用前请经法务审阅。</span>

一、我们收集的信息
1. 账号信息：邮箱、密码（加密存储）。
2. 业务数据：您主动录入的公司、品牌、产品、知识库、问题、文章与发布/监测记录。
3. 运行日志：登录记录、操作审计日志（时间、IP、操作内容摘要），用于安全审计。

二、信息的使用
1. 仅用于向您提供平台功能（内容生成、发布、监测、报告）与安全保障。
2. 内容生成/监测可能需将您的问题与知识库内容传输给您配置的第三方模型服务商（如通义千问、DeepSeek 等）以完成调用；我们建议您使用自有 API Key 以便直接适用该服务商的数据条款。

三、信息的存储
1. 业务数据存储于服务端数据库与对象存储；密码以不可逆加密（scrypt）存储，接口密钥仅保存哈希。
2. 操作审计日志默认保留 90 天。

四、您的权利
1. 随时导出、更正或要求删除您的业务数据与账号（联系管理员或平台客服）。
2. 账号注销后，业务数据将在 30 天内删除，法律法规要求留存的除外。

五、未成年人
本平台面向企业用户，不面向未成年人提供服务。

六、联系我们
如对本政策有疑问，请通过平台页面上的联系方式与我们取得联系。`));
});

route('GET', /^\/logout$/, async (req, res) => {
  destroySession(req, res);
  res.writeHead(302, { Location: '/login' });
  res.end();
});

// ============ 一键 GEO ============
route('GET', /^\/auto-geo\/?$/, async (req, res, c) => {
  c.body = pageHead('🚀 一键 GEO', '粘贴你的项目文档（README/产品介绍/代码注释等），AI 自动提取产品信息并跑通完整 GEO 流程') +
    card('一键 GEO', `
      <div class="notice">粘贴你的项目文档（README、产品介绍、代码说明等），AI 自动完成：知识库六模块整理 → 50 问生成 → 品牌文章创作 → 三道审核 → 上榜监测。全程无需手工填表。</div>
      <form method="post" action="/auto-geo/run">
        <label class="f">项目/产品名称（可选，AI 会自动提取）</label>
        <input type="text" name="productName" placeholder="如：LikeClaw AI 数字员工">
        <label class="f">项目文档 *</label>
        <textarea name="rawContent" class="code" style="min-height:200px" required placeholder="粘贴 README.md、产品介绍、功能说明等。内容越丰富，提取越准确。"></textarea>
        <div style="margin-top:12px"><button class="btn" style="font-size:15px;padding:12px 32px">🚀 一键 GEO</button></div>
      </form>`);
  c.render('一键 GEO', 'auto-geo');
});

route('POST', /^\/auto-geo\/run\/?$/, async (req, res, c) => {
  if (!c.body.rawContent || c.body.rawContent.length < 50) {
    res.writeHead(302, { Location: '/auto-geo?e=' + encodeURIComponent('项目文档太短（至少 50 字）') });
    return res.end();
  }
  try {
    const { autoGeo } = await import('../auto-geo.js');
    const result = await autoGeo(c.user.id, c.user.email, c.body.rawContent, { region: c.body.region || '全国' });
    // 渲染结果页
    const ext = result.extracted || {};
    c.body = pageHead('🚀 一键 GEO 完成', `产品：${ext.productName || ext.brandName || '未命名'} ｜ 耗时自动`) +
      card('✅ AI 提取的产品信息', `<div class="kv">
        <p><b>产品名：</b>${e(ext.productName || '')}</p>
        <p><b>一句话定位：</b>${e(ext.oneLine || '')}</p>
        <p><b>目标人群：</b>${e(ext.business || '')}</p>
        <p><b>差异化卖点：</b>${e(ext.sellingPoints || '')}</p>
        <p><b>搜索关键词：</b>${e(ext.keywords || '')}</p>
        <p><b>技术架构：</b>${e(ext.techStack || '')}</p>
        ${ext.competitors?.length ? `<p><b>竞品：</b>${e(ext.competitors.join('、'))}</p>` : ''}
      </div>`) +
      card('✅ 自动创建的 GEO 资产', `<table>
        <tr><td>知识库六模块</td><td>${result.knowledgeDocs} 篇文档</td></tr>
        <tr><td>问题池</td><td>${result.questionCount} 个问题</td></tr>
        <tr><td>品牌文章</td><td>${result.articleTitle ? e(result.articleTitle.slice(0, 60)) : '未生成'}</td></tr>
        <tr><td>三道审核</td><td>${result.articleAuditVerdict !== null ? (result.articleAuditVerdict === 2 ? '✅ 通过' : result.articleAuditVerdict === 1 ? '⚠️ 修改后通过' : '❌ 不通过') : '未执行'}</td></tr>
        <tr><td>上榜监测</td><td>${result.monitorTaskId ? '✅ 已创建并执行首轮' : '未创建'}</td></tr>
      </table>`) +
      card('📌 下一步', `<ol>
        ${result.nextSteps.map(s2 => `<li>${e(s2)}</li>`).join('')}
      </ol>
      <div style="margin-top:12px">
        <a class="btn" href="/projects/${result.projectId}">进入项目 →</a>
        <a class="btn ghost" href="/auto-geo">再导入一个项目</a>
      </div>`);
    c.render('一键 GEO 结果', 'auto-geo');
  } catch (err) {
    const msg = String(err.message || err).replace(/[<>&"']/g, '');
    c.body = pageHead('🚀 一键 GEO', '') +
      `<div class="card"><h2>❌ 执行失败</h2><p class="kv">${msg}</p><p><a href="/auto-geo">返回重试</a> · <a href="/settings/config">检查 LLM 配置</a></p></div>`;
    c.render('一键 GEO', 'auto-geo');
  }
});

// ============ 十步工作台 ============
route('GET', /^\/dashboard$/, async (req, res, c) => {
  const projects = userProjectIds(c.user.id);
  const projId = c.query.p || projects[0];
  let stepsHtml = empty('先创建公司和 GEO 项目，工作台将按十步引导完整流程');
  let proj = null;
  if (projId) {
    proj = q1('SELECT * FROM projects WHERE id=?', projId);
    if (proj) {
      const kb = q1('SELECT COUNT(*) as c FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)', projId).c;
      const qs = q1('SELECT COUNT(*) as c FROM questions WHERE projectId=?', projId).c;
      const arts = q1('SELECT COUNT(*) as c FROM articles WHERE projectId=?', projId).c;
      const accs = q1('SELECT COUNT(*) as c FROM publishAccounts WHERE projectId=?', projId).c;
      const pubs = q1(`SELECT COUNT(*) as c FROM publishTasks WHERE projectId=? AND status=3`, projId).c;
      const mons = q1(`SELECT COUNT(*) as c FROM monitorTasks WHERE projectId=? AND status=3`, projId).c;
      const steps = [
        ['1', '添加公司', !!proj.companyId, '/companies'],
        ['2', '添加 GEO 项目', true, `/projects/${projId}`],
        ['3', '添加知识库', kb > 0, `/projects/${projId}/kb`],
        ['4', '生成搜索问题', qs > 0, `/projects/${projId}/questions`],
        ['5', '创建提示词 / 内容创作', qs > 0, `/projects/${projId}/content`],
        ['6', '生成文章', arts > 0, `/projects/${projId}/articles`],
        ['7', '授权账号', accs > 0, `/projects/${projId}/accounts`],
        ['8', '创建发布', pubs > 0 || q1(`SELECT COUNT(*) as c FROM publishTasks WHERE projectId=?`, projId).c > 0, `/projects/${projId}/publish`],
        ['9', '客户端发布（mock 自动完成）', pubs > 0, `/projects/${projId}/publish`],
        ['10', '收录查询', mons > 0, `/projects/${projId}/monitor`],
      ];
      stepsHtml = `<div class="steps">${steps
        .map(
          ([no, name, done, href]) =>
            `<a class="step ${done ? 'done' : ''}" href="${href}" style="text-decoration:none;color:inherit">
              <div class="no">第 ${no} 步</div><div class="name">${e(name)}</div>
              <div class="st">${done ? '<span class="badge b-ok">已完成</span>' : '<span class="badge b-gray">待完成</span>'}</div>
            </a>`
        )
        .join('')}</div>`;
    }
  }
  c.body =
    pageHead('十步工作台', '添加公司 → 添加 GEO 项目 → 添加知识库 → 生成搜索问题 → 创建提示词 → 生成文章 → 授权账号 → 创建发布 → 客户端发布 → 收录查询') +
    card('', stepsHtml) +
    card('平台与 Skills 的分工', `<table>
      <tr><th>对象</th><th>主要负责什么</th><th>学员能看到的结果</th></tr>
      <tr><td><b>GEO 平台</b></td><td>保存公司、项目、知识库、问题、文章、发布任务、上榜监测、复盘和报告</td><td>项目数据可追踪，发布和监测状态可回查</td></tr>
      <tr><td><b>GEO Skills</b></td><td>把自然语言目标转成品牌、知识库、内容、审核、发布、监测和分析动作</td><td>不用记复杂操作，通过一句话完成一组工作</td></tr>
      <tr><td><b>学员</b></td><td>提供真实资料，确认事实、发布范围、预算和外部写操作</td><td>对结果负责，不把未经核验的内容直接发布</td></tr>
    </table>`);
  c.render('十步工作台', 'dashboard');
});

// ============ 公司 ============
route('GET', /^\/companies$/, async (req, res, c) => {
  const rows = q('SELECT * FROM companies WHERE ownerUserId=? ORDER BY createdAt DESC', c.user.id);
  c.body =
    pageHead('公司管理', '品牌管理的基础：公司 → GEO 项目 → 品牌/产品知识库') +
    card('添加公司', `
      <form method="post" action="/companies/create" class="row">
        <div><label class="f">公司名称 *</label><input type="text" name="name" required></div>
        <div><label class="f">行业</label><input type="text" name="industry"></div>
        <div style="flex:2"><label class="f">简介</label><input type="text" name="intro"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>`) +
    card('我的公司', table(['名称', '行业', '简介', '创建时间', ''], rows.map((r) => `
      <tr><td><b>${e(r.name)}</b></td><td>${e(r.industry)}</td><td class="wrap">${e(r.intro)}</td>
      <td>${ft(r.createdAt)}</td>
      <td><a class="btn small ghost" href="/projects?company=${r.id}">查看项目</a></td></tr>`)));
  c.render('公司管理', 'companies');
});

route('POST', /^\/companies\/create$/, async (req, res, c) => {
  svc.createCompany(c.user.id, c.user.email, c.body);
  res.writeHead(302, { Location: '/companies' });
  res.end();
});

// ============ 项目 ============
route('GET', /^\/projects$/, async (req, res, c) => {
  const companies = q('SELECT * FROM companies WHERE ownerUserId=?', c.user.id);
  const rows = q(
    `SELECT p.*, c.name as companyName FROM projects p JOIN companies c ON p.companyId=c.id
     WHERE c.ownerUserId=? ORDER BY p.createdAt DESC`,
    c.user.id
  );
  c.body =
    pageHead('GEO 项目', '公司与产品决定后续知识库、文章、发布和监测数据归属于哪个项目') +
    card('添加 GEO 项目', companies.length ? `
      <form method="post" action="/projects/create" class="row">
        <div><label class="f">所属公司 *</label>${sel('companyId', companies.map((x) => [x.id, x.name]))}</div>
        <div><label class="f">项目名称 *</label><input type="text" name="name" required placeholder="如：跃动童年-GEO优化"></div>
        <div><label class="f">品牌名</label><input type="text" name="brandName"></div>
        <div><label class="f">产品名</label><input type="text" name="productName"></div>
        <div><label class="f">地域</label><input type="text" name="region"></div>
        <div style="flex:2"><label class="f">主营业务与目标人群</label><input type="text" name="business" placeholder="如：3-8岁儿童客厅体感运动"></div>
        <div style="flex:2"><label class="f">核心差异化卖点</label><input type="text" name="sellingPoints"></div>
        <div><label class="f">核心品类搜索词（逗号分隔）</label><input type="text" name="keywords"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>` : '<div class="notice warn">请先<a href="/companies">添加公司</a></div>') +
    card('项目列表', table(['项目', '品牌 / 产品', '业务', '创建时间', ''], rows.map((r) => `
      <tr><td><a href="/projects/${r.id}"><b>${e(r.name)}</b></a><div class="kv">${e(r.companyName)}</div></td>
      <td>${e(r.brandName)} / ${e(r.productName) || '—'}</td>
      <td class="wrap">${e(r.business)}</td><td>${ft(r.createdAt)}</td>
      <td><a class="btn small" href="/projects/${r.id}">进入</a></td></tr>`)));
  c.render('GEO 项目', 'projects');
});

route('POST', /^\/projects\/create$/, async (req, res, c) => {
  const row = svc.createProject(c.user.id, {
    ...c.body,
    defaultPlatforms: c.body.defaultPlatforms ? c.body.defaultPlatforms.split(',').map(Number) : undefined,
  });
  res.writeHead(302, { Location: `/projects/${row.id}` });
  res.end();
});

route('GET', /^\/projects\/([a-f0-9-]+)$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const kbDocs = q1('SELECT COUNT(*) as c FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)', p.id).c;
  const questions = q1('SELECT COUNT(*) as c FROM questions WHERE projectId=?', p.id).c;
  const articles = q1('SELECT COUNT(*) as c FROM articles WHERE projectId=?', p.id).c;
  const published = q1('SELECT COUNT(*) as c FROM articles WHERE projectId=? AND status=3', p.id).c;
  const monitors = q1('SELECT COUNT(*) as c FROM monitorTasks WHERE projectId=?', p.id).c;
  const exactHits = q1('SELECT COUNT(*) as c FROM monitorResults WHERE projectId=? AND exactUrlHit=1', p.id).c;
  const assets = q1('SELECT COUNT(*) as c FROM sourceAssets WHERE projectId=?', p.id).c;
  c.body =
    pageHead(`项目：${p.name}`, `${e(p.brandName)} · ${e(p.business || '—')}`, `<a class="btn" href="/dashboard?p=${p.id}">十步工作台</a>`) +
    card('数据总览', `<table>
      <tr><th>知识库文档</th><th>问题</th><th>文章</th><th>已正式发布</th><th>监测任务</th><th>精确收录(exact_url_hit)</th><th>信源资产</th></tr>
      <tr><td><b>${kbDocs}</b></td><td><b>${questions}</b></td><td><b>${articles}</b></td><td><b>${published}</b></td><td><b>${monitors}</b></td><td><b>${exactHits}</b></td><td><b>${assets}</b></td></tr>
    </table>`) +
    card('项目信息（公司与产品初始化）', `<div class="kv">
      <p><b>品牌名：</b>${e(p.brandName)}　<b>产品名：</b>${e(p.productName) || '—'}　<b>地域：</b>${e(p.region) || '—'}</p>
      <p><b>主营业务：</b>${e(p.business) || '—'}</p>
      <p><b>核心差异化卖点：</b>${e(p.sellingPoints) || '—'}</p>
      <p><b>核心品类搜索词：</b>${e(p.keywords) || '—'}</p></div>
      <form method="post" action="/projects/${p.id}/update" class="row" style="margin-top:10px">
        <div><label class="f">品牌名</label><input type="text" name="brandName" value="${e(p.brandName)}"></div>
        <div><label class="f">产品名</label><input type="text" name="productName" value="${e(p.productName)}"></div>
        <div><label class="f">地域</label><input type="text" name="region" value="${e(p.region)}"></div>
        <div><label class="f">主营业务与目标人群</label><input type="text" name="business" value="${e(p.business)}"></div>
        <div><label class="f">核心差异化卖点</label><input type="text" name="sellingPoints" value="${e(p.sellingPoints)}"></div>
        <div><label class="f">核心品类搜索词</label><input type="text" name="keywords" value="${e(p.keywords)}"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">保存</button></div>
      </form>`);
  c.render('项目概览', 'overview', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/update$/, async (req, res, c) => {
  svc.updateProject(c.user.id, { projectId: c.params[0], ...c.body });
  res.writeHead(302, { Location: `/projects/${c.params[0]}` });
  res.end();
});

// ============ 知识库 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/kb$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const type = Number(c.query.type || 1);
  const { kb, docs } = svc.listKbDocs(p.id, type);
  const moduleRows = docs
    .map(
      (d) => `<tr>
      <td>${e(KB_MODULE[d.module] || '—')}</td>
      <td><b>${e(d.title)}</b></td>
      <td class="wrap md">${e(d.content.length > 160 ? d.content.slice(0, 160) + '…' : d.content)}</td>
      <td>${d.pending ? badge('待补充') : '<span class="badge b-ok">可用</span>'}${d.pending ? `<div class="kv">${e(d.pending)}</div>` : ''}</td>
      <td>${ft(d.updatedAt)}</td>
      <td>
        <details><summary class="btn small ghost" style="cursor:pointer">编辑</summary>
          <form method="post" action="/projects/${p.id}/kb/update" style="margin-top:8px">
            <input type="hidden" name="docId" value="${d.id}"><input type="hidden" name="type" value="${type}">
            <label class="f">标题</label><input type="text" name="title" value="${e(d.title)}">
            <label class="f">内容</label><textarea name="content">${e(d.content)}</textarea>
            <label class="f">待补充说明</label><input type="text" name="pending" value="${e(d.pending)}">
            <div style="margin-top:8px"><button class="btn small">保存文档</button></div>
          </form>
        </details>
      </td></tr>`
    )
    .join('');
  c.body =
    pageHead('知识库', '品牌事实、产品事实、案例、优势、边界和更新时间。整理铁律：没有资料支持的内容必须标记待补，不能编造。') +
    card('', `
      <div class="row" style="margin-bottom:10px">
        <a class="btn ghost ${type === 1 ? '' : ''}" href="/projects/${p.id}/kb?type=1">${type === 1 ? '▶ ' : ''}品牌知识库</a>
        <a class="btn ghost" href="/projects/${p.id}/kb?type=2">${type === 2 ? '▶ ' : ''}产品知识库</a>
      </div>` +
      (type === 1 && kb.conflictList ? `<div class="notice warn"><b>口径冲突清单：</b><br>${e(kb.conflictList)}</div>` : '') +
      (type === 1 && kb.qaIndex ? `<details style="margin-bottom:10px"><summary style="cursor:pointer">品牌高频 Q&A 问答索引（答案必须能回溯到六大模块）</summary><pre class="md-box md">${e(JSON.stringify(parseJsonSafe(kb.qaIndex, {}), null, 2))}</pre></details>` : '') +
      table(['模块', '标题', '内容', '状态', '更新时间', ''], moduleRows, emptyCta('知识库还是空的——AI 写作只能使用这里已确认的事实，先从「知识库整理」开始', `javascript:void(0)`, '↓ 往下看知识库整理'))) +
    card('上传单篇文档', `
      <form method="post" action="/projects/${p.id}/kb/upload">
        <input type="hidden" name="type" value="${type}">
        <div class="row">
          <div><label class="f">模块</label>${sel('module', Object.entries(KB_MODULE).map(([k, v]) => [k, v]))}</div>
          <div><label class="f">标题 *</label><input type="text" name="title" required></div>
        </div>
        <label class="f">内容 *</label><textarea name="content" required placeholder="每行一条事实；保留来源、时间和原始链接"></textarea>
        <label class="f">待补充说明</label><input type="text" name="pending" placeholder="资料不完整之处统一标注">
        <div style="margin-top:10px"><button class="btn">上传文档</button></div>
      </form>`) +
    card('知识库整理（六模块标准化 + QA 索引 + 口径冲突清单）', `
      <div class="notice">粘贴公司/产品原始资料，按《品牌知识库标准化整理》提示词生成 6 个标准模块；严禁编造，缺失标「待补充」，冲突列清单。</div>
      <form method="post" action="/projects/${p.id}/kb/organize">
        <input type="hidden" name="type" value="${type}">
        <label class="f">原始资料</label>
        <textarea name="raw" class="code" style="min-height:140px" required placeholder="公司与产品材料：定位、价格、案例、资质……"></textarea>
        <div style="margin-top:10px"><button class="btn">开始整理</button></div>
      </form>`);
  c.render('知识库', 'kb', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/kb\/upload$/, async (req, res, c) => {
  await svc.uploadKbDoc(c.params[0], { ...c.body, source: 'Web 手动上传' });
  res.writeHead(302, { Location: `/projects/${c.params[0]}/kb?type=${c.body.type || 1}` });
  res.end();
});

route('POST', /^\/projects\/([a-f0-9-]+)\/kb\/update$/, async (req, res, c) => {
  const { docId, title, content, pending } = c.body;
  run('UPDATE kbDocuments SET title=?, content=?, pending=?, updatedAt=? WHERE id=?', title, content, pending || '', nowIso(), docId);
  res.writeHead(302, { Location: `/projects/${c.params[0]}/kb?type=${c.body.type || 1}` });
  res.end();
});

route('POST', /^\/projects\/([a-f0-9-]+)\/kb\/organize$/, async (req, res, c) => {
  const orgR = q1('SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?', c.params[0]);
  const jobId = svc.createJob('kb.organize', { projectId: c.params[0], type: Number(c.body.type) || 1, raw: c.body.raw }, orgR?.orgId);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, jobId, redirectUrl: `/projects/${c.params[0]}/kb?type=${c.body.type || 1}&job=${jobId}` }));
});

// ============ 问题库 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/questions$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM questions WHERE projectId=? ORDER BY priority, createdAt DESC', p.id);
  const rowsHtml = rows
    .map(
      (r) => `<tr>
      <td class="wrap"><b>${e(r.text)}</b><div class="kv mono">${e(r.source)} · v${r.version} · ${r.withBrand ? '带品牌名' : '不带品牌名'}</div></td>
      <td>${badge(ENUMS.QUESTION_CATEGORY[r.category])}<div class="kv">${e(r.intentDimension || '—')}</div></td>
      <td>${badge(ENUMS.QUESTION_STAGE[r.stage])}</td>
      <td>${badge(ENUMS.QUESTION_PRIORITY[r.priority])}</td>
      <td>${badge(ENUMS.QUESTION_STATUS[r.status])}</td>
      <td>
        <form method="post" action="/projects/${p.id}/questions/update" class="row" style="gap:6px">
          <input type="hidden" name="questionId" value="${r.id}">
          <div style="min-width:90px">${sel('priority', Object.entries(ENUMS.QUESTION_PRIORITY).map(([k, v]) => [k, v]), r.priority)}</div>
          <div style="min-width:90px">${sel('status', Object.entries(ENUMS.QUESTION_STATUS).map(([k, v]) => [k, v]), r.status)}</div>
          <div style="flex:0"><button class="btn small">更新</button></div>
        </form>
      </td></tr>`
    )
    .join('');
  c.body =
    pageHead('问题拓展 / 搜索问题库', '问题集、问题类型、优先级和问题状态。监测复测必须固定问题原文，不要每次更换问题。') +
    card('生成问题（按方法论）', `
      <div class="row">
        <form method="post" action="/projects/${p.id}/questions/generate" class="inline">
          <input type="hidden" name="mode" value="50">
          <button class="btn">生成 50 问</button>
        </form>
        <form method="post" action="/projects/${p.id}/questions/generate" class="inline">
          <input type="hidden" name="mode" value="40">
          <button class="btn ghost">精简为标准 40 问（探索30/评估5/行动5）</button>
        </form>
      </div>
      <div class="kv" style="margin-top:8px">50 问：综合5 / 场景9 / 人群9 / 痛点9 / 功能9 / 决策9；每条含「哪家好/推荐/怎么选/排行」，严禁品牌名，10-25 字。</div>`) +
    card('添加 / 批量导入问题', `
      <form method="post" action="/projects/${p.id}/questions/add" class="row">
        <div style="flex:2"><label class="f">单个问题</label><input type="text" name="text"></div>
        <div><label class="f">类型</label>${sel('category', Object.entries(ENUMS.QUESTION_CATEGORY).map(([k, v]) => [k, v]))}</div>
        <div><label class="f">优先级</label>${sel('priority', Object.entries(ENUMS.QUESTION_PRIORITY).map(([k, v]) => [k, v]), 2)}</div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>
      <form method="post" action="/projects/${p.id}/questions/import" style="margin-top:8px">
        <label class="f">批量导入（每行一条）</label>
        <textarea name="lines" class="code" placeholder="问题1&#10;问题2"></textarea>
        <div style="margin-top:8px"><button class="btn ghost">批量导入</button></div>
      </form>`) +
    card(`问题库（${rows.length}）`, table(['问题', '类型', '阶段', '优先级', '状态', '调整'], rowsHtml, emptyCta('问题库是空的——点上面的「生成 50 问」，系统按消费者决策路径自动建题', `javascript:void(0)`, '↑ 往上看生成按钮')));
  c.render('问题拓展', 'questions', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/questions\/add$/, async (req, res, c) => {
  if (c.body.text) await svc.addQuestion(c.params[0], c.body);
  res.writeHead(302, { Location: `/projects/${c.params[0]}/questions` });
  res.end();
});

route('POST', /^\/projects\/([a-f0-9-]+)\/questions\/import$/, async (req, res, c) => {
  const items = String(c.body.lines || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
  await svc.batchAddQuestions(c.params[0], { items });
  res.writeHead(302, { Location: `/projects/${c.params[0]}/questions` });
  res.end();
});

route('POST', /^\/projects\/([a-f0-9-]+)\/questions\/generate$/, async (req, res, c) => {
  const orgR = q1('SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?', c.params[0]);
  const jobId = svc.createJob('questions.generate', { projectId: c.params[0], mode: c.body.mode || '50' }, orgR?.orgId);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, jobId, redirectUrl: `/projects/${c.params[0]}/questions?job=${jobId}` }));
});

route('POST', /^\/projects\/([a-f0-9-]+)\/questions\/update$/, async (req, res, c) => {
  await svc.updateQuestion({
    questionId: c.body.questionId,
    priority: c.body.priority,
    status: c.body.status,
  });
  res.writeHead(302, { Location: `/projects/${c.params[0]}/questions` });
  res.end();
});

// 合并其余路由
ROUTES.push(...contentRoutes);
ROUTES.push(...monitorRoutes);

// ============ 分发 ============
export async function handleWeb(req, res, pathname, query, body) {
  for (const r of ROUTES) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.pattern);
    if (!m) continue;
    return { route: r, params: m.slice(1) };
  }
  return null;
}

export { ROUTES };
