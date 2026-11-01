PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', mustChangePassword INTEGER NOT NULL DEFAULT 0,
  failedAttempts INTEGER NOT NULL DEFAULT 0, lockedUntil TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY, ownerUserId TEXT NOT NULL, orgId TEXT, name TEXT NOT NULL,
  industry TEXT, intro TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, ownerUserId TEXT NOT NULL,
  quotaMonitorMonthly INTEGER NOT NULL DEFAULT 0, planCode TEXT, planExpiresAt TEXT,
  notifyWebhook TEXT, notifyEvents TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orgMembers (
  id TEXT PRIMARY KEY, orgId TEXT NOT NULL REFERENCES orgs(id), userId TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'operator', createdAt TEXT NOT NULL, UNIQUE(orgId, userId)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, companyId TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
  brandName TEXT, productName TEXT, region TEXT, business TEXT, sellingPoints TEXT, keywords TEXT,
  defaultPlatforms TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS openKeys (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  keyPrefix TEXT NOT NULL, keyHash TEXT UNIQUE NOT NULL, authorizedProjectIds TEXT NOT NULL DEFAULT '[]',
  boundDeviceId TEXT, lastUsedAt TEXT, revokedAt TEXT, createdAt TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS knowledgeBases (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), type INTEGER NOT NULL,
  name TEXT NOT NULL, qaIndex TEXT, conflictList TEXT, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kbDocuments (
  id TEXT PRIMARY KEY, kbId TEXT NOT NULL REFERENCES knowledgeBases(id), module INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT, pending TEXT, source TEXT, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), text TEXT NOT NULL,
  category INTEGER NOT NULL DEFAULT 1, stage INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 2,
  status INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, withBrand INTEGER NOT NULL DEFAULT 0,
  intentDimension TEXT, keywords TEXT, source TEXT NOT NULL DEFAULT '人工', createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), type INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL, url TEXT NOT NULL, meta TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), questionId TEXT,
  title TEXT NOT NULL, content TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 2, coverMaterialId TEXT,
  status INTEGER NOT NULL DEFAULT 0, aiDeclaration INTEGER NOT NULL DEFAULT 1, meta TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditRecords (
  id TEXT PRIMARY KEY, articleId TEXT NOT NULL REFERENCES articles(id),
  gate1 INTEGER NOT NULL, gate1Issues TEXT, gate2 INTEGER NOT NULL, gate2Issues TEXT,
  gate3 INTEGER NOT NULL, gate3Issues TEXT, verdict INTEGER NOT NULL,
  evidenceLinks TEXT, pendingFacts TEXT, changes TEXT, auditor TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishAccounts (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), platform INTEGER NOT NULL,
  accountName TEXT NOT NULL, accountType INTEGER NOT NULL DEFAULT 2, authStatus INTEGER NOT NULL DEFAULT 1,
  quota INTEGER NOT NULL DEFAULT 10, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishTasks (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), articleId TEXT NOT NULL,
  platform INTEGER NOT NULL, accountId TEXT, status INTEGER NOT NULL DEFAULT 1, publishedUrl TEXT,
  publishedAt TEXT, failReason TEXT, packageJson TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitorTasks (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), questionIds TEXT NOT NULL,
  platforms TEXT NOT NULL, mode INTEGER NOT NULL DEFAULT 1, scheduleDays TEXT,
  status INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitorCheckpoints (
  id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES monitorTasks(id), day INTEGER NOT NULL DEFAULT 0,
  dueAt TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 1, resultIds TEXT, ranAt TEXT
);
CREATE TABLE IF NOT EXISTS monitorResults (
  id TEXT PRIMARY KEY, taskId TEXT, checkpointId TEXT, projectId TEXT NOT NULL, questionId TEXT NOT NULL,
  platform INTEGER NOT NULL, ranAt TEXT NOT NULL, answerText TEXT NOT NULL,
  brandMentioned INTEGER NOT NULL DEFAULT 0, mentionPosition TEXT, brandAccurate INTEGER,
  recommendLevel INTEGER NOT NULL DEFAULT 0, recommendReason TEXT, competitors TEXT, citations TEXT,
  keywords TEXT, hitStatus INTEGER NOT NULL DEFAULT 0, pageAccessible INTEGER,
  nextStep TEXT, nextOptimize TEXT, exactUrlHit INTEGER NOT NULL DEFAULT 0, dataSource TEXT NOT NULL DEFAULT 'mock'
);
CREATE TABLE IF NOT EXISTS sourceAssets (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), question TEXT, aiPlatform INTEGER,
  articleTitle TEXT, url TEXT, publishPlatform INTEGER, publisher INTEGER, accountType INTEGER,
  evidenceType INTEGER, citedCount INTEGER NOT NULL DEFAULT 0, brandPerformance TEXT, competitorLink TEXT,
  controllability INTEGER, pageStatus INTEGER, status INTEGER NOT NULL DEFAULT 2, nextAction TEXT,
  adaptPlatforms TEXT, needProve TEXT, remark TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), type INTEGER NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, relatedTaskIds TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  input TEXT, result TEXT, error TEXT, redirectUrl TEXT, orgId TEXT, createdAt TEXT NOT NULL, completedAt TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditLog (
  id TEXT PRIMARY KEY, userId TEXT, email TEXT, action TEXT NOT NULL, target TEXT, ip TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usageCounters (
  orgId TEXT NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (orgId, day, type)
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
