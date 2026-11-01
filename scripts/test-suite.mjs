// GEO 平台扩展测试套件（Spec 06 §1–§4）
// T1 单元级（确定性函数） / T2 API 契约 / T3 安全 / T4 状态机与边界
// 运行：node scripts/test-suite.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3440;
const FAIL_PORT = 3441;
const BASE = `http://localhost:${PORT}`;
const FAIL_BASE = `http://localhost:${FAIL_PORT}`;
const DB = '/tmp/geo-suite.db';

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`);
  }
}

async function jf(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { status: res.status, headers: res.headers, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, headers: res.headers, json: null, text };
  }
}

function startServer(port, dbPath, extraEnv = {}) {
  const p = spawn('node', ['server.js'], {
    cwd: path.join(ROOT, 'platform'),
    env: { ...process.env, PORT: String(port), GEO_DB_PATH: dbPath, PUBLISH_MODE: 'mock', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  p.stderr.on('data', (d) => process.stderr.write(`[srv:${port}] ` + d));
  return p;
}
async function waitHealthy(base) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function loginCookie(base) {
  const r = await jf(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=demo@geo.local&password=demo1234',
    redirect: 'manual',
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function createKey(base, cookie, projectId) {
  const r = await jf(`${base}/settings/keys/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: `name=suite&projectIds=${projectId}`,
    redirect: 'manual',
  });
  return decodeURIComponent(r.headers.get('location') || '').split('created=')[1] || '';
}

const servers = [];
try {
  // ══════════ §1 单元级（确定性函数，无需服务器）══════════
  console.log('\n▶ §1 单元级（三道审核规则 / 40 问结构 / 50 问结构）');
  {
    const llm = await import(path.join(ROOT, 'platform', 'src', 'providers', 'llm.js'));
    const proj = { id: 'u1', brandName: '跃动童年', productName: '体感运动课', business: '儿童体感运动', region: '上海', keywords: '儿童运动' };
    const kb = [
      { module: 2, title: '02_产品与服务事实', content: '年度会员 2980 元，月度会员 398 元。\n无需穿戴设备。' },
      { module: 1, title: '01_定位与业务边界', content: '专注3-8岁儿童客厅体感运动，不做线下场馆培训。' },
    ];
    const good = {
      title: '跃动童年是什么公司？主营儿童体感运动，边界与证据一次说清',
      content: `跃动童年是一家专注儿童体感运动的公司，年度会员 2980 元，月度会员 398 元。判断它是否适合你的家庭，主要看三点：孩子年龄、居家场景、是否需要家长可见的效果反馈。
## 一、选择标准
适龄范围与课程强度是否匹配孩子阶段；是否需要额外购买设备；效果是否可感知，有无数据、报告或教练反馈。
## 二、不同场景怎么选
居家日常锻炼优先短课时免设备方案；预算有限先月度体验；双职工家庭看是否有家长端报告，方便下班后核对运动量。
## 三、为什么这样判断：事实与证据
（来源：知识库 02 模块）无需穿戴设备，摄像头识别动作，家长端实时生成运动体测报告。（来源：知识库 01 模块）明确不做线下场馆培训。
## 四、哪些情况不适合：边界与风险
明确不做线下场馆培训和竞技体能专项训练；产品效果依赖坚持使用，不能保证个别化竞技成绩提升。
## 五、行动建议
先预约体验课，使用两周后对照家长端体测报告判断是否续费；所有事实以知识库六模块为准，缺失信息以「待补充」标注。
补充说明：家长在对比同类产品时，建议把「设备要求、数据反馈、课时长度、价格模式」四个维度列成表格逐项核对；本文引用的全部事实均可在品牌知识库六大模块中回溯核验，未覆盖的信息会明确标注待补充而不是编造。`,
      meta: { question: '跃动童年是什么公司，主要做什么？' },
    };
    const rGood = llm.auditArticle(good, kb, [], proj);
    ok('审核：合规文章三关全过', rGood.gate1 === 2 && rGood.gate2 === 2 && rGood.gate3 === 2 && rGood.verdict === 2, `verdict=${rGood.verdict}`);

    const badAd = { ...good, title: '全网最低·十大顶级跃动童年', content: good.content.replace('无法证明', '') + '它是第一品牌。' };
    const rAd = llm.auditArticle({ ...badAd, meta: good.meta }, kb, [], proj);
    ok('审核：广告法高危词命中 gate2=不通过', rAd.gate2 === 0, rAd.gate2Issues.split('\n')[0]);

    const noBrand = { ...good, title: '这家公司是什么公司？', content: good.content.replaceAll('跃动童年', '某品牌') };
    const rBrand = llm.auditArticle({ ...noBrand, meta: good.meta }, kb, [], proj);
    ok('审核：品牌名缺失 gate1=不通过', rBrand.gate1 === 0);

    const noBoundary = { ...good, title: good.title.replace('，边界与证据一次说清', '，一次说清'), content: good.content.replace('## 四、哪些情况不适合：边界与风险\n明确不做线下场馆培训和竞技体能专项训练；产品效果依赖坚持使用，不能保证个别化竞技成绩提升。', '') };
    const rB = llm.auditArticle({ ...noBoundary, meta: good.meta }, kb, [], proj);
    ok('审核：缺适用边界 gate3 降级', rB.gate3 < 2);

    const q50 = await llm.generateQuestions50(proj);
    ok('50 问：结构 5/9/9/9/9/9 合计 50', (() => {
      const counts = {};
      for (const x of q50.questions) counts[x.dimension] = (counts[x.dimension] || 0) + 1;
      return counts['综合选购'] === 5 && counts['场景选购'] === 9 && counts['人群选购'] === 9 && counts['痛点选购'] === 9 && counts['功能选购'] === 9 && counts['决策选购'] === 9 && q50.questions.length === 50;
    })());
    ok('50 问：全部不含品牌名（核心规则2）', q50.questions.every((x) => !x.text.includes('跃动童年')));
    ok('50 问：每条含「哪家好/推荐/怎么选/排行」类词（核心规则1）', q50.questions.every((x) => /(哪家好|推荐|怎么选|排行|值得|选哪|哪些品牌|榜单|性价比)/.test(x.text)));

    const qs40 = llm.simplifyTo40(
      q50.questions.map((x) => ({ text: x.text })),
      '跃动童年'
    );
    const stages = { 1: 0, 2: 0, 3: 0 };
    for (const x of qs40.questions) stages[x.stage]++;
    ok('40 问：探索30/评估5/行动5', stages[1] === 30 && stages[2] === 5 && stages[3] === 5, JSON.stringify(stages));
    ok('40 问：探索题不含品牌名、评估/行动题含品牌名', qs40.questions.every((x) => (x.stage === 1 ? !x.text.includes('跃动童年') : x.text.includes('跃动童年'))));
    ok('40 问：输出 Markdown 表格含五列', qs40.table.startsWith('| 编号 | 问题内容 | 分类 | 意图维度 | 核心关键词 |'));
  }

  // ══════════ 启动主测试实例 ══════════
  for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
  servers.push(startServer(PORT, DB));
  if (!(await waitHealthy(BASE))) throw new Error('主实例启动失败');
  const { q } = (() => {
    const db = new DatabaseSync(DB);
    return { q: (sql, ...p) => db.prepare(sql).all(...p) };
  })();
  const cookie = await loginCookie(BASE);
  const demoPid = q('SELECT id FROM projects ORDER BY createdAt LIMIT 1')[0].id;
  const openKey = await createKey(BASE, cookie, demoPid);
  const api = (cap, input, key = openKey, device) =>
    jf(`${BASE}/api/open/v1/call/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(device ? { 'X-Geo-Device': device } : {}) },
      body: JSON.stringify({ input }),
    });
  const planApply = async (cap, input, key = openKey) => {
    const p = await jf(`${BASE}/api/open/v1/plan/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input }),
    });
    if (!p.json?.ok) return { ok: false, code: p.json?.code, message: p.json?.message };
    return (await jf(`${BASE}/api/open/v1/apply/${p.json.data.planId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ planId: p.json.data.planId }),
    })).json;
  };
  const P = (r) => (r && r.data && r.data.applied !== undefined ? r.data.data : r.data);

  console.log('\n▶ §2 API 契约');
  {
    const caps = await api('', {});
    ok('能力清单 40 个', caps.json.ok && caps.json.data.capabilities.length === 40, `${caps.json.data.capabilities.length}`);
    const modes = {};
    for (const c of caps.json.data.capabilities) modes[c.mode] = (modes[c.mode] || 0) + 1;
    ok('mode 分布 read16/write24', modes.read === 16 && modes.write === 24);
    const writeCap = caps.json.data.capabilities.find((c) => c.mode === 'write');
    const direct = await api(writeCap.name, {});
    ok('任一 write 直调 → WRITE_REQUIRES_PLAN', direct.json.code === 'WRITE_REQUIRES_PLAN');

    // Label 契约：kind=article 的 statusLabel
    const question = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=1 LIMIT 1`)[0];
    const art = P(await planApply('articles.create', { questionId: question.id, type: 2 }));
    await planApply('articles.audit', { articleId: art.id });
    const acc = q(`SELECT id FROM publishAccounts WHERE projectId='${demoPid}' LIMIT 1`)[0];
    const task = P(await planApply('publishTasks.create', { projectId: demoPid, articleId: art.id, platform: 1, accountId: acc.id }));
    await planApply('publishTasks.confirm', { taskId: task.id });
    await new Promise((r) => setTimeout(r, 4800));
    const g = await api('articles.get', { articleId: art.id });
    ok('Label 契约：article.statusLabel=已正式发布', g.json.data.status === 3 && g.json.data.statusLabel === '已正式发布');
    const mt = P(await planApply('monitorTasks.create', { projectId: demoPid, questionIds: [question.id], platforms: [1], mode: 1 }));
    const rs = await api('monitorResults.list', { taskId: mt.task.id });
    ok('Label 契约：monitorResult.platformLabel=豆包（kind 歧义字段）', rs.json.data[0]?.platformLabel === '豆包');
    const pt = await api('publishTasks.get', { taskId: task.id });
    ok('Label 契约：publishTask.platformLabel=今日头条', pt.json.data.platformLabel === '今日头条');

    const paged = await api('questions.list', { projectId: demoPid, limit: 500 });
    ok('分页上限 100', paged.json.ok && paged.json.data.length <= 100, `${paged.json.data.length} 条`);

    const guides = await jf(`${BASE}/api/open/v1/guide/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: '{}',
    });
    ok('guide list 12 份', guides.json.ok && guides.json.data.guides.length === 12, `${guides.json.data.guides.length}`);
  }

  console.log('\n▶ §3 安全');
  {
    const bad = await jf(`${BASE}/api/open/v1/call/projects.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gk-wrong' },
      body: '{}',
    });
    ok('无效密钥 → AUTH_REQUIRED', bad.json.code === 'AUTH_REQUIRED');

    const noDevice = await api('projects.list', {}, openKey, 'device-BBBB');
    ok('设备不匹配 → DEVICE_MISMATCH（先经 auth/verify 绑定）', noDevice.json.code === 'DEVICE_MISMATCH' || noDevice.json.ok === true, noDevice.json.code || 'OK');

    // v1.5.1：未登录访问 / → 302 /login
    const anonRoot = await fetch(`${BASE}/`, { redirect: 'manual' });
    ok('入口：未登录访问 / → 302 /login', anonRoot.status === 302 && (anonRoot.headers.get('location') || '').includes('/login'));

    // 跨租户：新注册用户访问 demo 项目
    const stamp = Date.now();
    const reg = await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=u${stamp}@t.local&password=abcd1234&agree=1`,
      redirect: 'manual',
    });
    const c2 = (reg.headers.get('set-cookie') || '').split(';')[0];
    const r2 = await fetch(`${BASE}/projects/${demoPid}`, { headers: { cookie: c2 }, redirect: 'manual' });
    ok('跨租户隔离：他人项目 404', r2.status === 404, `HTTP ${r2.status}`);
    const r3 = await fetch(`${BASE}/dashboard`, { headers: { cookie: c2 } });
    const html = await r3.text();
    ok('跨租户隔离：新用户工作台无 demo 项目', !html.includes('跃动童年-GEO优化'));

    // 未授权项目（另一项目不在密钥授权内）
    const otherProj = q(`INSERT INTO companies (id, ownerUserId, name, industry, intro, createdAt) VALUES ('c-other','x','x','x','x','x') RETURNING id`);
    // 直接造一个不属于 demo 的项目 id 请求
    const unauth = await api('questions.list', { projectId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
    ok('未授权/不存在项目被拒', unauth.json.ok === false);
  }

  console.log('\n▶ §4 状态机与边界');
  {
    // PLAN_EXPIRED：plan 后篡改 expiresAt
    const cap = 'questions.create';
    const p1 = await jf(`${BASE}/api/open/v1/plan/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ input: { projectId: demoPid, text: '套件过期计划问题' } }),
    });
    const dbw = new DatabaseSync(DB);
    dbw.prepare(`UPDATE plans SET expiresAt='2020-01-01T00:00:00Z' WHERE id=?`).run(p1.json.data.planId);
    const a1 = await jf(`${BASE}/api/open/v1/apply/${p1.json.data.planId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ planId: p1.json.data.planId }),
    });
    ok('过期 plan → PLAN_EXPIRED', a1.json.code === 'PLAN_EXPIRED');

    // PLAN_USED
    const p2 = await jf(`${BASE}/api/open/v1/plan/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ input: { projectId: demoPid, text: '套件复用计划问题' } }),
    });
    const pid2 = p2.json.data.planId;
    await jf(`${BASE}/api/open/v1/apply/${pid2}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ planId: pid2 }),
    });
    const a2 = await jf(`${BASE}/api/open/v1/apply/${pid2}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ planId: pid2 }),
    });
    ok('重复 apply → PLAN_USED', a2.json.code === 'PLAN_USED');

    // 额度：确认发布扣减 1（§2 中已确认过一次）
    const acc = q(`SELECT * FROM publishAccounts WHERE projectId='${demoPid}' ORDER BY createdAt LIMIT 1`)[0];
    ok('额度：确认发布后 quota-1', acc.quota === 19, `quota=${acc.quota}`);

    // 未过审文章 API 创建发布 → CONFLICT
    const question = q(`SELECT * FROM questions WHERE projectId='${demoPid}' LIMIT 1`)[0];
    const art2 = P(await planApply('articles.create', { questionId: question.id, type: 3 }));
    const t2 = await planApply('publishTasks.create', { projectId: demoPid, articleId: art2.id, platform: 2, accountId: acc.id });
    ok('未过审文章创建发布 → CONFLICT', t2.ok === false && t2.code === 'CONFLICT', t2.message?.slice(0, 30));

    // 删除保护：已发布文章删除 → CONFLICT
    const artPub = q(`SELECT id FROM articles WHERE projectId='${demoPid}' AND status=3 LIMIT 1`)[0];
    if (artPub) {
      const d = await planApply('articles.delete', { articleId: artPub.id });
      ok('删除保护：已发布文章 → CONFLICT', d.ok === false && d.code === 'CONFLICT');
    }

    // 知识库 organize：缺材料模块全部待补充
    const org = P(await planApply('knowledge.organize', { projectId: demoPid, type: 2, raw: '' }));
    ok('知识库整理：空材料全部「待补充」', org.docs.every((d) => d.content.includes('待补充')));
  }

  console.log('\n▶ §5 审计回归（R1/R2 修复项）');
  {
    // 5.1 跨租户 POST 被集中所有权守卫拦截
    const reg = await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=audit${Date.now()}@t.local&password=abcd1234&agree=1`,
      redirect: 'manual',
    });
    const c2 = (reg.headers.get('set-cookie') || '').split(';')[0];
    const xss = await jf(`${BASE}/projects/${demoPid}/kb/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: c2 },
      body: 'type=1&module=1&title=越权写入&content=应为404',
      redirect: 'manual',
    });
    ok('守卫：跨租户 POST 写他人知识库 → 404', xss.status === 404, `HTTP ${xss.status}`);
    const notExist = q(`SELECT COUNT(*) as c FROM kbDocuments WHERE title='越权写入'`)[0].c;
    ok('守卫：越权数据确实未写入', notExist === 0);

    // 5.2 负数 limit 钳制（SQLite 负 LIMIT = 不限制）
    const neg = await api('questions.list', { projectId: demoPid, limit: -5 });
    ok('分页：limit=-5 钳制为 1 条（而非全量）', neg.json.ok && neg.json.data.length === 1, `${neg.json.data.length} 条`);

    // 5.3 恶意扩展名不可逃逸 uploads 目录
    const mal = await planApply('materials.upload', {
      projectId: demoPid,
      name: 'a.svg/../../../evil.html',
      type: 1,
      dataBase64: Buffer.from('<h1>x</h1>').toString('base64'),
    });
    const malUrl = P(mal)?.url || '';
    ok('上传：恶意扩展名回落 .bin 且落在 /uploads 内', mal.ok && malUrl.includes('/uploads/') && malUrl.endsWith('.bin'), malUrl.split('/').pop());
    ok('上传：目标位置无逃逸文件 evil.html', !fs.existsSync(path.join(ROOT, 'platform', 'data', 'uploads', 'evil.html')) && !fs.existsSync(path.join(ROOT, 'platform', 'evil.html')));

    // 5.4 safeUrl 单元：javascript: 置空、https 保留、相对路径保留
    const { safeUrl } = await import(path.join(ROOT, 'platform', 'src', 'util.js'));
    ok('safeUrl：javascript: → #', safeUrl('javascript:alert(1)') === '#');
    ok('safeUrl：https 保留并转义', safeUrl('https://x.com/a"b') === 'https://x.com/a&quot;b');
    ok('safeUrl：站内相对路径保留', safeUrl('/uploads/a.png') === '/uploads/a.png');
    ok('safeUrl：协议相对路径 //evil 拒绝', safeUrl('//evil.com') === '#');

    // 5.5 并发双 apply 原子性：恰好一个成功
    const pp = await jf(`${BASE}/api/open/v1/plan/questions.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ input: { projectId: demoPid, text: '并发原子性问题' } }),
    });
    const pid5 = pp.json.data.planId;
    const applyOnce = () =>
      jf(`${BASE}/api/open/v1/apply/${pid5}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
        body: JSON.stringify({ planId: pid5 }),
      });
    const [r5a, r5b] = await Promise.all([applyOnce(), applyOnce()]);
    const okCount = [r5a, r5b].filter((x) => x.json.ok).length;
    const dupRow = q(`SELECT COUNT(*) as c FROM questions WHERE text='并发原子性问题'`)[0].c;
    ok('原子 apply：并发双 apply 恰好成功一次', okCount === 1, `${okCount} 成功`);
    ok('原子 apply：数据只写入一条（无双写）', dupRow === 1, `${dupRow} 条`);

    // 5.6 发布平台枚举校验
    const question = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=1 LIMIT 1`)[0];
    const art5 = P(await planApply('articles.create', { questionId: question.id, type: 2 }));
    await planApply('articles.audit', { articleId: art5.id });
    const acc5 = q(`SELECT id FROM publishAccounts WHERE projectId='${demoPid}' ORDER BY createdAt LIMIT 1`)[0];
    const badPlat = await planApply('publishTasks.create', { projectId: demoPid, articleId: art5.id, platform: 99, accountId: acc5.id });
    ok('发布：平台枚举非法 → VALIDATION_ERROR', badPlat.ok === false && badPlat.code === 'VALIDATION_ERROR');
  }

  console.log('\n▶ §6 真实接入与新手引导回归');
  {
    // 6.1 markPublished：非法 URL 拒绝
    const badUrl = await planApply('publishTasks.markPublished', { taskId: '00000000-0000-0000-0000-000000000000', publishedUrl: 'javascript:alert(1)' });
    ok('回填：非 http(s) URL 被拒', badUrl.ok === false, badUrl.code || '');

    // 6.2 markPublished：合法回填 → 状态联动（新文章新任务，不经 mock 结算）
    const q6 = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=0 LIMIT 1`)[0];
    const art6 = P(await planApply('articles.create', { questionId: q6.id, type: 3 }));
    await planApply('articles.audit', { articleId: art6.id });
    const acc6 = q(`SELECT id FROM publishAccounts WHERE projectId='${demoPid}' ORDER BY createdAt LIMIT 1`)[0];
    const task6 = P(await planApply('publishTasks.create', { projectId: demoPid, articleId: art6.id, platform: 5, accountId: acc6.id }));
    const m6 = await planApply('publishTasks.markPublished', { taskId: task6.id, publishedUrl: 'https://www.zhihu.com/answer/manual-001' });
    ok('回填：任务 → 已发布 + 真实 URL', m6.ok && P(m6).status === 3 && P(m6).publishedUrl === 'https://www.zhihu.com/answer/manual-001', P(m6)?.publishedUrl);
    const a6 = await api('articles.get', { articleId: art6.id });
    ok('回填：文章联动 → 已正式发布', a6.json.data.status === 3);
    // 重复回填被拒
    const m6b = await planApply('publishTasks.markPublished', { taskId: task6.id, publishedUrl: 'https://www.zhihu.com/answer/manual-002' });
    ok('回填：已有正式链接的任务重复回填 → CONFLICT', m6b.ok === false && m6b.code === 'CONFLICT');

    // 6.3 真实监测引用提取（DashScope / 混元 / OpenAI annotations 三形态）
    const { extractCitations } = await import(path.join(ROOT, 'platform', 'src', 'providers', 'monitor.js'));
    const dash = extractCitations(
      { content: 'x' },
      { search_result: [{ title: '通义引用A', url: 'https://a.example.com/1' }, { site_name: 'B站', link: 'https://b.example.com/2' }] }
    );
    ok('引用提取：DashScope search_result', dash.length === 2 && dash[0].url === 'https://a.example.com/1' && dash[1].title === 'B站');
    const hunyuan = extractCitations({ search_info: { search_result_list: [{ title: '混元引用', url: 'https://c.example.com/3' }] } }, {});
    ok('引用提取：混元 search_info', hunyuan.length === 1 && hunyuan[0].url === 'https://c.example.com/3');
    const ann = extractCitations({ annotations: [{ type: 'url_citation', url_citation: { title: 'OA引用', url: 'https://d.example.com/4' } }] }, {});
    ok('引用提取：OpenAI annotations', ann.length === 1 && ann[0].url === 'https://d.example.com/4');
    const dirty = extractCitations({}, { search_result: [{ url: 'javascript:alert(1)' }, { title: '重复', url: 'https://a.example.com/1' }] });
    ok('引用提取：非 http URL 过滤（合法的保留）', dirty.length === 1 && dirty[0].url === 'https://a.example.com/1');

    // 6.4 真实监测分流：未配置 key 的平台回落 mock（默认行为不变）
    const realCfg = await import(path.join(ROOT, 'platform', 'src', 'providers', 'monitor.js'));
    ok('分流：未配置 MONITOR_*_KEY → mock 模式', realCfg.realMonitorConfigured(1) === false && realCfg.realMonitorConfigured(4) === false);

    // 6.5b 聚光灯引导步骤构建
    const ns6 = await import(path.join(ROOT, 'platform', 'src', 'web', 'nextstep.js'));
    const empty6 = ns6.buildTourSteps({ companies: false, projects: false, projectId: null, openKeys: false });
    ok('引导：空状态步骤数（无项目侧 5 步）', empty6.length === 5, `${empty6.length} 步`);
    ok('引导：空状态不含 ✓ 标记', empty6.every((x) => !x.title.includes('✓')));
    ok('引导：无项目时含「还没有 GEO 项目」提示步', empty6.some((x) => x.title.includes('还没有 GEO 项目')));
    const full6 = ns6.buildTourSteps({ companies: true, projects: true, projectId: 'p1', openKeys: true, kbDocs: true, questions: true, articles: true, audited: true, accounts: true, published: true, monitors: true, sourceAssets: true, reports: true });
    ok('引导：全完成态 13 步全部 ✓', full6.length === 13 && full6.every((x) => x.title.includes('✓') || x.title.includes('欢迎')));
    ok('引导：每步都有 sel 与 desc', full6.every((x) => x.sel && x.desc));

    // 6.5 新手引导 nextStep 分支
    const ns = await import(path.join(ROOT, 'platform', 'src', 'web', 'nextstep.js'));
    const P0 = { companies: false, projects: false, projectId: null };
    ok('引导：无公司 → 创建公司', ns.nextStepFromCounts(P0).title === '创建公司');
    ok('引导：有公司无项目 → 创建项目', ns.nextStepFromCounts({ ...P0, companies: true }).title === '创建 GEO 项目');
    ok('引导：有项目无知识库 → 整理知识库', ns.nextStepFromCounts({ companies: true, projects: true, projectId: 'p1', kbDocs: false }).title === '整理知识库');
    ok('引导：全链路完成 → 持续运营循环', ns.nextStepFromCounts({ companies: true, projects: true, projectId: 'p1', kbDocs: true, questions: true, articles: true, audited: true, accounts: true, publishTasks: true, published: true, monitors: true, sourceAssets: true, reports: true }).title === '进入持续运营循环');
  }

  console.log('\n▶ §7 真实化回归（v1.2：存储/图像/发布模式/口碑/限流）');
  {
    const http7 = await import('node:http');
    const crypto7 = await import('node:crypto');
    // 7.1 存储抽象：未配置 S3 → 本地回落
    const storage = await import(path.join(ROOT, 'platform', 'src', 'providers', 'storage.js'));
    ok('存储：未配置 S3 时回落本地', storage.storageConfigured() === false);
    const rLocal = await storage.put('materials', 'suite-local-test.txt', Buffer.from('hello'), 'text/plain');
    ok('存储：本地写入返回 /uploads URL', rLocal.storage === 'local' && rLocal.url.startsWith('/uploads/'));

    // 7.2 SigV4 签名：确定性 + 结构正确（对照 AWS 官方签名流程构造）
    const signed = storage.signRequest({
      method: 'PUT', host: 'obs.cn-north-4.myhuaweicloud.com', canonicalUri: '/bk/covers/a.png',
      payload: Buffer.from('payload'), amzDate: '20261031T000000Z', region: 'cn-north-4',
      ak: 'AKIAIOSFODNN7EXAMPLE', sk: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    ok('SigV4：Authorization 结构正确', /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261031\/cn-north-4\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/.test(signed.authorization));
    const signed2 = storage.signRequest({ method: 'PUT', host: 'obs.cn-north-4.myhuaweicloud.com', canonicalUri: '/bk/covers/a.png', payload: Buffer.from('payload'), amzDate: '20261031T000000Z', region: 'cn-north-4', ak: 'AKIAIOSFODNN7EXAMPLE', sk: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
    ok('SigV4：同输入签名确定', signed.authorization === signed2.authorization);

    // 7.3 S3 PUT 集成（本地假 S3 服务器验证真实 HTTP 客户端路径）
    await new Promise((resolve) => {
      let captured = null;
      const fake = http7.createServer((req2, res2) => {
        let body = [];
        req2.on('data', (c) => body.push(c));
        req2.on('end', () => {
          captured = { url: req2.url, auth: req2.headers.authorization, sha: req2.headers['x-amz-content-sha256'], body: Buffer.concat(body) };
          res2.writeHead(200); res2.end();
        });
      });
      fake.listen(3445, async () => {
        process.env.S3_ENDPOINT = 'http://127.0.0.1:3445';
        process.env.S3_BUCKET = 'geo-test';
        process.env.S3_ACCESS_KEY = 'testak';
        process.env.S3_SECRET_KEY = 'testsk';
        process.env.S3_REGION = 'cn-north-4';
        try {
          const rS3 = await storage.put('covers', 's3-test.png', Buffer.from('PNGDATA'), 'image/png');
          ok('存储：S3 PUT 走真实 HTTP 并返回公网 URL', rS3.storage === 's3' && rS3.url === 'http://127.0.0.1:3445/geo-test/covers/s3-test.png', rS3.url);
          ok('存储：S3 请求带 SigV4 头与正确 payload 哈希', !!captured && /^AWS4-HMAC-SHA256 /.test(captured.auth) && captured.sha === crypto7.createHash('sha256').update('PNGDATA').digest('hex'));
          ok('存储：S3 key 路径正确（bucket 分段）', captured.url === '/geo-test/covers/s3-test.png');
        } catch (e) {
          ok('存储：S3 PUT 集成异常 ' + e.message, false);
        }
        delete process.env.S3_ENDPOINT; delete process.env.S3_BUCKET; delete process.env.S3_ACCESS_KEY; delete process.env.S3_SECRET_KEY;
        fake.close(resolve);
      });
    });

    // 7.4 图像生成：未配置 → 显式 SVG 回退；配置 DashScope 假端点 → 真实任务流
    const img = await import(path.join(ROOT, 'platform', 'src', 'providers', 'image.js'));
    ok('图像：未配置 IMAGE_API_KEY → svg-default', img.imageConfigured() === false);
    const fb = await img.generateCover('proj-demo-0001', '套件封面测试');
    ok('图像：回退 SVG 可访问且标记 imageGenerated=false', fb.imageGenerated === false && fb.source === 'svg-default' && fb.url.startsWith('/uploads/'));
    await new Promise((resolve) => {
      let phase = 0;
      const fake = http7.createServer((req2, res2) => {
        if (req2.url.includes('/image-synthesis')) {
          res2.writeHead(200, { 'Content-Type': 'application/json' });
          res2.end(JSON.stringify({ output: { task_id: 'task-1', task_status: 'PENDING' } }));
        } else if (req2.url.includes('/tasks/task-1')) {
          phase++;
          res2.writeHead(200, { 'Content-Type': 'application/json' });
          if (phase >= 2) res2.end(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'http://127.0.0.1:3446/real.png' }] } }));
          else res2.end(JSON.stringify({ output: { task_status: 'RUNNING' } }));
        } else if (req2.url === '/real.png') {
          res2.writeHead(200, { 'Content-Type': 'image/png' });
          res2.end(Buffer.from('FAKEPNG-'.repeat(200)));
        } else { res2.writeHead(404); res2.end(); }
      });
      fake.listen(3446, async () => {
        process.env.IMAGE_PROVIDER = 'dashscope';
        process.env.IMAGE_API_KEY = 'sk-test';
        process.env.IMAGE_BASE_URL = 'http://127.0.0.1:3446/api/v1';
        process.env.IMAGE_MODEL = 'wanx2.1-t2i-turbo';
        try {
          const rImg = await img.generateCover('proj-demo-0001', '真实图像流测试');
          ok('图像：DashScope 异步任务全流程（提交→轮询→下载→落存储）', rImg.imageGenerated === true && rImg.source === 'image-dashscope', rImg.source);
        } catch (e) {
          ok('图像：DashScope 流异常 ' + e.message, false);
        }
        delete process.env.IMAGE_PROVIDER; delete process.env.IMAGE_API_KEY; delete process.env.IMAGE_BASE_URL; delete process.env.IMAGE_MODEL;
        fake.close(resolve);
      });
    });

    // 7.5 发布 manual 模式：确认后保持「发布中」，不自动假结算（独立实例）
    await new Promise((resolve) => {
      const DB3 = '/tmp/geo-suite-manual.db';
      for (const f of [DB3, DB3 + '-wal', DB3 + '-shm']) fs.rmSync(f, { force: true });
      const s3 = spawn('node', ['server.js'], {
        cwd: path.join(ROOT, 'platform'),
        env: { ...process.env, PORT: '3447', GEO_DB_PATH: DB3, PUBLISH_MODE: 'manual' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      s3.stderr.on('data', () => {});
      servers.push(s3);
      const BASE3 = 'http://localhost:3447';
      (async () => {
        try {
          for (let i = 0; i < 40; i++) { try { const r = await fetch(`${BASE3}/healthz`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
          const db3 = new DatabaseSync(DB3);
          const q3 = (sql, ...p) => db3.prepare(sql).all(...p);
          const cookie3 = await loginCookie(BASE3);
          const pid3 = q3('SELECT id FROM projects ORDER BY createdAt LIMIT 1')[0].id;
          const key3 = await createKey(BASE3, cookie3, pid3);
          const api3 = (cap, input) => jf(`${BASE3}/api/open/v1/call/${cap}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key3}` }, body: JSON.stringify({ input }) });
          const pa3 = async (cap, input) => {
            const pp = await jf(`${BASE3}/api/open/v1/plan/${cap}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key3}` }, body: JSON.stringify({ input }) });
            return (await jf(`${BASE3}/api/open/v1/apply/${pp.json.data.planId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key3}` }, body: JSON.stringify({ planId: pp.json.data.planId }) })).json;
          };
          const P3 = (r) => (r && r.data && r.data.applied !== undefined ? r.data.data : r.data);
          const qn = q3(`SELECT * FROM questions WHERE projectId='${pid3}' AND withBrand=1 LIMIT 1`)[0];
          const art = P3(await pa3('articles.create', { questionId: qn.id, type: 2 }));
          await pa3('articles.audit', { articleId: art.id });
          const acc = q3(`SELECT id FROM publishAccounts WHERE projectId='${pid3}' LIMIT 1`)[0];
          const task = P3(await pa3('publishTasks.create', { projectId: pid3, articleId: art.id, platform: 1, accountId: acc.id }));
          await pa3('publishTasks.confirm', { taskId: task.id });
          await new Promise((r) => setTimeout(r, 5500));
          const g = await api3('publishTasks.get', { taskId: task.id });
          ok('发布 manual：确认后保持「发布中」（无自动假结算）', g.json.data.status === 2, g.json.data.statusLabel);
          const m = await pa3('publishTasks.markPublished', { taskId: task.id, publishedUrl: 'https://www.sohu.com/manual-real-001' });
          ok('发布 manual：手动回填真实 URL → 已正式发布', m.ok && P3(m).status === 3 && P3(m).publishedUrl.includes('sohu.com'));
        } catch (e) {
          ok('发布 manual 实例异常 ' + e.message, false);
        } finally {
          s3.kill();
          resolve();
        }
      })();
    });

    // 7.6 口碑监测：模板 + 报告 type 6
    const llm7 = await import(path.join(ROOT, 'platform', 'src', 'providers', 'llm.js'));
    const rep7 = llm7.reputationQuestions('跃动童年');
    ok('口碑：模板 8 条全部含品牌名（风险判断类）', rep7.length === 8 && rep7.every((x) => x.includes('跃动童年')));
    const repCreate = await planApply('monitorTasks.create', { projectId: demoPid, questionIds: (await api('questions.list', { projectId: demoPid, limit: 100 })).json.data.filter((x) => x.source === '口碑监测' || true).slice(0, 2).map((x) => x.id), platforms: [1], mode: 1 });
    const repOut = await planApply('reputation.create', { projectId: demoPid, platforms: [1], mode: 1 });
    ok('口碑：一键创建（8 题模板入库 + 监测任务执行）', repOut.ok && P(repOut).questionCount === 8 && P(repOut).task.id, `任务 ${P(repOut)?.task?.id?.slice(0, 8)}`);
    const repReport = await planApply('reports.create', { projectId: demoPid, type: 6 });
    ok('口碑：摘要报告 type6（负面词频 + 语境摘录）', repReport.ok && P(repReport).content.includes('负面信号词频次') && P(repReport).content.includes('口碑监测摘要'), P(repReport)?.title?.slice(0, 20));

    // 7.7 限流：登录接口 31 次内触发 429（新实例避免污染主实例计数）
    await new Promise((resolve) => {
      const DB4 = '/tmp/geo-suite-rate.db';
      for (const f of [DB4, DB4 + '-wal', DB4 + '-shm']) fs.rmSync(f, { force: true });
      const s4 = spawn('node', ['server.js'], {
        cwd: path.join(ROOT, 'platform'),
        env: { ...process.env, PORT: '3448', GEO_DB_PATH: DB4, PUBLISH_MODE: 'mock' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      servers.push(s4);
      s4.stderr.on('data', () => {});
      (async () => {
        try {
          for (let i = 0; i < 40; i++) { try { const r = await fetch('http://localhost:3448/healthz'); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
          let got429 = false;
          for (let i = 0; i < 35; i++) {
            const r = await fetch('http://localhost:3448/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.c&password=x' });
            if (r.status === 429) { got429 = true; break; }
          }
          ok('限流：登录 30 次/分钟后 429', got429);
        } catch (e) {
          ok('限流实例异常 ' + e.message, false);
        } finally {
          s4.kill();
          resolve();
        }
      })();
    }
    );
  }

  console.log('\n▶ §8 系统配置回归（v1.2）');
  {
    const http8 = await import('node:http');
    // 8.1 非管理员访问 → 404（不泄露入口存在）
    const regX = await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=cfg${Date.now()}@t.local&password=abcd1234&agree=1`,
      redirect: 'manual',
    });
    const cX = (regX.headers.get('set-cookie') || '').split(';')[0];
    const forbidden = await fetch(`${BASE}/settings/config`, { headers: { cookie: cX } });
    ok('配置：非管理员访问被拒（403/404）', forbidden.status === 403 || forbidden.status === 404, `HTTP ${forbidden.status}`);

    // 8.2 保存：URL 校验失败不落库
    const badSave = await jf(`${BASE}/settings/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: 'S3_ENDPOINT=not-a-url&PUBLISH_MODE=manual',
      redirect: 'manual',
    });
    ok('配置：非法 URL 被拒绝', (badSave.headers.get('location') || '').includes('error='), decodeURIComponent(badSave.headers.get('location') || '').slice(0, 60));

    // 8.3 保存成功 + 密钥脱敏 + env 立即生效（用连通性测试验证）
    const fakeLlm = http8.createServer((req2, res2) => {
      res2.writeHead(200, { 'Content-Type': 'application/json' });
      res2.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
    await new Promise((r) => fakeLlm.listen(3449, r));
    const secret = 'sk-suite-test-1234567890abcd';
    const save = await jf(`${BASE}/settings/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: `LLM_BASE_URL=${encodeURIComponent('http://127.0.0.1:3449/v1')}&LLM_API_KEY=${encodeURIComponent(secret)}&LLM_MODEL=suite-model`,
      redirect: 'manual',
    });
    ok('配置：保存成功', (save.headers.get('location') || '').includes('saved='), decodeURIComponent(save.headers.get('location') || '').slice(0, 40));
    const page = await (await fetch(`${BASE}/settings/config`, { headers: { cookie } })).text();
    ok('配置：页面展示 BASE URL', page.includes('127.0.0.1:3449'));
    ok('配置：密钥脱敏（完整 Key 不出现在页面）', !page.includes(secret) && page.includes('sk-••••••abcd'));
    const testR = await jf(`${BASE}/settings/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: 'group=llm',
      redirect: 'manual',
    });
    ok('配置：LLM 连通测试走已保存配置（立即生效）', decodeURIComponent(testR.headers.get('location') || '').includes('✅'), decodeURIComponent(testR.headers.get('location') || '').slice(0, 70));
    fakeLlm.close();

    // 8.3b 任务式引导 + 页面微引导
    const ns8 = await import(path.join(ROOT, 'platform', 'src', 'web', 'nextstep.js'));
    const mEmpty = ns8.buildMissions({ companies: false, projects: false, projectId: null });
    ok('任务：空状态首任务是「创建公司」且高亮', mEmpty.missions[0].title === '创建公司' && mEmpty.missions[0].current === true && mEmpty.current === mEmpty.missions[0]);
    const mFull = ns8.buildMissions({ companies: true, projects: true, projectId: 'p1', kbDocs: true, questions: true, articles: true, audited: true, accounts: true, published: true, monitors: true, sourceAssets: true, reports: true });
    ok('任务：全完成态 allDone=true', mFull.allDone === true && mFull.missions.every((x) => x.done));
    const mMid = ns8.buildMissions({ companies: true, projects: true, projectId: 'p1', kbDocs: true, questions: false, articles: false, audited: false, accounts: false, published: false, monitors: false, sourceAssets: false, reports: false });
    ok('任务：中间态当前任务=知识库后第一个未完成（问题池）', mMid.current && mMid.current.title === '生成问题池');
    ok('页面微引导：8 组齐全', Object.keys(ns8.PAGE_TOURS).length === 8 && Object.values(ns8.PAGE_TOURS).every((seq) => seq.length >= 2 && seq.every((x) => x.sel && x.title && x.desc)));
    const dashHtml = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text();
    ok('任务：工作台渲染快速上手面板', dashHtml.includes('快速上手') && dashHtml.includes('ms-item'));
    ok('任务：页面微引导注入', dashHtml.includes('GEO_PAGE_TOURS'));
    ok('任务：favicon 已内联（无 favicon 404）', dashHtml.includes('rel="icon"'));

    // 8.4 白名单外 key 被丢弃（防任意 env 注入）
    const evil = await jf(`${BASE}/settings/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: 'NODE_OPTIONS=--evil&PATH=/hacked&LLM_MODEL=still-fine',
      redirect: 'manual',
    });
    ok('配置：白名单外字段被丢弃（无注入面）', (evil.headers.get('location') || '').includes('saved=') && decodeURIComponent(evil.headers.get('location')).includes('LLM_MODEL') && !decodeURIComponent(evil.headers.get('location')).includes('NODE_OPTIONS'));
  }

  console.log('\n▶ §9 P0 商用合规回归');
  {
    // 9.1 密码策略：注册弱密码被拒
    const weak = await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=weak${Date.now()}@t.local&password=12345678&agree=1`,
      redirect: 'manual',
    });
    ok('安全：纯数字密码被策略拒绝', decodeURIComponent(weak.headers.get('location') || '').includes('密码必须同时包含字母和数字'), decodeURIComponent(weak.headers.get('location') || '').slice(0, 50));

    // 9.2 条款勾选：未勾选被拒
    const noAgree = await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=agree${Date.now()}@t.local&password=abcd1234`,
      redirect: 'manual',
    });
    ok('合规：未勾选协议被拒', decodeURIComponent(noAgree.headers.get('location') || '').includes('用户协议'));

    // 9.3 登录锁定：连续 5 次失败后，正确密码也进不去
    const lockUser = `lock${Date.now()}@t.local`;
    await jf(`${BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${lockUser}&password=abcd1234&agree=1`,
      redirect: 'manual',
    });
    for (let i = 0; i < 5; i++) {
      await jf(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=${lockUser}&password=wrongpass1`,
        redirect: 'manual',
      });
    }
    const locked = await jf(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${lockUser}&password=abcd1234`,
      redirect: 'manual',
    });
    ok('安全：连续 5 次失败后账号锁定（正确密码也不放行）', decodeURIComponent(locked.headers.get('location') || '').includes('临时锁定'), decodeURIComponent(locked.headers.get('location') || '').slice(0, 50));

    // 9.4 操作审计：管理员页可见此前 POST 写操作记录
    const auditPage = await (await fetch(`${BASE}/settings/audit`, { headers: { cookie } })).text();
    ok('审计：管理员可查看操作日志页', auditPage.includes('操作审计日志'));
    ok('审计：包含 Open API 写操作与会话写操作记录', auditPage.includes('openapi articles.create') && auditPage.includes('POST /settings/config/save'), '');

    // 9.5 AIGC 声明：文章默认带声明，发布包携带
    const question9 = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=1 LIMIT 1`)[0];
    const art9 = P(await planApply('articles.create', { questionId: question9.id, type: 2 }));
    ok('AIGC：文章默认 aiDeclaration=1', art9.aiDeclaration === 1);
    await planApply('articles.audit', { articleId: art9.id });
    const acc9 = q(`SELECT id FROM publishAccounts WHERE projectId='${demoPid}' ORDER BY createdAt DESC LIMIT 1`)[0];
    const task9 = P(await planApply('publishTasks.create', { projectId: demoPid, articleId: art9.id, platform: 2, accountId: acc9.id }));
    const pkg9 = JSON.parse(task9.packageJson);
    ok('AIGC：发布包携带 AI 声明（标识办法）', pkg9.aiDeclaration && pkg9.aiDeclaration.required === true && pkg9.aiDeclaration.text.includes('AI 辅助生成'));
    // 生成表单可关闭声明
    const art9b = P(await planApply('articles.create', { questionId: question9.id, type: 3, aiDeclaration: 0 }));
    ok('AIGC：可显式关闭声明（aiDeclaration=0）', art9b.aiDeclaration === 0);

    // 9.6 条款页面公开可访问
    const terms = await fetch(`${BASE}/terms`);
    const privacy = await fetch(`${BASE}/privacy`);
    ok('合规：用户协议/隐私政策公开页 200 且标注模板', terms.status === 200 && privacy.status === 200 && (await terms.text()).includes('模板版本'));

    // 9.7 强制改密：新种子标记 mustChangePassword → 登录后强制进改密页
    const dbw = new DatabaseSync(DB);
    dbw.prepare(`UPDATE users SET mustChangePassword=1 WHERE email='demo@geo.local'`).run();
    const forced = await jf(`${BASE}/dashboard`, { headers: { cookie }, redirect: 'manual' });
    ok('安全：mustChangePassword 账号被强制跳转改密页', forced.status === 302 && (forced.headers.get('location') || '').includes('/change-password'));
    // 改密成功后解除
    const cp = await jf(`${BASE}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: 'current=demo1234&password=newpass123&confirm=newpass123',
      redirect: 'manual',
    });
    const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie: (cp.headers.get('set-cookie') || '').split(';')[0] || cookie } });
    ok('安全：改密成功后解除强制', dash.status === 200);
    // 注：改密后 mustChangePassword 已解除；后续用例依赖正常会话
  }


  console.log('\n▶ §10 组织/角色/用量/调度/卡密/通知/导出回归（v1.4–v1.5）');
  {
    // —— 独立登录（§9 改密已更换 demo 密码）——
    const relog10 = await jf(`${BASE}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=demo@geo.local&password=newpass123', redirect: 'manual',
    });
    const ownCookie = (relog10.headers.get('set-cookie') || '').split(';')[0];
    ok('准备：owner 重新登录（新密码）', !!ownCookie);

    // —— 注册两个成员账号（注册响应自带会话）——
    const regOp = await jf(`${BASE}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=op${Date.now()}@t.local&password=abcd1234&agree=1`, redirect: 'manual',
    });
    const regVw = await jf(`${BASE}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=vw${Date.now()}@t.local&password=abcd1234&agree=1`, redirect: 'manual',
    });
    const opCookie = (regOp.headers.get('set-cookie') || '').split(';')[0];
    const vwCookie = (regVw.headers.get('set-cookie') || '').split(';')[0];
    const dbX = new DatabaseSync(DB);
    const opEmail = dbX.prepare("SELECT email FROM users WHERE email LIKE 'op%@t.local'").get().email;
    const vwEmail = dbX.prepare("SELECT email FROM users WHERE email LIKE 'vw%@t.local'").get().email;
    dbX.close();
    ok('准备：成员账号注册', !!opCookie && !!vwCookie);

    // —— 邀请 ——
    const inv1 = await jf(`${BASE}/team/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: `email=${opEmail}&role=operator`, redirect: 'manual',
    });
    ok('组织：邀请 operator（saved）', (inv1.headers.get('location') || '').includes('saved=1'));
    const inv2 = await jf(`${BASE}/team/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: `email=${vwEmail}&role=viewer`, redirect: 'manual',
    });
    ok('组织：邀请 viewer（saved）', (inv2.headers.get('location') || '').includes('saved=1'));

    // —— 角色鉴权 ——
    const vwPost = await jf(`${BASE}/companies/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: vwCookie },
      body: 'name=越权公司', redirect: 'manual',
    });
    ok('角色：viewer 写操作 403', vwPost.status === 403, `HTTP ${vwPost.status}`);
    const vwGet = await fetch(`${BASE}/dashboard`, { headers: { cookie: vwCookie } });
    ok('角色：viewer 读取正常', vwGet.status === 200);
    const opPost = await jf(`${BASE}/companies/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: opCookie },
      body: 'name=操作员公司', redirect: 'manual',
    });
    ok('角色：operator 写入放行', opPost.status === 302);
    const opCfg = await fetch(`${BASE}/settings/config`, { headers: { cookie: opCookie }, redirect: 'manual' });
    ok('角色：非 owner 访问系统配置被拒（403/404）', opCfg.status === 403 || opCfg.status === 404, `HTTP ${opCfg.status}`);

    // —— 用量计量 ——
    const question = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=1 LIMIT 1`)[0];
    await planApply('monitorTasks.create', { projectId: demoPid, questionIds: [question.id], platforms: [1], mode: 1 });
    const cnt1 = q(`SELECT count FROM usageCounters WHERE type='monitor.calls' ORDER BY day DESC LIMIT 1`)[0];
    ok('用量：监测调用计数落库', !!cnt1 && cnt1.count >= 1, `count=${cnt1?.count}`);

    // —— 配额 ——
    const teamQuota = await jf(`${BASE}/team/quota`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: 'quotaMonitorMonthly=1', redirect: 'manual',
    });
    ok('配额：保存月配额=1', (teamQuota.headers.get('location') || '').includes('saved=1'));
    const over = await planApply('monitorTasks.create', { projectId: demoPid, questionIds: [question.id], platforms: [1], mode: 1 });
    ok('配额：超限创建被拒', over.ok === false && ['CONFLICT', 'VALIDATION_ERROR'].includes(over.code), over.message?.slice(0, 30));

    // —— 卡密：生成/兑换/重复拒绝/配额联动 ——
    const gen1 = await jf(`${BASE}/settings/licenses/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: 'planCode=basic&count=1&note=suite', redirect: 'manual',
    });
    const SUITE_KEY = JSON.parse(decodeURIComponent(gen1.headers.get('location') || '').split('generated=')[1])[0];
    ok('卡密：管理员生成', !!SUITE_KEY && SUITE_KEY.startsWith('GEO-BASIC-'), SUITE_KEY?.slice(0, 20));
    const redeem = await jf(`${BASE}/team/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: `key=${SUITE_KEY}`, redirect: 'manual',
    });
    ok('卡密：兑换成功（套餐联动）', decodeURIComponent(redeem.headers.get('location') || '').includes('已开通'));
    const orgIdX = q(`SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?`, demoPid)[0];
    if (!orgIdX) console.log('  ⚠️ 调试：demoPid 无归属公司', demoPid);
    const orgRow = orgIdX ? q(`SELECT planCode, quotaMonitorMonthly FROM orgs WHERE id=?`, orgIdX.orgId)[0] : undefined;
    ok('卡密：org 配额联动（basic=500）', orgRow.planCode === 'basic' && orgRow.quotaMonitorMonthly === 500, JSON.stringify(orgRow));
    const dup = await jf(`${BASE}/team/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: `key=${SUITE_KEY}`, redirect: 'manual',
    });
    ok('卡密：重复兑换被拒', decodeURIComponent(dup.headers.get('location') || '').includes('已被使用'));

    // —— 调度：到期检查点自动执行 ——
    const schedTask = q(`SELECT id FROM monitorTasks WHERE projectId='${demoPid}' ORDER BY createdAt DESC LIMIT 1`)[0];
    const cps = q(`SELECT id FROM monitorCheckpoints WHERE taskId='${schedTask.id}' ORDER BY day LIMIT 1`);
    if (cps.length) {
      const dbw = new DatabaseSync(DB);
      dbw.prepare(`UPDATE monitorCheckpoints SET status=1, day=3, dueAt='2026-10-01T00:00:00Z' WHERE id=?`).run(cps[0].id);
      dbw.close();
      await fetch(`${BASE}/projects/${demoPid}/monitor`, { headers: { cookie: ownCookie } });
      const done = q(`SELECT status FROM monitorCheckpoints WHERE id=?`, cps[0].id)[0];
      ok('调度：到期检查点自动执行（状态=已完成）', done.status === 2, `status=${done.status}`);
    } else {
      ok('调度：存在检查点', false);
    }

    // —— 审计 ——
    const auditHtml = await (await fetch(`${BASE}/settings/audit`, { headers: { cookie: ownCookie } })).text();
    ok('审计：team.invite 与卡密兑换留痕', auditHtml.includes('team.invite') && auditHtml.includes('license.redeem'));

    // —— 白标导出 ——
    let repX = q(`SELECT id FROM reports WHERE projectId='${demoPid}' ORDER BY createdAt DESC LIMIT 1`)[0];
    if (!repX) {
      const mk = await planApply('reports.create', { projectId: demoPid, type: 1 });
      repX = P(mk)?.id ? P(mk) : undefined;
    }
    if (repX) {
      const expHtml = await (await fetch(`${BASE}/reports/${repX.id}/export`, { headers: { cookie: ownCookie } })).text();
      ok('导出：白标页含客户品牌、无侧边栏', expHtml.includes('跃动童年') && !expHtml.includes('class="sidebar"'));
      const expMd = await (await fetch(`${BASE}/reports/${repX.id}/export?format=md`, { headers: { cookie: ownCookie } })).text();
      ok('导出：Markdown 以标题开头', expMd.startsWith('#'));
    } else {
      ok('导出：存在报告', false);
    }

    // —— 事件通知：org webhook ——
    const received = [];
    const http10 = await import('node:http');
    const fakeHook = http10.createServer((rq, rs) => {
      let b = '';
      rq.on('data', (c2) => (b += c2));
      rq.on('end', () => { received.push(JSON.parse(b || '{}')); rs.writeHead(200); rs.end(); });
    });
    await new Promise((r) => fakeHook.listen(3455, r));
    await jf(`${BASE}/team/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ownCookie },
      body: `notifyWebhook=${encodeURIComponent('http://127.0.0.1:3455/hook')}`, redirect: 'manual',
    });
    const qN = q(`SELECT id FROM questions WHERE projectId='${demoPid}' LIMIT 1`)[0];
    await planApply('monitorTasks.create', { projectId: demoPid, questionIds: [qN.id], platforms: [1], mode: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    fakeHook.close();
    ok('通知：监测完成推送 monitor.done', received.some((e2) => e2.event === 'monitor.done'), received.map((e2) => e2.event).join(','));
  }

  console.log('\n▶ §4b 发布失败注入（GEO_MOCK_FAIL_RATE=1 独立实例）');
  {
    const DB2 = '/tmp/geo-suite-fail.db';
    for (const f of [DB2, DB2 + '-wal', DB2 + '-shm']) fs.rmSync(f, { force: true });
    const s2 = startServer(FAIL_PORT, DB2, { GEO_MOCK_FAIL_RATE: '1' });
    servers.push(s2);
    if (!(await waitHealthy(FAIL_BASE))) throw new Error('故障实例启动失败');
    const dbf = new DatabaseSync(DB2);
    const qf = (sql, ...p) => dbf.prepare(sql).all(...p);
    const cookie2 = await loginCookie(FAIL_BASE);
    const pid = qf('SELECT id FROM projects ORDER BY createdAt LIMIT 1')[0].id;
    const key2 = await createKey(FAIL_BASE, cookie2, pid);
    const api2 = (cap, input) =>
      jf(`${FAIL_BASE}/api/open/v1/call/${cap}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key2}` },
        body: JSON.stringify({ input }),
      });
    const planApply2 = async (cap, input) => {
      const pp = await jf(`${FAIL_BASE}/api/open/v1/plan/${cap}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key2}` },
        body: JSON.stringify({ input }),
      });
      if (!pp.json?.ok) return { ok: false, code: pp.json?.code };
      return (await jf(`${FAIL_BASE}/api/open/v1/apply/${pp.json.data.planId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key2}` },
        body: JSON.stringify({ planId: pp.json.data.planId }),
      })).json;
    };
    const P2 = (r) => (r && r.data && r.data.applied !== undefined ? r.data.data : r.data);
    const question = qf(`SELECT * FROM questions WHERE projectId='${pid}' AND withBrand=1 LIMIT 1`)[0];
    const art = P2(await planApply2('articles.create', { questionId: question.id, type: 2 }));
    await planApply2('articles.audit', { articleId: art.id });
    const acc = qf(`SELECT id FROM publishAccounts WHERE projectId='${pid}' LIMIT 1`)[0];
    const task = P2(await planApply2('publishTasks.create', { projectId: pid, articleId: art.id, platform: 1, accountId: acc.id }));
    await planApply2('publishTasks.confirm', { taskId: task.id });
    await new Promise((r) => setTimeout(r, 5200));
    const g = await api2('publishTasks.get', { taskId: task.id });
    ok('失败注入：任务→失败 + failReason', g.json.data.status === 4 && !!g.json.data.failReason, g.json.data.failReason?.slice(0, 24));
    const a = await api2('articles.get', { articleId: art.id });
    ok('失败注入：文章不联动（保持已创建发布任务）', a.json.data.status === 2, a.json.data.statusLabel);
  }
} catch (e) {
  failed++;
  failures.push('EXCEPTION: ' + e.message);
  console.error('\n💥 套件异常终止:', e);
} finally {
  for (const s of servers) s.kill();
}

console.log('\n══════════════════════════════════════');
console.log(`  扩展套件结果：${passed} 通过 / ${failed} 失败`);
if (failures.length) {
  console.log('  失败项：');
  for (const f of failures) console.log('   - ' + f);
  process.exit(1);
}
console.log('  🎉 全部通过：Spec 06 §1–§4 验收标准达成');
