import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function id() {
  return crypto.randomUUID();
}

export function shortId() {
  return crypto.randomBytes(6).toString('hex');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export { escapeHtml as e };

// —— 确定性伪随机（同一输入产生同一输出，语料/文章变化才会改变结果）——
export function strHash(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(...parts) {
  return mulberry32(strHash(parts.join('|')));
}

// —— 简易中文分词：CJK 双字组 + ASCII 词，用于问题-文章相关度计算 ——
export function tokenize(text) {
  const tokens = new Set();
  const cleaned = String(text ?? '').toLowerCase();
  const ascii = cleaned.match(/[a-z0-9][a-z0-9+#.\-]{1,}/g) || [];
  for (const w of ascii) tokens.add(w);
  const cjk = cleaned.replace(/[^\u4e00-\u9fff]+/g, ' ');
  for (const seg of cjk.split(' ')) {
    if (seg.length === 1) {
      tokens.add(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) tokens.add(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size); // 用 min 而非并集：偏重问题核心词覆盖率
}

export function parseJsonSafe(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function truncate(text, len = 120) {
  const s = String(text ?? '').replaceAll(/\s+/g, ' ').trim();
  return s.length > len ? s.slice(0, len) + '…' : s;
}

// —— 审计修复 P0-3：上传扩展名白名单（防路径穿越 / 任意文件写入）——
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'pdf']);
export function safeUploadExt(name) {
  const raw = String(name ?? '').split('.').pop() || '';
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  return ALLOWED_EXTS.has(ext) ? ext : 'bin';
}

// —— 审计修复 P0-4：用户可控 URL 只允许 http(s) 与站内相对路径，并做属性级转义 ——
export function safeUrl(url) {
  const s = String(url ?? '').trim();
  if (/^https?:\/\//i.test(s)) return escapeHtml(s);
  if (s.startsWith('/') && !s.startsWith('//')) return escapeHtml(s);
  return '#'; // javascript: / data: 等一律置空链接
}

// P0-4 密码策略：≥8 位且同时包含字母与数字
export function passwordPolicyError(pw) {
  const p = String(pw || '');
  if (p.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return '密码必须同时包含字母和数字';
  return null;
}

// v1.6.1 结构化日志：统一 JSON 格式输出到 stderr
export function slog(level, module, message, extra) {
  const entry = { ts: new Date().toISOString(), level, module, msg: message };
  if (extra) entry.extra = extra;
  process.stderr.write(JSON.stringify(entry) + '\n');
}
