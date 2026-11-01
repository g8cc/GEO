import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { nowIso, id } from './util.js';
export { id };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = process.env.GEO_DB_PATH || path.join(DATA_DIR, 'geo.db');
export const UPLOADS_DIR = UPLOAD_DIR;

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// —— 密码（scrypt）——
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  // 审计 R1：timing-safe 比较，消除时序侧信道
  const a = Buffer.from(crypto.scryptSync(password, salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 审计 R1（稳定性）：启动与登录时清理过期会话，防止 sessions 表无限增长
export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expiresAt < ?', new Date().toISOString());
}

// —— Schema ——
export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, ownerUserId TEXT NOT NULL, name TEXT NOT NULL, industry TEXT, intro TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, companyId TEXT NOT NULL, name TEXT NOT NULL,
    brandName TEXT, productName TEXT, region TEXT, business TEXT, sellingPoints TEXT, keywords TEXT,
    defaultPlatforms TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS openKeys (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL,
    keyPrefix TEXT NOT NULL, keyHash TEXT UNIQUE NOT NULL,
    authorizedProjectIds TEXT NOT NULL DEFAULT '[]', boundDeviceId TEXT,
    lastUsedAt TEXT, revokedAt TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, keyId TEXT, capability TEXT NOT NULL,
    input TEXT NOT NULL, summary TEXT NOT NULL, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledgeBases (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, type INTEGER NOT NULL, name TEXT NOT NULL,
    qaIndex TEXT, conflictList TEXT, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kbDocuments (
    id TEXT PRIMARY KEY, kbId TEXT NOT NULL, module INTEGER NOT NULL DEFAULT 1, title TEXT NOT NULL,
    content TEXT NOT NULL, evidence TEXT, pending TEXT, source TEXT, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, text TEXT NOT NULL,
    category INTEGER NOT NULL DEFAULT 1, stage INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 2,
    status INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, withBrand INTEGER NOT NULL DEFAULT 0,
    intentDimension TEXT, keywords TEXT, source TEXT NOT NULL DEFAULT '人工', createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, questionId TEXT, title TEXT NOT NULL, content TEXT NOT NULL,
    type INTEGER NOT NULL DEFAULT 2, coverMaterialId TEXT, status INTEGER NOT NULL DEFAULT 0,
    meta TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL,
    url TEXT NOT NULL, meta TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auditRecords (
    id TEXT PRIMARY KEY, articleId TEXT NOT NULL,
    gate1 INTEGER NOT NULL, gate1Issues TEXT, gate2 INTEGER NOT NULL, gate2Issues TEXT,
    gate3 INTEGER NOT NULL, gate3Issues TEXT, verdict INTEGER NOT NULL,
    evidenceLinks TEXT, pendingFacts TEXT, changes TEXT, auditor TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS publishAccounts (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, platform INTEGER NOT NULL, accountName TEXT NOT NULL,
    accountType INTEGER NOT NULL DEFAULT 2, authStatus INTEGER NOT NULL DEFAULT 1,
    quota INTEGER NOT NULL DEFAULT 10, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS publishTasks (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, articleId TEXT NOT NULL, platform INTEGER NOT NULL,
    accountId TEXT, status INTEGER NOT NULL DEFAULT 1, publishedUrl TEXT, publishedAt TEXT,
    failReason TEXT, packageJson TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitorTasks (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, questionIds TEXT NOT NULL, platforms TEXT NOT NULL,
    mode INTEGER NOT NULL DEFAULT 1, scheduleDays TEXT, status INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitorCheckpoints (
    id TEXT PRIMARY KEY, taskId TEXT NOT NULL, day INTEGER NOT NULL DEFAULT 0, dueAt TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 1, resultIds TEXT, ranAt TEXT
  );
  CREATE TABLE IF NOT EXISTS monitorResults (
    id TEXT PRIMARY KEY, taskId TEXT, checkpointId TEXT, projectId TEXT NOT NULL, questionId TEXT NOT NULL,
    platform INTEGER NOT NULL, ranAt TEXT NOT NULL,
    answerText TEXT NOT NULL, brandMentioned INTEGER NOT NULL DEFAULT 0, mentionPosition TEXT,
    brandAccurate INTEGER, recommendLevel INTEGER NOT NULL DEFAULT 0, recommendReason TEXT,
    competitors TEXT, citations TEXT, keywords TEXT,
    hitStatus INTEGER NOT NULL DEFAULT 0, pageAccessible INTEGER, nextStep TEXT, nextOptimize TEXT,
    exactUrlHit INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sourceAssets (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, question TEXT, aiPlatform INTEGER,
    articleTitle TEXT, url TEXT, publishPlatform INTEGER, publisher INTEGER, accountType INTEGER,
    evidenceType INTEGER, citedCount INTEGER NOT NULL DEFAULT 0, brandPerformance TEXT, competitorLink TEXT,
    controllability INTEGER, pageStatus INTEGER, status INTEGER NOT NULL DEFAULT 2,
    nextAction TEXT, adaptPlatforms TEXT, needProve TEXT, remark TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, ownerUserId TEXT NOT NULL,
    quotaMonitorMonthly INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orgMembers (
    id TEXT PRIMARY KEY, orgId TEXT NOT NULL, userId TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator', createdAt TEXT NOT NULL,
    UNIQUE(orgId, userId)
  );
  CREATE TABLE IF NOT EXISTS subscriptionPlans (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, price TEXT, durationDays INTEGER NOT NULL,
    monitorQuotaMonthly INTEGER NOT NULL, maxMembers INTEGER NOT NULL DEFAULT 3,
    maxProjects INTEGER NOT NULL DEFAULT 3, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS licenseKeys (
    key TEXT PRIMARY KEY, planCode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unused',
    usedByOrg TEXT, usedAt TEXT, note TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    input TEXT, result TEXT, error TEXT, redirectUrl TEXT,
    orgId TEXT, createdAt TEXT NOT NULL, completedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS usageCounters (
    orgId TEXT NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (orgId, day, type)
  );
  CREATE TABLE IF NOT EXISTS auditLog (
    id TEXT PRIMARY KEY, userId TEXT, email TEXT, action TEXT NOT NULL,
    target TEXT, ip TEXT, createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, type INTEGER NOT NULL, title TEXT NOT NULL,
    content TEXT NOT NULL, relatedTaskIds TEXT, createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_questions_project ON questions(projectId);
  CREATE INDEX IF NOT EXISTS idx_articles_project ON articles(projectId);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON monitorTasks(projectId);
  CREATE INDEX IF NOT EXISTS idx_results_task ON monitorResults(taskId);
  CREATE INDEX IF NOT EXISTS idx_results_project ON monitorResults(projectId);
  CREATE INDEX IF NOT EXISTS idx_publishTasks_project ON publishTasks(projectId);
  CREATE INDEX IF NOT EXISTS idx_publishTasks_article ON publishTasks(articleId);
  CREATE INDEX IF NOT EXISTS idx_sourceAssets_project ON sourceAssets(projectId);
  CREATE INDEX IF NOT EXISTS idx_auditRecords_article ON auditRecords(articleId);
  CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(projectId);
  CREATE INDEX IF NOT EXISTS idx_accounts_project ON publishAccounts(projectId);
  CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(projectId);
  CREATE INDEX IF NOT EXISTS idx_kbDocuments_kb ON kbDocuments(kbId);
  CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON monitorCheckpoints(taskId);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_openKeys_user ON openKeys(userId);
  CREATE INDEX IF NOT EXISTS idx_auditLog_time ON auditLog(createdAt);
  `);

  // 轻量列迁移：users 增加 P0 安全列（存在即跳过）
  const userCols = q('PRAGMA table_info(users)').map((r) => r.name);
  if (!userCols.includes('mustChangePassword')) run('ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0');
  if (!userCols.includes('failedAttempts')) run('ALTER TABLE users ADD COLUMN failedAttempts INTEGER NOT NULL DEFAULT 0');
  if (!userCols.includes('lockedUntil')) run('ALTER TABLE users ADD COLUMN lockedUntil TEXT');
  const artCols = q('PRAGMA table_info(articles)').map((r) => r.name);
  if (!artCols.includes('aiDeclaration')) run('ALTER TABLE articles ADD COLUMN aiDeclaration INTEGER NOT NULL DEFAULT 1');
  const mrCols = q('PRAGMA table_info(monitorResults)').map((r) => r.name);
  if (!mrCols.includes('dataSource')) run("ALTER TABLE monitorResults ADD COLUMN dataSource TEXT NOT NULL DEFAULT 'mock'");
  const compCols = q('PRAGMA table_info(companies)').map((r) => r.name);
  if (!compCols.includes('orgId')) run('ALTER TABLE companies ADD COLUMN orgId TEXT');
  const orgCols = q('PRAGMA table_info(orgs)').map((r) => r.name);
  for (const col of ['planCode', 'planExpiresAt', 'notifyWebhook', 'notifyEvents']) {
    if (!orgCols.includes(col)) run(`ALTER TABLE orgs ADD COLUMN ${col} TEXT`);
  }
  // P1 迁移：为历史无组织公司补建默认团队（backfillOrgs 幂等，启动时也会再跑一次兜底 seed）
  if (q1('SELECT COUNT(*) as n FROM companies WHERE orgId IS NULL').n > 0) backfillOrgs();
  // 终局-A：内置套餐（幂等）
  for (const pl of [
    ['trial', '体验版', '免费', 7, 50, 2, 1],
    ['basic', '基础版', '¥1,999/月', 30, 500, 3, 3],
    ['pro', '专业版', '¥5,999/月', 30, 2000, 10, 10],
  ]) {
    run(`INSERT INTO subscriptionPlans (code, name, price, durationDays, monitorQuotaMonthly, maxMembers, maxProjects, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO NOTHING`, pl[0], pl[1], pl[2], pl[3], pl[4], pl[5], pl[6], nowIso());
  }
}

// —— 基础查询助手 ——
export function q(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function q1(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
export function insert(table, row) {
  const keys = Object.keys(row);
  run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => row[k])
  );
  return row;
}

// —— 项目双知识库（品牌/产品）自动就绪 ——
export function ensureKbs(projectId) {
  for (const [type, name] of [
    [1, '品牌知识库'],
    [2, '产品知识库'],
  ]) {
    const exists = q1('SELECT id FROM knowledgeBases WHERE projectId=? AND type=?', projectId, type);
    if (!exists) {
      insert('knowledgeBases', {
        id: id(),
        projectId,
        type,
        name,
        qaIndex: '',
        conflictList: '',
        updatedAt: nowIso(),
      });
    }
  }
}

// —— 演示种子数据 ——
export function seedDemo() {
  // 生产化：SEED_DEMO=0 时跳过演示数据（生产部署应由管理员创建真实账号）
  if (process.env.SEED_DEMO === '0') return null;
  const existing = q1('SELECT id FROM users WHERE email=?', 'demo@geo.local');
  if (existing) return existing.id;

  const { hash, salt } = hashPassword('demo1234');
  const userId = id();
  insert('users', { id: userId, email: 'demo@geo.local', passwordHash: hash, salt, role: 'admin', createdAt: nowIso() });

  const companyId = id();
  const demoOrgId = id();
  insert('orgs', { id: demoOrgId, name: '跃动童年（演示） 的团队', ownerUserId: userId, quotaMonitorMonthly: 0, createdAt: nowIso() });
  insert('orgMembers', { id: id(), orgId: demoOrgId, userId, role: 'owner', createdAt: nowIso() });
  insert('companies', {
    id: companyId,
    ownerUserId: userId,
    orgId: demoOrgId,
    name: '跃动童年（演示）',
    industry: '少儿体育教育',
    intro: '面向 3-8 岁儿童的居家体感运动品牌（演示数据）',
    createdAt: nowIso(),
  });

  const projectId = id();
  insert('projects', {
    id: projectId,
    companyId,
    name: '跃动童年-GEO优化',
    brandName: '跃动童年',
    productName: '跃动童年体感运动课',
    region: '上海',
    business: '3-8岁儿童客厅体感运动',
    sellingPoints: '无需穿戴设备 / 家长端实时生成运动体测报告',
    keywords: '儿童运动馆,体感运动,少儿体能',
    defaultPlatforms: JSON.stringify([1, 2, 3, 4]),
    createdAt: nowIso(),
  });
  ensureKbs(projectId);

  // 竞品种子（监测 mock 用）
  run(
    `UPDATE knowledgeBases SET qaIndex=?, updatedAt=? WHERE projectId=? AND type=1`,
    JSON.stringify({
      note: '品牌高频 Q&A 索引（示例）',
      items: [
        { q: '跃动童年是什么公司？', a: '回溯 01_定位与业务边界' },
        { q: '跃动童年体感运动课多少钱？', a: '回溯 02_产品与服务事实' },
      ],
    }),
    nowIso(),
    projectId
  );

  // 竞品信息存入项目 meta：这里用 kbDocuments 04 模块承载，监测 provider 从 04 模块解析竞品
  const brandKb = q1('SELECT id FROM knowledgeBases WHERE projectId=? AND type=1', projectId);
  const modules = [
    [1, '01_定位与业务边界', '跃动童年是专注 3-8 岁儿童客厅体感运动的少儿体育品牌，服务上海地区家庭。\n核心场景：居家运动、亲子互动、日常体能锻炼。\n明确不做：线下场馆培训、6 岁以上竞技体能训练。'],
    [2, '02_产品与服务事实', '产品名称：跃动童年体感运动课。\n标准价格：年度会员 2980 元，月度会员 398 元。\n服务时长：每次 25 分钟，每周建议 3 次。\n核心功能：无需穿戴设备，摄像头识别动作；家长端实时生成运动体测报告。\n交付内容：课程内容订阅 + 家长端报告 + 每月 1 次教练在线指导。'],
    [3, '03_客户与使用场景', '目标客户：3-8 岁儿童家长，关注日常运动量不足、居家场景。\n典型需求：晚饭后 20 分钟运动、雨天户外替代、体能测评。\n决策条件：价格、是否需要额外设备、孩子年龄适配。\n常见问题：几岁能用？需要买什么设备？和线下体适能比怎么样？'],
    [4, '04_优势与竞品差异（内部）', '竞品：跳跳鲨少儿体感（线下场馆为主）、乐翻高儿童运动馆（App 课程）。\n差异：无需穿戴设备；家长端体测报告；客厅场景 25 分钟短课时。\n证据：产品页参数与案例见 02/05 模块。'],
    [5, '05_案例与结果', '案例：上海徐汇 5 岁学员家庭，使用 3 个月，每周运动次数从 1 次提升到 4 次，家长端体测报告显示协调性评分提升。\n可公开对比：使用前后每周运动频次与家长满意度（9.1/10）。'],
    [6, '06_权威背书与外部证据', '资质：上海市体育总会会员单位（编号待补充：需业务部门提供）。\n报道：少儿家庭教育论坛分享（待补充原始链接）。\n第三方引用：家长社区评价若干（待补充链接）。'],
  ];
  for (const [module, title, content] of modules) {
    insert('kbDocuments', {
      id: id(),
      kbId: brandKb.id,
      module,
      title,
      content,
      evidence: JSON.stringify([]),
      pending: content.includes('待补充') ? '资质编号、报道原文链接、社区评价链接待业务部门提供' : '',
      source: '演示种子数据',
      updatedAt: nowIso(),
    });
  }
  const productKb = q1('SELECT id FROM knowledgeBases WHERE projectId=? AND type=2', projectId);
  insert('kbDocuments', {
    id: id(),
    kbId: productKb.id,
    module: 2,
    title: '02_产品与服务事实',
    content:
      '产品：跃动童年体感运动课。\n适用人群：3-8 岁儿童。\n价格：年度会员 2980 元 / 月度 398 元。\n无需穿戴设备，摄像头动作识别，家长端实时运动体测报告。\n不适用：6 岁以上竞技体能专项训练需求。',
    evidence: JSON.stringify([]),
    pending: '',
    source: '演示种子数据',
    updatedAt: nowIso(),
  });

  // 问题种子：5 个品牌认知 + 5 个产品推荐（文档一第十章模板）
  const seedQuestions = [
    ['跃动童年是什么公司，主要做什么？', 1, 2, 1],
    ['跃动童年主要服务哪些客户？', 1, 2, 1],
    ['跃动童年有哪些产品或服务？', 1, 2, 1],
    ['跃动童年能解决什么问题？', 1, 2, 1],
    ['跃动童年和同类品牌有什么区别？', 1, 2, 1],
    ['3-8岁儿童用什么体感运动产品好？', 2, 1, 0],
    ['居家场景推荐什么儿童运动课程？', 2, 1, 0],
    ['儿童体感运动哪些品牌值得推荐？', 2, 1, 0],
    ['儿童体感运动课怎么选？', 2, 1, 0],
    ['儿童体感运动哪家性价比高、效果好？', 2, 1, 0],
  ];
  for (const [text, category, priority, withBrand] of seedQuestions) {
    insert('questions', {
      id: id(),
      projectId,
      text,
      category,
      stage: category === 1 ? 1 : category === 2 ? 1 : 2,
      priority,
      status: 1,
      withBrand,
      intentDimension: category === 1 ? '综合选购' : '综合选购',
      keywords: '',
      source: '演示种子数据',
      createdAt: nowIso(),
    });
  }

  // 授权账号种子
  insert('publishAccounts', {
    id: id(),
    projectId,
    platform: 1,
    accountName: '跃动童年官方号（头条）',
    accountType: 2,
    authStatus: 1,
    quota: 20,
    createdAt: nowIso(),
  });
  insert('publishAccounts', {
    id: id(),
    projectId,
    platform: 7,
    accountName: '跃动童年（公众号）',
    accountType: 2,
    authStatus: 1,
    quota: 10,
    createdAt: nowIso(),
  });

  console.log('[seed] 演示数据已创建：demo@geo.local（密码: demo1234，仅限本地开发使用）');
  return userId;
}

// —— 组织（P1）——
// 幂等 backfill：为 orgId 为空的公司补建默认组织（migrate 后与启动时都会执行）
export function backfillOrgs() {
  for (const comp of q('SELECT id, ownerUserId, name FROM companies WHERE orgId IS NULL')) {
    const orgId = id();
    insert('orgs', { id: orgId, name: `${comp.name} 的团队`, ownerUserId: comp.ownerUserId, quotaMonitorMonthly: 0, createdAt: nowIso() });
    insert('orgMembers', { id: id(), orgId, userId: comp.ownerUserId, role: 'owner', createdAt: nowIso() });
    run('UPDATE companies SET orgId=? WHERE id=?', orgId, comp.id);
  }
}

export function ensurePrimaryOrg(userId, email) {
  const mine = q1(`SELECT om.orgId FROM orgMembers om WHERE om.userId=? AND om.role='owner'`, userId);
  if (mine) return mine.orgId;
  const orgId = id();
  insert('orgs', { id: orgId, name: `${email || '我的'} 的团队`, ownerUserId: userId, quotaMonitorMonthly: 0, createdAt: nowIso() });
  insert('orgMembers', { id: orgId, userId, orgId, role: 'owner', createdAt: nowIso() });
  return orgId;
}

export function primaryOrgId(userId) {
  const m = q1(`SELECT om.orgId FROM orgMembers om WHERE om.userId=? ORDER BY om.createdAt LIMIT 1`, userId);
  return m ? m.orgId : ensurePrimaryOrg(userId, '');
}

export function memberRole(orgId, userId) {
  const m = q1('SELECT role FROM orgMembers WHERE orgId=? AND userId=?', orgId, userId);
  return m ? m.role : null;
}

// 用量计量（P1-3）：组织/日/类型 累加
export function usageIncrement(orgId, type, n = 1) {
  if (!orgId) return;
  const day = nowIso().slice(0, 10);
  run(
    `INSERT INTO usageCounters (orgId, day, type, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(orgId, day, type) DO UPDATE SET count = count + excluded.count`,
    orgId,
    day,
    type,
    n
  );
}

// 操作审计（P0-4）：中央写入点；secret/password 类字段由调用方裁剪
export function audit(userId, email, action, target = '', ip = '') {
  try {
    insert('auditLog', {
      id: id(),
      userId: userId || null,
      email: email || null,
      action: String(action).slice(0, 120),
      target: String(target).slice(0, 500),
      ip: String(ip || '').slice(0, 64),
      createdAt: nowIso(),
    });
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

export function resetDemo() {
  run('DELETE FROM users');
  run('DELETE FROM sessions');
  run('DELETE FROM companies');
  run('DELETE FROM projects');
  run('DELETE FROM openKeys');
  run('DELETE FROM plans');
  run('DELETE FROM knowledgeBases');
  run('DELETE FROM kbDocuments');
  run('DELETE FROM questions');
  run('DELETE FROM articles');
  run('DELETE FROM materials');
  run('DELETE FROM auditRecords');
  run('DELETE FROM publishAccounts');
  run('DELETE FROM publishTasks');
  run('DELETE FROM monitorTasks');
  run('DELETE FROM monitorCheckpoints');
  run('DELETE FROM monitorResults');
  run('DELETE FROM sourceAssets');
  run('DELETE FROM reports');
  seedDemo();
}

migrate();
