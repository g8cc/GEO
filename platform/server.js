// GEO 营销平台入口：Web UI + Open API + Mock Providers
// 零外部依赖：Node 22.5+（推荐 24），node:sqlite 存储
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemo, UPLOADS_DIR, purgeExpiredSessions } from './src/db.js';
import { currentUser, userProjectIds, primaryRole } from './src/auth.js';
import { handleOpenApi } from './src/openapi.js';
import { handleWeb, ROUTES } from './src/web/routes.js';
import { layout } from './src/web/ui.js';
import { gatherNextStep, gatherTourCounts, buildTourSteps, buildMissions, PAGE_TOURS } from './src/web/nextstep.js';
import { catchUpOnStartup } from './src/providers/publish.js';
import { applySettingsToEnv } from './src/settings.js';
import { backfillOrgs } from './src/db.js';
import { audit } from './src/db.js';
import { runDueCheckpointsAll } from './src/services.js';

// P1-4 定时调度：每 60 秒执行全站到期复测点（不依赖页面访问）
let schedBusy = false;
setInterval(async () => {
  if (schedBusy) return;
  schedBusy = true;
  try {
    const n = await runDueCheckpointsAll();
    if (n > 0) console.log(`[scheduler] 执行到期复测点 ${n} 个`);
  } catch (e) {
    console.error('[scheduler]', e.message);
  } finally {
    schedBusy = false;
  }
}, 60_000).unref?.();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3438);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    };
    // 审计 R2-3：SVG 可内嵌脚本，用户可上传——从 /uploads 直开时强制下载而非内联执行
    if (ext === '.svg' && filePath.startsWith(UPLOADS_DIR)) {
      headers['Content-Disposition'] = 'attachment';
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ctype = req.headers['content-type'] || '';
      if (ctype.includes('application/json')) {
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          resolve({});
        }
      } else {
        // urlencoded：重复键收集为数组
        const out = {};
        for (const pair of raw.split('&')) {
          if (!pair) continue;
          const idx = pair.indexOf('=');
          const k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '));
          const v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
          if (k in out) {
            if (Array.isArray(out[k])) out[k].push(v);
            else out[k] = [out[k], v];
          } else out[k] = v;
        }
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}

function notFoundPage(res, user) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    layout({
      title: '404',
      user,
      body: '<div class="card"><h2>404</h2><p class="kv">页面不存在。<a href="/dashboard">返回工作台</a></p></div>',
    })
  );
}

// 所有权守卫：/projects/:id/* 直接校验项目归属；/articles|/publish|/monitor|/reports/:id
// 先解析资源的 projectId 再校验。返回 false → 404。
import { getProjectSafe, BizError } from './src/services.js';
import { q1 } from './src/db.js';
async function ownershipGuard(userId, pathname) {
  const ID = '([a-f0-9-]{36})';
  let m;
  if ((m = pathname.match(new RegExp(`^/projects/${ID}(/|$)`)))) {
    return !!getProjectSafe(userId, m[1]);
  }
  const via = (table, column) => {
    const row = q1(`SELECT projectId FROM ${table} WHERE id=?`, m[1]);
    return row ? !!getProjectSafe(userId, row.projectId) : true; // 不存在的资源交给 handler 走 404
  };
  if ((m = pathname.match(new RegExp(`^/articles/${ID}(/|$)`)))) return via('articles');
  if ((m = pathname.match(new RegExp(`^/publish/${ID}(/|$)`)))) return via('publishTasks');
  if ((m = pathname.match(new RegExp(`^/monitor/${ID}(/|$)`)))) return via('monitorTasks');
  if ((m = pathname.match(new RegExp(`^/reports/${ID}(/|$)`)))) return via('reports');
  return true;
}


// v1.2 安全：认证类接口内存限流（30 次/分钟/IP），关闭旧审计已知边界
const RATE_LIMIT_PATHS = new Set(['/login', '/register', '/api/open/v1/auth/verify']);
const rateBuckets = new Map();
function rateLimit(req, res, pathname) {
  if (req.method !== 'POST' || !RATE_LIMIT_PATHS.has(pathname)) return true;
  // 审计 v1.2-F1：直连场景 X-Forwarded-For 可伪造绕过限流；仅 TRUST_PROXY=1（Nginx 等反代后）才信任代理头
  const trustProxy = process.env.TRUST_PROXY === '1';
  const ip = trustProxy
    ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
    : String(req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const arr = (rateBuckets.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  rateBuckets.set(ip, arr);
  if (rateBuckets.size > 5000) rateBuckets.clear(); // 防表无限增长
  if (arr.length > 30) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }));
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // v1.2 安全：认证类接口限流（login/register/auth/verify）
    if (!rateLimit(req, res, pathname)) return;

    // 静态资源
    if (pathname === '/style.css' || pathname === '/tour.js' || pathname.startsWith('/assets/')) {
      const rel = pathname === '/style.css' ? 'style.css' : pathname === '/tour.js' ? 'tour.js' : pathname.slice('/assets/'.length);
      return serveStatic(res, path.join(PUBLIC_DIR, rel));
    }
    if (pathname.startsWith('/uploads/')) {
      const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      return serveStatic(res, path.join(UPLOADS_DIR, path.basename(safe)));
    }

    // Open API
    if (pathname.startsWith('/api/open/')) {
      const body = req.method === 'POST' ? await parseBody(req) : {};
      return await handleOpenApi(req, res, pathname, body);
    }

    if (pathname.startsWith('/api/job/')) {
      const jobId = pathname.split('/api/job/')[1];
      const { getJob } = await import('./src/services.js');
      const job = getJob(jobId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(job ? { id: job.id, type: job.type, status: job.status, result: JSON.parse(job.result || '{}'), error: job.error, redirectUrl: job.redirectUrl } : { error: 'not found' }));
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'geo-platform' }));
    }

    // 审计 R2-4：Web 响应安全头
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    // Web
    const user = currentUser(req);
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!user && !['/login', '/register', '/terms', '/privacy'].includes(pathname)) {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    // v1.5.1 修复：已登录用户打开裸域名 / 时应进入工作台（此前 404——测试盲区：只测过 /dashboard 直达）
    if (user && ['/', '/index', '/index.html'].includes(pathname)) {
      res.writeHead(302, { Location: '/dashboard' });
      return res.end();
    }
    // P0-4：必须改密的账号只能访问改密页与登出
    if (user && user.mustChangePassword && !['/change-password', '/logout'].includes(pathname)) {
      res.writeHead(302, { Location: '/change-password' });
      return res.end();
    }
    // P1-2 角色鉴权：viewer 全站只读（写操作 403）；系统配置/审计仅全局 admin
    if (user && req.method === 'POST' && primaryRole(user.id) === 'viewer' && pathname !== '/logout') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px"><h2>403 · 只读成员</h2><p>你的账号为「只读」角色，无写入权限。请联系团队管理员调整角色。</p><a href="/dashboard">返回</a></body></html>');
      return;
    }
    if (user && primaryRole(user.id) !== 'owner' && user.role !== 'admin' && /^\/settings\/(config|audit|members)/.test(pathname)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px"><h2>403 · 仅团队所有者</h2><p>系统配置、审计日志与成员管理仅团队所有者（owner）可访问。</p><a href="/dashboard">返回</a></body></html>');
      return;
    }
    global.__userProjects = user ? userProjectIds(user.id) : [];
    // 新手引导：按用户数据状态计算「当前建议下一步」（横幅 + 欢迎层使用）
    try {
      if (user) {
        const counts = gatherTourCounts(user.id, url.searchParams.get('p'));
        global.__nextStep = gatherNextStep(user.id, url.searchParams.get('p'));
        global.__tourSteps = buildTourSteps(counts);
        global.__missions = buildMissions(counts);
      } else {
        global.__nextStep = null;
        global.__tourSteps = [];
        global.__missions = null;
      }
    } catch {
      global.__nextStep = null;
      global.__tourSteps = [];
      global.__missions = null;
    }

    // 审计修复 P0-1：集中所有权守卫——凡以资源 ID 定位的路径，一律校验归属当前用户，
    // 不依赖各 handler 自觉。资源存在但不属于当前用户 → 一律 404（不泄露存在性）。
    if (user) {
      const owns = await ownershipGuard(user.id, pathname);
      if (!owns) { console.log('[dispatch] 守卫拦截', pathname); return notFoundPage(res, user); }
    }

    const match = await handleWeb(req, res, pathname, Object.fromEntries(url.searchParams), null);
    if (!match) { console.log('[dispatch] 无路由匹配', req.method, pathname); return notFoundPage(res, user); }

    const body = req.method === 'POST' ? await parseBody(req) : {};
    const c = {
      user,
      query: Object.fromEntries(url.searchParams),
      body,
      ip: clientIp,
      params: match.params,
      render(title, active = '', projId = '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(layout({ title, user, active, projId, body: c.body }));
      },
      notFound() {
        notFoundPage(res, user);
      },
    };
    await match.route.handler(req, res, c);
    // P0-4 操作审计：所有登录后 POST 写操作（login/register/change-password 有专项记录，跳过）
    if (req.method === 'POST' && user && !['/login', '/register', '/change-password'].includes(pathname)) {
      const safeBody = {};
      for (const [k, v] of Object.entries(body || {})) {
        if (/password|token|secret|key/i.test(k)) safeBody[k] = '***';
        else safeBody[k] = typeof v === 'string' ? String(v).slice(0, 120) : v;
      }
      audit(user.id, user.email, `POST ${pathname}`, JSON.stringify(safeBody).slice(0, 500), clientIp);
    }
  } catch (err) {
    // 审计 R2-1：业务校验错误（BizError）返回 400 友好页，不进 500
    if (err && (err instanceof BizError || err.code === 'CAPABILITY_ERROR')) {
      const msg = String(err.message || '请求不合法').replace(/[<>&"']/g, '');
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>请求不合法</title><link rel="stylesheet" href="/style.css"></head><body><main class="main"><div class="card"><h2>操作未完成</h2><p class="kv">${msg}</p><p><a href="/dashboard">返回工作台</a></p></div></main></body></html>`
      );
      return;
    }
    // 审计修复 P0-2：不向客户端泄露堆栈与内部路径，细节仅写服务端日志
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>服务错误</title><link rel="stylesheet" href="/style.css"></head><body><main class="main"><div class="card"><h2>服务暂时不可用</h2><p class="kv">服务器内部错误，请稍后重试；若持续出现请查看服务端日志（log_id: ${Date.now().toString(36)}）。</p><p><a href="/dashboard">返回工作台</a></p></div></main></body></html>`
      );
    } else {
      res.end();
    }
  }
});

backfillOrgs(); // v1.4：兜底补齐无组织公司（seed 与历史数据）
applySettingsToEnv(); // v1.2：DB 配置覆盖部署环境变量（系统配置页保存后立即生效）
seedDemo();
purgeExpiredSessions(); // 审计 R1：启动清理过期会话
catchUpOnStartup();
server.listen(PORT, () => {
  console.log(``);
  console.log(`  GEO 营销平台已启动`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Web 界面    http://localhost:${PORT}`);
  console.log(`  演示账号    demo@geo.local（密码见 docs/README.md 或首次启动时自动生成）`);
  console.log(`  Open API    http://localhost:${PORT}/api/open/v1/call  (POST, Bearer Open Key)`);
  console.log(`  能力清单    geo capabilities（CLI）或 POST /api/open/v1/call`);
  console.log(``);
});
