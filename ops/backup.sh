#!/bin/bash
# GEO 平台每日备份（P0-5）：数据库快照(VACUUM INTO) + uploads 归档，保留 14 天，审计日志清理 90 天
set -u
DATE=$(date +%F)
DIR=${BACKUP_DIR:-/opt/geo-backup}
LOG="$DIR/backup.log"
mkdir -p "$DIR"
cd /opt/geo/platform
node -e "import('./src/db.js').then(m=>{m.db.exec(\"VACUUM INTO '/opt/geo-backup/geo-$DATE.db'\");console.log('db snapshot ok')})" >> "$LOG" 2>&1
tar czf "$DIR/uploads-$DATE.tgz" -C /opt/geo/platform data/uploads >> "$LOG" 2>&1
# 审计日志清理（>90 天）
node -e "import('./src/db.js').then(m=>{m.run(\"DELETE FROM auditLog WHERE createdAt < datetime('now','-90 day')\");console.log('audit purged')})" >> "$LOG" 2>&1
# 保留 14 天
find "$DIR" -name "geo-*.db" -mtime +14 -delete
find "$DIR" -name "uploads-*.tgz" -mtime +14 -delete
# 校验最新备份非空
SZ=$(stat -c%s "$DIR/geo-$DATE.db" 2>/dev/null || echo 0)
if [ "$SZ" -lt 4096 ]; then echo "[$DATE] ❌ 备份异常 db=$SZ" >> "$LOG"; else echo "[$DATE] ✅ 备份完成 db=$SZ" >> "$LOG"; fi
