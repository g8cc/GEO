#!/usr/bin/env node
// geo CLI —— GEO 平台命令行工具（零依赖，Node 20+）
// 所有命令的标准输出永远是一个 JSON 对象。
// 写操作必须两步：geo plan（生成摘要）→ 用户确认 → geo apply。
// 密钥只存本机 ~/.geo/config.json（0600），不经过对话、不写入任何项目文件。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const VERSION = '1.6.0';
const CONFIG_DIR = path.join(os.homedir(), '.geo');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// —— 输出约定 ——
function out(obj, exitCode = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(exitCode);
}
function fail(code, message, nextAction) {
  const e = { ok: false, code, message };
  if (nextAction) e.nextAction = nextAction;
  out(e, 1);
}

// —— 参数解析 ——
function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') flags.input = argv[++i];
    else if (a === '--server') flags.server = argv[++i];
    else if (a === '--key') flags.key = argv[++i];
    else if (a === '--check') flags.check = true;
    else if (a === '--json') flags.json = true;
    else args.push(a);
  }
  return { args, flags };
}

// —— 配置 ——
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
function deviceId() {
  const cfg = loadConfig();
  if (cfg.deviceId) return cfg.deviceId;
  const id = crypto.randomBytes(16).toString('hex');
  saveConfig({ ...cfg, deviceId: id });
  return id;
}
function serverUrl(flags) {
  const url = flags.server || process.env.GEO_SERVER_URL || loadConfig().serverUrl;
  if (!url) fail('AUTH_REQUIRED', '未配置平台地址。先执行 geo auth login --server <平台地址>', { type: 'auth_login' });
  return url.replace(/\/+$/, '');
}
function authHeaders() {
  const key = process.env.GEO_OPEN_KEY || loadConfig().key;
  if (!key) {
    fail('AUTH_REQUIRED', '未登录或密钥缺失。执行 geo auth login 完成本机设备绑定登录', {
      type: 'auth_login',
      command: 'geo auth login',
    });
  }
  return { Authorization: `Bearer ${key}`, 'X-Geo-Device': deviceId(), 'Content-Type': 'application/json' };
}

async function apiPost(base, pathname, body) {
  let res;
  try {
    res = await fetch(base + pathname, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    // 服务暂时不可达是连通性异常，不把已安装的 CLI 误判为缺失，不反复重装
    fail('NETWORK_ERROR', `平台服务不可达（${base}）：${e.message}`, {
      type: 'ask_user',
      message: '请确认 GEO 平台已启动、地址正确',
    });
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    fail('BAD_RESPONSE', `平台返回了无法解析的内容（HTTP ${res.status}）`);
  }
}

// —— auth login：本机设备绑定，密钥不经对话 ——
async function authLogin(flags) {
  const base = (flags.server || process.env.GEO_SERVER_URL || 'http://localhost:3438').replace(/\/+$/, '');
  // 测试/脚本通道：环境变量或 --key 直接绑定（正式流程走本机录入页）
  const directKey = flags.key || process.env.GEO_OPEN_KEY;
  const dev = deviceId();
  if (directKey) {
    const r = await fetch(base + '/api/open/v1/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: directKey, deviceId: dev }),
    }).catch((e) => fail('NETWORK_ERROR', `平台服务不可达：${e.message}`));
    const data = await r.json();
    if (!data.ok) fail(data.code || 'AUTH_REQUIRED', data.message || '密钥验证失败');
    saveConfig({ ...(loadConfig()), serverUrl: base, key: directKey, deviceId: dev });
    out({ ok: true, code: 'OK', data: { bound: true, serverUrl: base, projects: data.data.projects, mode: 'direct' } });
  }
  // 正式流程：本机 loopback 录入页，密钥不经过对话
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>GEO CLI 登录</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f6f7fb;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#fff;padding:32px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:460px}
h1{font-size:18px;margin:0 0 8px}p{color:#6b7280;font-size:13px}
input{width:100%;padding:10px;border:1px solid #e5e8f0;border-radius:8px;font-size:14px;box-sizing:border-box}
button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:14px;cursor:pointer}
.ok{color:#16a34a}.err{color:#dc2626}</style></head><body><div class="card">
<h1>GEO CLI 设备绑定</h1>
<p>请粘贴在 GEO 平台「系统设置 → Open Key」创建的接口密钥。密钥只写入本机 ~/.geo/config.json，不会出现在任何对话中。</p>
<form id="f"><input name="key" placeholder="gk-…" autocomplete="off" required><button>绑定本机</button></form>
<p id="msg"></p></div>
<script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:new FormData(e.target).get('key')})});const d=await r.json();const m=document.getElementById('msg');if(d.ok){m.className='ok';m.textContent='绑定成功，可回到终端查看结果。本页可以关闭了。';}else{m.className='err';m.textContent=d.message||'绑定失败';}};</script>
</body></html>`);
      return;
    }
    if (req.method === 'POST' && req.url === '/submit') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let key = '';
        try {
          key = JSON.parse(body).key || '';
        } catch {}
        const r = await fetch(base + '/api/open/v1/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, deviceId: dev }),
        });
        const data = await r.json();
        if (data.ok) {
          saveConfig({ ...loadConfig(), serverUrl: base, key, deviceId: dev });
          loginResult = { ok: true, projects: data.data.projects };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: data.message }));
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  let loginResult = null;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      process.stderr.write(`\n等待密钥录入：请在浏览器打开  http://127.0.0.1:${port}  粘贴 Open Key\n（最长等待 5 分钟；密钥只写入本机配置，不经过对话）\n\n`);
      const timer = setTimeout(() => resolve(), LOGIN_TIMEOUT_MS);
      const poll = setInterval(() => {
        if (loginResult) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 300);
    });
  });
  server.close();
  if (loginResult?.ok) {
    out({ ok: true, code: 'OK', data: { bound: true, serverUrl: base, projects: loginResult.projects } });
  } else {
    fail('AUTH_TIMEOUT', '超时未完成密钥录入，请重新执行 geo auth login');
  }
}

// —— 主入口 ——
async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const cmd = args[0];

  if (!cmd || cmd === 'help') {
    out({
      ok: true,
      code: 'OK',
      data: {
        usage: [
          'geo version [--check]',
          'geo capabilities',
          'geo guide list | geo guide get <name>',
          'geo auth login [--server URL] | geo auth status | geo auth logout',
          'geo call <capability> [--input \'{...}\']',
          "geo plan <capability> --input '{...}'   # 写操作第一步：生成变更摘要",
          'geo apply <planId>                      # 写操作第二步：用户确认后执行',
        ],
        notes: [
          '输出永远是 JSON 对象；说给用户听用 *Label 字段，过滤与判断用数值字段。',
          '写操作必须 plan → 用户明确同意 → apply；apply 只能执行一次，30 分钟内有效。',
          '密钥只存本机 ~/.geo/config.json；不要把密钥发进对话或写进文件。',
        ],
      },
    });
  }

  if (cmd === 'version') {
    if (flags.check) {
      const base = serverUrl(flags);
      const r = await apiPost(base, '/api/open/v1/call', {});
      const serverVersion = r?.data?.version || '0.0.0';
      const cmp = compareVersions(serverVersion, VERSION);
      if (cmp > 0) {
        out({
          ok: false,
          code: 'CLI_UPDATE_REQUIRED',
          message: `平台要求 CLI >= ${serverVersion}，当前 ${VERSION}`,
          nextAction: { type: 'upgrade', command: 'npm install -g geo-cli@latest && node upgrade-geo-skills.js --apply' },
        }, 1);
      }
      out({ ok: true, code: 'OK', data: { version: VERSION, serverVersion, upToDate: true } });
    }
    out({ ok: true, code: 'OK', data: { version: VERSION, node: process.version } });
  }

  if (cmd === 'capabilities') {
    const base = serverUrl(flags);
    const r = await apiPost(base, '/api/open/v1/call', {});
    if (!r.ok) out(r, 1);
    out({ ok: true, code: 'OK', data: r.data });
  }

  if (cmd === 'guide') {
    const base = serverUrl(flags);
    const name = args[1] === 'get' ? args[2] : args[1];
    if (!name || args[1] === 'list') {
      const r = await apiPost(base, '/api/open/v1/guide/list', {});
      out(r, r.ok ? 0 : 1);
    }
    const r = await apiPost(base, `/api/open/v1/guide/get/${name}`, {});
    out(r, r.ok ? 0 : 1);
  }

  if (cmd === 'auth') {
    const sub = args[1];
    if (sub === 'login') return authLogin(flags);
    if (sub === 'status') {
      const cfg = loadConfig();
      if (!cfg.key) out({ ok: false, code: 'AUTH_REQUIRED', message: '未登录', nextAction: { type: 'auth_login', command: 'geo auth login' } }, 1);
      const r = await apiPost(serverUrl(flags), '/api/open/v1/call/projects.list', {});
      if (!r.ok) out(r, 1);
      out({
        ok: true,
        code: 'OK',
        data: { serverUrl: cfg.serverUrl, bound: true, projects: r.data.slice(0, 100), total: r.data.length },
      });
    }
    if (sub === 'logout') {
      const cfg = loadConfig();
      delete cfg.key;
      saveConfig(cfg);
      out({ ok: true, code: 'OK', data: { loggedOut: true } });
    }
    fail('VALIDATION_ERROR', 'auth 子命令：login | status | logout');
  }

  if (cmd === 'call') {
    const cap = args[1];
    if (!cap) fail('VALIDATION_ERROR', '用法：geo call <capability> [--input \'{...}\']');
    let input = {};
    if (flags.input) {
      try {
        input = JSON.parse(flags.input);
      } catch {
        fail('VALIDATION_ERROR', `--input 不是合法 JSON：${flags.input.slice(0, 60)}`);
      }
    }
    const r = await apiPost(serverUrl(flags), `/api/open/v1/call/${cap}`, { input });
    out(r, r.ok ? 0 : 1);
  }

  if (cmd === 'plan') {
    const cap = args[1];
    if (!cap) fail('VALIDATION_ERROR', "用法：geo plan <capability> --input '{...}'");
    let input = {};
    if (flags.input) {
      try {
        input = JSON.parse(flags.input);
      } catch {
        fail('VALIDATION_ERROR', `--input 不是合法 JSON`);
      }
    }
    const r = await apiPost(serverUrl(flags), `/api/open/v1/plan/${cap}`, { input });
    out(r, r.ok ? 0 : 1);
  }

  if (cmd === 'apply') {
    const planId = args[1];
    if (!planId) fail('VALIDATION_ERROR', '用法：geo apply <planId>');
    const r = await apiPost(serverUrl(flags), `/api/open/v1/apply/${planId}`, { planId });
    out(r, r.ok ? 0 : 1);
  }

  // geo scan: read local project and send to platform
  if (cmd === 'scan') {
    const dir = path.resolve(args[1] || '.');
    if (!fs.existsSync(dir)) fail('VALIDATION_ERROR', 'Directory not found: ' + dir);
    const SKIP = new Set(['node_modules', '.git', '.venv', '.venv', 'dist', 'build']);
    const readSafe = (fp) => { try { const st = fs.statSync(fp); if (st.size > 102400) return ''; return fs.readFileSync(fp, 'utf8').slice(0, 3000); } catch { return ''; } };
    const parts = [];
    for (const name of ['README.md', 'pyproject.toml', 'package.json', 'docker-compose.yml']) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) parts.push('## ' + name + '\n\n' + readSafe(fp));
    }
    try {
      const { execSync } = await import('node:child_process');
      parts.push('## Git Log\n\n' + execSync('git log --oneline -30', { cwd: dir, timeout: 5000 }).toString());
    } catch {}
    const docsDir = path.join(dir, 'docs');
    if (fs.existsSync(docsDir)) {
      for (const d of fs.readdirSync(docsDir).filter(f => f.endsWith('.md')).slice(0, 5)) {
        const c2 = readSafe(path.join(docsDir, d)).slice(0, 500);
        if (c2) parts.push('## docs/' + d + '\n\n' + c2);
      }
    }
    function walkDir(d, depth) {
      if (depth > 2) return [];
      let out = [];
      try {
        for (const f of fs.readdirSync(d)) {
          if (SKIP.has(f) || f.startsWith('.')) continue;
          const fp = path.join(d, f);
          if (fs.statSync(fp).isDirectory()) { out.push(f + '/'); out.push(...walkDir(fp, depth + 1)); }
        }
      } catch {}
      return out;
    }
    const structure = walkDir(dir, 0).slice(0, 40);
    if (structure.length) parts.push('## Directory Structure\n\n' + structure.join('\n'));
    const profile = parts.join('\n\n').slice(0, 12000);
    if (profile.length < 100) fail('VALIDATION_ERROR', 'Project has too little content');
    const r = await apiPost(serverUrl(flags), '/api/open/v1/auto-geo', { profile, dirName: path.basename(dir) });
    out(r, r.ok ? 0 : 1);
  }
  fail('NOT_FOUND', `未知命令：${cmd}。执行 geo help 查看用法`);
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

main().catch((e) => fail('INTERNAL', e.message));
