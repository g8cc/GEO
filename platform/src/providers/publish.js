// 发布渠道 Provider（mock）：
// 发布任务是异步的——创建成功 ≠ 已发布。任务创建后进入「已创建/发布中」，
// 由模拟器延迟完成后生成正式链接（publishedUrl）。平台重启时做追赶结算。
// 预留故障注入（GEO_MOCK_FAIL_RATE）用于演练「发布失败 → 故障排查」路径。
import { q, q1, run } from '../db.js';
import { nowIso } from '../util.js';
import { PUBLISH_DOMAIN, label } from '../enums.js';

const FAST = process.env.GEO_MOCK_FAST !== '0'; // 默认快速模式（约 4 秒完成），便于演示
const DELAY_MS = FAST ? 4000 : 20000;
const FAIL_RATE = Number(process.env.GEO_MOCK_FAIL_RATE || 0);

export function createMockPublish(taskId, platform) {
  const willFail = FAIL_RATE > 0 && Math.random() < FAIL_RATE;
  // 审计 R2：定时器内异常不允许击穿进程（稳定性）
  setTimeout(() => {
    try {
      settle(taskId, platform, willFail);
    } catch (e) {
      console.error('[publish:settle]', taskId, e);
    }
  }, DELAY_MS);
}

export function settle(taskId, platform, fail = false) {
  const task = q1('SELECT * FROM publishTasks WHERE id=?', taskId);
  if (!task || task.status !== 2) return; // 只有「发布中」（已人工确认）的任务才会被结算
  if (fail) {
    run(
      `UPDATE publishTasks SET status=4, failReason=? WHERE id=?`,
      `[mock] ${label('publishPlatform', platform)}账号额度不足或素材审核未通过（模拟失败，用于故障排查演练）`,
      taskId
    );
    return;
  }
  const domain = PUBLISH_DOMAIN[platform] || 'mock.ownsite.cn';
  run(
    `UPDATE publishTasks SET status=3, publishedUrl=?, publishedAt=? WHERE id=?`,
    `https://${domain}/article/${taskId.replace(/-/g, '').slice(0, 16)}`,
    nowIso(),
    taskId
  );
  // 文章状态联动：已创建发布任务 → 已正式发布
  run(`UPDATE articles SET status=3, updatedAt=? WHERE id=? AND status=2`, nowIso(), task.articleId);
}

// 服务重启后追赶：仅 mock 模式（manual/webhook 模式的「发布中」是真实中间态，不得自动假结算）
export function catchUpOnStartup() {
  const mode = process.env.PUBLISH_MODE || 'manual';
  if (mode !== 'mock') return;
  const pending = q(`SELECT * FROM publishTasks WHERE status=2`);
  for (const t of pending) {
    const age = Date.now() - new Date(t.createdAt).getTime();
    if (age >= DELAY_MS) settle(t.id, t.platform, false);
    else setTimeout(() => settle(t.id, t.platform, false), DELAY_MS - age);
  }
}

// 生成封面 SVG（mock 配图），返回文件名
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '../db.js';

export function generateCoverSvg(title, projectId) {
  const palette = [
    ['#4f46e5', '#9333ea'],
    ['#0ea5e9', '#22c55e'],
    ['#f59e0b', '#ef4444'],
    ['#14b8a6', '#6366f1'],
  ];
  const [c1, c2] = palette[Math.abs(strHash(title)) % palette.length];
  const safeTitle = title.replace(/[<>&"']/g, '').slice(0, 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="1200" height="675" fill="url(#g)"/>
  <circle cx="1020" cy="120" r="180" fill="rgba(255,255,255,0.12)"/>
  <circle cx="140" cy="580" r="220" fill="rgba(255,255,255,0.08)"/>
  <text x="80" y="300" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="64" font-weight="700" fill="#ffffff">${safeTitle}</text>
  <text x="80" y="400" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="34" fill="rgba(255,255,255,0.85)">GEO 内容资产 · 封面配图（mock 生成）</text>
  <text x="80" y="560" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="26" fill="rgba(255,255,255,0.6)">GEO Platform</text>
</svg>`;
  const name = `cover-${projectId.slice(0, 8)}-${Date.now()}.svg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), svg, 'utf8');
  return `/uploads/${name}`;
}

function strHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
