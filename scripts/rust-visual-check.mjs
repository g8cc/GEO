#!/usr/bin/env node
// rust-visual-check.mjs —— 渲染级视觉检查（截图 harness）
// 背景：v1.6.2 登录页事故——HTML 断言全绿但页面实际丢失布局壳。grep/curl 证明"字符串存在"，
//       不能证明"用户看到的是对的"。本脚本用无头 Chrome 真实渲染关键页面并截图，
//       UI 相关变更交付前必须运行并逐张打开确认（这是流程要求，见 docs/DELIVERY-CHECKLIST.md §F）。
//
// 用法：node scripts/rust-visual-check.mjs [BASE] [输出目录]
//   BASE 默认 http://localhost:3439（需先启动服务；会自动用 demo@geo.local/demo1234 登录）
//   依赖：本机 Chrome（CHROME_BIN 可覆盖路径）+ Node ≥ 21（全局 WebSocket/fetch，零 npm 依赖）
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:3439').replace(/\/$/, '');
const OUT = process.argv[3] || '/tmp/geo-visual';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VW = 1440, VH = 900;

if (!fs.existsSync(CHROME)) {
  console.error(`✗ 未找到 Chrome（${CHROME}）。设置 CHROME_BIN 指向 Chrome/Chromium 后重试。`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

// ---- 1. 启动无头 Chrome（CDP 调试端口）----
const profile = mkdtempSync(join(tmpdir(), 'geo-visual-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=0`, `--user-data-dir=${profile}`,
  `--window-size=${VW},${VH}`, 'about:blank',
]);
const wsEndpoint = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 15000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(timer); resolve(m[1]); }
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome 退出（code=${code}）`)));
});
const httpPort = wsEndpoint.match(/:(\d+)\//)[1];

// ---- 2. CDP 最小客户端（零依赖）----
async function cdpSession(url) {
  const res = await fetch(`http://127.0.0.1:${httpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
    else if (data.method) events.push(data.method);
  };
  return {
    events,
    send(method, params = {}) {
      return new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
    },
    close() { ws.close(); },
  };
}

// ---- 3. 登录拿会话 Cookie（fetch 不受浏览器限制）----
async function loginCookie() {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=demo@geo.local&password=demo1234',
    redirect: 'manual',
  });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/geo_session=([^;]+)/);
  if (!m) throw new Error(`登录失败（${r.status}）——无法获取会话 Cookie`);
  return m[1];
}

// ---- 4. 截图一张（注入 Cookie → 导航 → 等待加载）----
async function shot(session, url, file) {
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Network.enable');
  await session.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  const u = new URL(url);
  await session.send('Network.setCookie', { name: 'geo_session', value: session.__sid, url: `${u.protocol}//${u.host}`, path: '/' });
  await session.send('Page.navigate', { url });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !session.events.includes('Page.loadEventFired')) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600)); // 等待字体/渐变稳定
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}

// ---- 5. 执行：公开页 + 登录后关键页 ----
const sid = await loginCookie();
const projectsHtml = await (await fetch(`${BASE}/dashboard`, { headers: { cookie: `geo_session=${sid}` } })).text();
const pid = (projectsHtml.match(/option value="([a-f0-9-]{36})" selected/) || [])[1] || '';

const pages = [
  ['login', `${BASE}/login`],
  ['login-error', `${BASE}/login?error=${encodeURIComponent('邮箱或密码错误（演示错误横幅）')}`],
  ['register', `${BASE}/register`],
  ['terms', `${BASE}/terms`],
  ['dashboard', `${BASE}/dashboard`],
  ['companies', `${BASE}/companies`],
  ['settings-keys', `${BASE}/settings/keys`],
  ['team', `${BASE}/team`],
  ['auto-geo', `${BASE}/auto-geo`],
];
if (pid) {
  pages.push(
    ['project-overview', `${BASE}/projects/${pid}`],
    ['project-kb', `${BASE}/projects/${pid}/kb`],
    ['project-questions', `${BASE}/projects/${pid}/questions`],
    ['project-monitor', `${BASE}/projects/${pid}/monitor`],
    ['project-sources', `${BASE}/projects/${pid}/sources`],
  );
}

console.log(`▸ 渲染检查 ${pages.length} 个页面 → ${OUT}`);
let ok = 0;
for (const [name, url] of pages) {
  const session = await cdpSession('about:blank');
  session.__sid = sid;
  try {
    const file = join(OUT, `${name}.png`);
    await shot(session, url, file);
    const size = fs.statSync(file).size;
    if (size < 5000) throw new Error(`截图异常偏小（${size}B）`);
    console.log(`  ✅ ${name}.png（${(size / 1024).toFixed(0)}KB）`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
  session.close();
}
chrome.kill();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }, 1500);
console.log(`\n${ok === pages.length ? '🎉' : '⚠️'} 完成：${ok}/${pages.length} 页截图成功 → ${OUT}`);
console.log('⚠️  请逐张打开确认视觉质量——本脚本的职责是"渲染给你看"，判断仍需人眼。');
process.exit(ok === pages.length ? 0 : 1);
