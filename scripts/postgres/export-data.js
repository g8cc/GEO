#!/usr/bin/env node
// Postgres 数据导出（v1.5 迁移包）
// 从 SQLite 读出全部业务数据，输出可导入 Postgres 的 INSERT 语句（到 stdout）。
// 用法：GEO_DB_PATH=/opt/geo/platform/data/geo.db node scripts/postgres/export-data.js > data.sql
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB = process.env.GEO_DB_PATH || path.join(process.cwd(), 'data', 'geo.db');
if (!fs.existsSync(DB)) {
  console.error(`数据库不存在：${DB}`);
  process.exit(1);
}
const db = new DatabaseSync(DB, { readOnly: true });

const TABLES = [
  'users', 'orgs', 'orgMembers', 'companies', 'projects', 'openKeys', 'knowledgeBases',
  'kbDocuments', 'questions', 'materials', 'articles', 'auditRecords', 'publishAccounts',
  'publishTasks', 'monitorTasks', 'monitorCheckpoints', 'monitorResults', 'sourceAssets',
  'reports', 'licenseKeys', 'usageCounters', 'settings', 'auditLog',
];

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
};

console.log('-- GEO 平台数据导出（生成时间 ' + new Date().toISOString() + '）');
console.log('-- 目标：Postgres（先执行 schema.sql）');
console.log('BEGIN;');
for (const t of TABLES) {
  let rows;
  try {
    rows = db.prepare(`SELECT * FROM ${t}`).all();
  } catch {
    console.log(`-- 表 ${t} 不存在，跳过`);
    continue;
  }
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  console.log(`\n-- ${t}（${rows.length} 行）`);
  for (const row of rows) {
    const vals = cols.map((c) => esc(row[c])).join(', ');
    console.log(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${vals}) ON CONFLICT DO NOTHING;`);
  }
}
console.log('\nCOMMIT;');
console.log('-- 完成。注意：sessions 表未导出（所有用户需重新登录）；uploads/ 目录需另行拷贝。');
