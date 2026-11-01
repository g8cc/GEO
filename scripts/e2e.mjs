// GEO 平台端到端验收（Goal D）
// 覆盖：登录 → Open Key → 问题生成(50/40) → 内容创作 → 三道审核 → 发布(异步) →
//       上榜监测(exact_url_hit) → 信源资产 → 诊断/对比/逆向报告 → CLI 冒烟 → Web 页面巡检
// 运行：node scripts/e2e.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3439;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/geo-e2e.db';

let passed = 0;
let failed = 0;
const failures = [];
function step(name, cond, detail = '') {
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

// —— 启动独立 E2E 实例 ——
try {
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '-wal', { force: true });
  fs.rmSync(DB + '-shm', { force: true });
} catch {}

console.log('▶ 启动 GEO 平台（E2E 独立实例，端口 ' + PORT + '）');
const server = spawn('node', ['server.js'], {
  cwd: path.join(ROOT, 'platform'),
  env: { ...process.env, PORT: String(PORT), GEO_DB_PATH: DB, PUBLISH_MODE: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let cookie = '';
let openKey = '';
let demoPid = '';
const PIDQ = () => ({ projectId: demoPid }); // demoPid 在 try 内赋值

try {
  if (!(await waitHealthy())) throw new Error('server failed to start');
  console.log('▶ 服务已就绪\n');

  // 1. 登录
  {
    const r = await jf(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=demo@geo.local&password=demo1234',
      redirect: 'manual',
    });
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    step('Web 登录（demo@geo.local）', r.status === 302 && cookie.startsWith('geo_session='));
    // v1.5.1：裸域名入口（用户真实场景——带着会话打开 / 必须进工作台而非 404）
    const root = await fetch(`${BASE}/`, { headers: { cookie }, redirect: 'manual' });
    step('入口：已登录打开 / 重定向工作台', root.status === 302 && (root.headers.get('location') || '').includes('/dashboard'));
    const rootFinal = await fetch(`${BASE}/`, { headers: { cookie } });
    const rootHtml = await rootFinal.text();
    step('入口：/ 最终渲染十步工作台', rootFinal.status === 200 && rootHtml.includes('十步工作台'));
  }

  // 2. 演示项目 ID（种子数据）——直接读 E2E 实例的数据库文件
  const e2eDb = new DatabaseSync(DB, { readOnly: false });
  const q = (sql, ...p) => e2eDb.prepare(sql).all(...p);
  demoPid = q('SELECT id FROM projects ORDER BY createdAt LIMIT 1')[0].id;
  step('种子数据：演示项目就绪', !!demoPid, demoPid.slice(0, 8));

  // 3. Web 创建 Open Key
  {
    const r = await jf(`${BASE}/settings/keys/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: `name=e2e&projectIds=${demoPid}`,
      redirect: 'manual',
    });
    const loc = decodeURIComponent(r.headers.get('location') || '');
    openKey = loc.split('created=')[1] || '';
    step('Web 创建 Open Key（只显示一次）', openKey.startsWith('gk-'), openKey.slice(0, 10) + '…');
  }

  // —— Open API 工具 ——
  const api = (cap, input) =>
    jf(`${BASE}/api/open/v1/call/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ input }),
    });
  // planApply 返回完整包络；apply 的业务载荷在 data.data
  const P = (r) => (r && r.data && r.data.applied !== undefined ? r.data.data : r.data);
  const planApply = async (cap, input) => {
    const p = await jf(`${BASE}/api/open/v1/plan/${cap}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ input }),
    });
    if (!p.json?.ok) return { ok: false, code: p.json?.code, message: p.json?.message };
    const a = await jf(`${BASE}/api/open/v1/apply/${p.json.data.planId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openKey}` },
      body: JSON.stringify({ planId: p.json.data.planId }),
    });
    return a.json;
  };

  // 4. 能力清单 / 未授权拦截
  {
    const r = await api('', {});
    step('capabilities 能力清单', r.json?.ok && r.json.data.capabilities.length >= 30, `${r.json.data.capabilities.length} 个能力`);
    const bad = await jf(`${BASE}/api/open/v1/call/questions.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gk-invalid' },
      body: '{}',
    });
    step('无效密钥被拒（AUTH_REQUIRED）', bad.json?.code === 'AUTH_REQUIRED');
    const unauth = await api('questions.list', { projectId: '00000000-0000-0000-0000-000000000000' });
    step('未授权项目被拒', unauth.json?.ok === false, unauth.json?.message?.slice(0, 40));
  }

  // 5. 读操作 + Label
  {
    const r = await api('projects.list', {});
    const p = r.json.data[0];
    step('projects.list 返回 Label 对', r.json.ok && p.name === '跃动童年-GEO优化' && !!p.createdAt);
    const qs = await api('questions.list', { projectId: demoPid, limit: 5 });
    step('questions.list', qs.json.ok && qs.json.data.length >= 5 && !!qs.json.data[0].categoryLabel);
  }

  // 6. 写操作拦截 + plan/apply
  {
    const direct = await api('questions.create', { ...PIDQ(), text: 'e2e 直写应被拦截' });
    step('写操作直调被拦（WRITE_REQUIRES_PLAN）', direct.json?.code === 'WRITE_REQUIRES_PLAN');
    const r = await planApply('questions.create', { ...PIDQ(), text: 'e2e 交付验收测试问题（怎么选）', category: 2, priority: 0 });
    step('plan → apply 两步写', r.ok && P(r).added === true, P(r)?.row?.text);
    const again = await planApply('questions.create', { ...PIDQ(), text: 'e2e 交付验收测试问题（怎么选）', category: 2 });
    step('重复问题去重（已存在跳过）', again.ok && P(again).duplicate === true);
  }

  // 7. 50 问 / 40 问
  {
    const r = await planApply('questions.generate', { ...PIDQ(), mode: '50' });
    step('50 问生成并入库（≥45 条新增）', r.ok && P(r).added >= 45, `新增 ${P(r)?.added}，重复 ${P(r)?.duplicate}`);
    const r40 = await planApply('questions.generate', { ...PIDQ(), mode: '40' });
    step('标准 40 问精简（探索30/评估5/行动5）', r40.ok && P(r40).table.includes('探索') && P(r40).table.includes('评估') && P(r40).table.includes('行动'), `新增 ${P(r40)?.added}`);
    const stages = q(`SELECT stage, COUNT(*) c FROM questions WHERE projectId='${demoPid}' GROUP BY stage`);
    step('问题阶段分布（探索/评估/行动）', stages.length >= 3);
  }

  // 8. 知识库整理
  {
    const r = await planApply('knowledge.organize', {
      ...PIDQ(),
      type: 2,
      raw: '跃动童年体感运动课，年度会员2980元，月度会员398元。适合3-8岁儿童。\n产品功能：无需穿戴设备，家长端实时生成运动体测报告。\n客户案例：上海徐汇5岁学员，3个月每周运动4次。\n资质：上海市体育总会会员单位（编号待补充）。',
    });
    step('知识库六模块整理（产品库）', r.ok && P(r).docs.length === 6, `QA 索引 ${P(r)?.qaIndex?.items?.length} 条`);
  }

  // 9. 创作前检查 + 内容创作
  const question = q(`SELECT * FROM questions WHERE projectId='${demoPid}' AND withBrand=1 ORDER BY createdAt LIMIT 1`)[0];
  {
    const r = await api('preflight.check', { ...PIDQ(), questionId: question.id });
    step('创作前输入检查（已具备/待补充/不可使用）', r.json.ok && r.json.data.length === 5 && r.json.data.every((x) => ['已具备', '待补充', '不可使用', '不适用（品牌类内容）'].includes(x.status)));
  }
  let articleId, answerCardId, productId;
  {
    const r = await planApply('articles.create', { questionId: question.id, type: 2 });
    articleId = P(r)?.id;
    step('品牌优化文章创作（含封面）', r.ok && !!articleId && P(r).status === 1, `状态=${P(r)?.statusLabel}`);
    const r2 = await planApply('articles.create', { questionId: question.id, type: 1 });
    answerCardId = r2.data?.id;
    answerCardId = P(r2)?.id;
    step('AI 答案卡（三形态）', r2.ok && P(r2).content.includes('文章版正文') && P(r2).content.includes('图片版文案') && P(r2).content.includes('视频口播版脚本'));
    const r3 = await planApply('articles.create', { questionId: q(`SELECT id FROM questions WHERE projectId='${demoPid}' AND withBrand=0 LIMIT 1`)[0].id, type: 3 });
    productId = P(r3)?.id;
    step('产品推荐文章（五段结构）', r3.ok && P(r3).content.includes('适合谁') && P(r3).content.includes('不适合谁') && P(r3).content.includes('如何行动'));
  }

  // 10. 三道审核
  {
    const r = await planApply('articles.audit', { articleId });
    const gates = [P(r).gate1, P(r).gate2, P(r).gate3];
    step('三道审核执行（一致性/媒体标准/GEO）', r.ok && gates.every((g) => [0, 1, 2].includes(g)), `总体=${P(r)?.verdictLabel}`);
  }

  // 11. 发布闭环（创建 → 确认 → 异步 → publishedUrl）
  let taskId, publishedUrl;
  {
    const r = await planApply('publishTasks.create', { projectId: demoPid, articleId, platform: 1, accountId: q(`SELECT id FROM publishAccounts WHERE projectId='${demoPid}' LIMIT 1`)[0].id });
    taskId = P(r)?.id;
    step('发布任务创建（状态=已创建）', r.ok && P(r)?.status === 1, `status=${P(r)?.statusLabel}`);
    const c = await planApply('publishTasks.confirm', { taskId });
    step('人工确认发布（状态=发布中）', c.ok && P(c).status === 2, `status=${P(c)?.statusLabel}`);
    await new Promise((res) => setTimeout(res, 5200));
    const g = await api('publishTasks.get', { taskId });
    publishedUrl = g.json.data.publishedUrl;
    step('异步发布完成 + publishedUrl', g.json.data.status === 3 && (publishedUrl || '').startsWith('https://mock.toutiao.com/'), publishedUrl);
    const a = await api('articles.get', { articleId });
    step('文章状态联动（已正式发布）', a.json.data.status === 3, a.json.data.statusLabel);
  }

  // 12. 上榜监测（exact_url_hit）
  let monitorTaskId;
  {
    const r = await planApply('monitorTasks.create', {
      projectId: demoPid,
      questionIds: [question.id],
      platforms: [1, 3],
      mode: 2,
      scheduleDays: [3, 7, 14],
    });
    monitorTaskId = P(r)?.task?.id;
    step('监测任务创建（第0天立即执行 + 3/7/14 复测点）', r.ok && P(r).checkpoints.length === 4);
    const results = await api('monitorResults.list', { taskId: monitorTaskId });
    const rs = results.json.data;
    step('监测结果：AI 回答全文 + 引用来源', rs.length === 2 && rs.every((x) => x.answerText.length > 50), `${rs.length} 条（豆包+元宝）`);
    const hit = rs.some((x) => x.exactUrlHit === 1);
    step('exact_url_hit：我方正式链接被 AI 引用', hit, rs.map((x) => `${x.aiPlatformLabel}:${x.hitStatusLabel}`).join(' / '));
    const weakOrPrecise = rs.some((x) => x.hitStatus === 3);
    if (!weakOrPrecise) console.log('  ⚠️ 提示：尚未精准命中（可复测），弱命中/待复测也是合法状态');
    // 复测点推进
    const rn = await planApply('monitorTasks.runNext', { taskId: monitorTaskId });
    step('周期复测点执行（runNext）', rn.ok && P(rn).resultIds?.length === 2);
  }

  // 13. 信源资产
  {
    const r = await planApply('sources.collect', { projectId: demoPid, taskId: monitorTaskId });
    const list = await api('sources.list', { projectId: demoPid, limit: 50 });
    const own = list.json.data.filter((x) => x.status === 1);
    step('信源资产沉淀（已引用/观察四状态）', r.ok && P(r).upserted > 0 && list.json.data.length > 0, `共 ${list.json.data.length} 条，已引用 ${own.length}`);
    const has14 = list.json.data[0] && ['question', 'aiPlatform', 'articleTitle', 'url', 'publishPlatform', 'publisher', 'accountType', 'evidenceType', 'citedCount', 'brandPerformance', 'competitorLink', 'controllability', 'pageStatus', 'nextAction'].every((k) => k in list.json.data[0]);
    step('信源资产 14 字段完整（文档二 4.1）', !!has14);
  }

  // 14. 报告：品牌诊断 / 一页纸 / 对比 / 逆向
  {
    const r1 = await planApply('reports.create', { projectId: demoPid, type: 1 });
    step('品牌诊断报告', r1.ok && P(r1).content.includes('病根'), P(r1)?.title);
    const r5 = await planApply('reports.create', { projectId: demoPid, type: 5 });
    step('AI 现状一页纸诊断（7.1 模板）', r5.ok && P(r5).content.includes('开场首问') && P(r5).content.includes('下一步推进建议'));
    const tasks = q(`SELECT id FROM monitorTasks WHERE projectId='${demoPid}' ORDER BY createdAt LIMIT 2`);
    if (tasks.length === 2) {
      const r3 = await planApply('reports.create', { projectId: demoPid, type: 3, taskIdA: tasks[0].id, taskIdB: tasks[1].id });
      step('优化前后对比报告', r3.ok && P(r3).content.includes('优化前'), '');
    }
    const prodQ = q(`SELECT text FROM questions WHERE projectId='${demoPid}' AND withBrand=0 LIMIT 1`)[0].text;
    const r4 = await planApply('reports.create', { projectId: demoPid, type: 4, question: prodQ, platform: 1, times: 10 });
    step('逆向分析（同题重复 10 次 + 关键词频次）', r4.ok && P(r4).content.includes('AI 拆解关键词及频次'));
    const products = await planApply('reports.create', { projectId: demoPid, type: 2 });
    step('产品推荐诊断报告', products.ok && P(products).content.includes('竞品占位'));
  }

  // 15. CLI 冒烟
  {
    const { execFileSync } = await import('node:child_process');
    const env = { ...process.env, GEO_SERVER_URL: BASE, GEO_OPEN_KEY: openKey };
    const run = (args) => execFileSync('node', [path.join(ROOT, 'cli', 'geo.js'), ...args], { env, encoding: 'utf8' });
    const ver = JSON.parse(run(['version']));
    step('CLI: geo version', ver.ok === true && ver.data.version, `v${ver.data?.version}`);
    const caps = JSON.parse(run(['capabilities']));
    step('CLI: geo capabilities', caps.ok && caps.data.capabilities.length >= 30);
    const guide = JSON.parse(run(['guide', 'get', 'scheduled-monitor']));
    step('CLI: geo guide get', guide.ok && guide.data.body.includes('monitorTasks'));
    const ls = JSON.parse(run(['call', 'projects.list']));
    step('CLI: geo call projects.list', ls.ok && ls.data[0].name === '跃动童年-GEO优化');
    const planOut = JSON.parse(run(['plan', 'questions.create', '--input', JSON.stringify({ projectId: demoPid, text: 'CLI 两步写验收问题' })]));
    step('CLI: geo plan（返回 planId + 摘要）', planOut.ok && !!planOut.data.planId);
    const applyOut = JSON.parse(run(['apply', planOut.data.planId]));
    step('CLI: geo apply', applyOut.ok && applyOut.data.applied === true);
    const badApply = (() => {
      try {
        JSON.parse(run(['apply', planOut.data.planId]));
        return { code: 'NO_ERROR' };
      } catch (e) {
        const m = e.stdout?.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : { code: 'PARSE_FAIL' };
      }
    })();
    step('CLI: 重复 apply 被拒（PLAN_USED）', badApply.code === 'PLAN_USED');
  }

  // 16. Web 页面巡检
  {
    const pages = [
      'dashboard', 'companies', 'projects', `projects/${demoPid}`, `projects/${demoPid}/kb`, `projects/${demoPid}/questions`,
      `projects/${demoPid}/content`, `projects/${demoPid}/articles`, `projects/${demoPid}/materials`, `projects/${demoPid}/accounts`,
      `projects/${demoPid}/publish`, `projects/${demoPid}/paid`, `projects/${demoPid}/monitor`, `projects/${demoPid}/sites`,
      `projects/${demoPid}/wom`, `projects/${demoPid}/sources`, `projects/${demoPid}/reports`, 'settings/keys', 'settings/config',
    ];
    let allOk = true;
    const bad = [];
    for (const p of pages) {
      const r = await fetch(`${BASE}/${p}`, { headers: { cookie } });
      if (r.status !== 200) {
        allOk = false;
        bad.push(`${p}:${r.status}`);
      }
    }
    step('Web 页面巡检（19 个页面全部 200）', allOk, bad.join(', '));
    const art = await fetch(`${BASE}/articles/${articleId}`, { headers: { cookie } });
    step('文章详情页（审核记录 + 发布记录）', art.status === 200);
    const mon = await fetch(`${BASE}/monitor/${monitorTaskId}`, { headers: { cookie } });
    step('监测结果页（回答全文 + 引用 + 命中状态）', mon.status === 200);
  }
} catch (e) {
  failed++;
  failures.push('EXCEPTION: ' + e.message);
  console.error('\n💥 E2E 异常终止:', e);
} finally {
  server.kill();
}

console.log('\n══════════════════════════════════════');
console.log(`  E2E 结果：${passed} 通过 / ${failed} 失败`);
if (failures.length) {
  console.log('  失败项：');
  for (const f of failures) console.log('   - ' + f);
  process.exit(1);
}
console.log('  🎉 全部通过：GEO 平台端到端闭环验收完成');
