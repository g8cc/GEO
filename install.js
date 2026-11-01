#!/usr/bin/env node
// GEO Skills 安装器
// 默认预演（dry-run）不修改文件；确认后 --apply 执行安装。
// 用法：
//   node install.js                 # 预演
//   node install.js --apply         # 安装到默认目标（~/.codex/skills 和 ~/.claude/skills）
//   node install.js --apply --targets codex,claude,agents
//   node install.js --apply --target-dir /path/to/skills
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SKILLS_DIR = path.join(ROOT, 'skills');
const APPLY = process.argv.includes('--apply');
const targetsArg = (process.argv.find((a) => a.startsWith('--targets')) || '').split('=')[1];
const targetDirArg = (process.argv.find((a) => a.startsWith('--target-dir')) || '').split('=')[1];

const home = os.homedir();
const targets = targetDirArg
  ? [targetDirArg]
  : (targetsArg ? targetsArg.split(',') : ['codex', 'claude']).map((t) => {
      if (t === 'codex') return path.join(home, '.codex', 'skills');
      if (t === 'claude') return path.join(home, '.claude', 'skills');
      if (t === 'agents') return path.join(home, '.agents', 'skills');
      return t;
    });

const skills = fs
  .readdirSync(SKILLS_DIR)
  .filter((d) => d.startsWith('geo-') && fs.statSync(path.join(SKILLS_DIR, d)).isDirectory());

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log(`GEO Skills 安装器 ${APPLY ? '（执行安装）' : '（预演，不修改文件；确认后加 --apply）'}`);
console.log(`技能包：${skills.length} 个 geo-* 技能\n`);

for (const target of targets) {
  console.log(`→ 目标目录：${target}`);
  if (APPLY) {
    fs.mkdirSync(target, { recursive: true });
    // 备份并移除旧 geo-*，避免新旧技能同时被客户端发现
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(home, '.geo-skills-backups', `upgrade-${stamp}`);
    let backedUp = 0;
    for (const skill of skills) {
      const dest = path.join(target, skill);
      if (fs.existsSync(dest)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.cpSync(dest, path.join(backupDir, skill), { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        backedUp++;
      }
      copyDir(path.join(SKILLS_DIR, skill), dest);
      console.log(`   安装 ${skill}`);
    }
    if (backedUp) console.log(`   旧版本已备份到 ${backupDir}`);
  } else {
    for (const skill of skills) {
      const exists = fs.existsSync(path.join(target, skill));
      console.log(`   ${skill}${exists ? '（将覆盖，旧版本会备份）' : ''}`);
    }
  }
}

console.log(`
CLI 安装（二选一）：
  1) 全局安装：  cd ${path.join(ROOT, 'cli')} && npm install -g .
  2) 免安装运行：alias geo='node ${path.join(ROOT, 'cli', 'geo.js')}'

安装后验证：
  geo version --check
  geo auth login --server <GEO 平台地址>
  geo call projects.list

GEO 平台启动：cd ${path.join(ROOT, 'platform')} && node server.js
`);
if (!APPLY) console.log('以上为预演结果。确认无误后执行：node install.js --apply');
