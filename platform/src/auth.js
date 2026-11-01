import crypto from 'node:crypto';
import { q, q1, run, insert, purgeExpiredSessions } from './db.js';
import { id, nowIso, parseJsonSafe } from './util.js';

const SESSION_TTL_DAYS = 14;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// —— Web 会话（HttpOnly Cookie + DB Session）——
export function currentUser(req) {
  const sid = parseCookies(req).geo_session;
  if (!sid) return null;
  const session = q1('SELECT * FROM sessions WHERE id=?', sid);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    run('DELETE FROM sessions WHERE id=?', sid);
    return null;
  }
  return q1('SELECT * FROM users WHERE id=?', session.userId) || null;
}

export function createSession(res, userId) {
  purgeExpiredSessions();
  const sid = id();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  insert('sessions', { id: sid, userId, expiresAt, createdAt: nowIso() });
  // 生产化：SESSION_SECURE=1 时启用 Secure 标记（HTTPS 部署必须）
  const secure = process.env.SESSION_SECURE === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `geo_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_DAYS * 86400}${secure}`
  );
}

// P0 安全补强（v1.5.2）：改密后失效该用户的所有其他会话（防止旧会话/泄露会话继续访问）
export function destroyOtherSessions(userId, keepSessionId) {
  run('DELETE FROM sessions WHERE userId=? AND id<>?', userId, keepSessionId || '');
}

export function destroySession(req, res) {
  const sid = parseCookies(req).geo_session;
  if (sid) run('DELETE FROM sessions WHERE id=?', sid);
  res.setHeader('Set-Cookie', 'geo_session=; HttpOnly; Path=/; Max-Age=0');
}

// P1：项目可见性 = 用户是项目所属组织的成员
export function userProjectIds(userId) {
  return q(
    `SELECT p.id FROM projects p JOIN companies c ON p.companyId=c.id
     JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=?`,
    userId
  ).map((r) => r.id);
}

export function projectOwnedBy(userId, projectId) {
  return !!q1(
    `SELECT p.id FROM projects p JOIN companies c ON p.companyId=c.id
     JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=? WHERE p.id=?`,
    userId,
    projectId
  );
}

// 成员在项目所属组织中的角色（owner/manager/operator/viewer；非成员 null）
export function projectRole(userId, projectId) {
  return q1(
    `SELECT om.role FROM projects p JOIN companies c ON p.companyId=c.id
     JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=? WHERE p.id=?`,
    userId,
    projectId
  )?.role || null;
}

export function primaryRole(userId) {
  const uid = userId;
  const m = q1(`SELECT om.role FROM orgMembers om WHERE om.userId=? ORDER BY om.createdAt LIMIT 1`, uid);
  return m ? m.role : null;
}

// —— Open Key 认证（Open API 专用）——
export function authOpenKey(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return { ok: false, code: 'AUTH_REQUIRED', message: '缺少 Authorization: Bearer <Open Key>' };
  }
  const keyHash = sha256(m[1].trim());
  const key = q1('SELECT * FROM openKeys WHERE keyHash=?', keyHash);
  if (!key) return { ok: false, code: 'AUTH_REQUIRED', message: '接口密钥无效' };
  if (key.revokedAt) return { ok: false, code: 'AUTH_REQUIRED', message: '接口密钥已吊销' };
  const deviceId = req.headers['x-geo-device'];
  if (key.boundDeviceId && deviceId && key.boundDeviceId !== deviceId) {
    return {
      ok: false,
      code: 'DEVICE_MISMATCH',
      message: '密钥已绑定其他设备，请在原设备使用或重建密钥',
    };
  }
  // 审计 R2-5：写放大治理——60 秒内重复调用不重复落库
  if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > 60_000) {
    run('UPDATE openKeys SET lastUsedAt=? WHERE id=?', nowIso(), key.id);
  }
  return { ok: true, key, authorizedProjectIds: parseJsonSafe(key.authorizedProjectIds, []) };
}

export { sha256 };
