#!/bin/bash
# GEO 平台每日备份（Rust 版）：数据库快照（WAL 一致，不停服）+ uploads 归档 + 审计日志清理 90 天 + 轮转保留 14 天
# crontab 示例（每日 02:30）：30 2 * * * /opt/geo-rust/ops/backup.sh >> /opt/geo-backup/cron.log 2>&1
set -u
DATE=$(date +%F)
DIR=${BACKUP_DIR:-/opt/geo-backup}
DB=${GEO_DB:-/opt/geo/platform/data/geo.db}
UPLOADS=${GEO_UPLOADS:-/opt/geo-rust/data/uploads}
GEO_DIR=${GEO_DIR:-/opt/geo-rust}
LOG="$DIR/backup.log"
mkdir -p "$DIR"
OUT="$DIR/geo-$DATE.db"

# 1. 数据库快照（WAL 一致、不停服；python>=3.7 用 backup API，旧版回退 iterdump）
python3 - "$DB" "$OUT" <<'PY' >> "$LOG" 2>&1 || { echo "[$DATE] ❌ 数据库备份失败" >> "$LOG"; exit 1; }
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
s.isolation_level = None
s.execute("BEGIN")
if hasattr(s, "backup"):
    d = sqlite3.connect(dst); s.backup(d); d.commit(); d.close()
else:
    d = sqlite3.connect(dst)
    for line in s.iterdump():
        d.execute(line)
    d.commit(); d.close()
s.execute("COMMIT"); s.close()
PY

# 2. uploads 归档（目录存在时）
[ -d "$UPLOADS" ] && tar czf "$DIR/uploads-$DATE.tgz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")" 2>>"$LOG"

# 3. 审计日志清理（保留 90 天）
python3 - "$DB" <<'PY' >> "$LOG" 2>&1
import sqlite3, sys
c = sqlite3.connect(sys.argv[1], timeout=15)
c.execute("PRAGMA busy_timeout=15000")
c.execute("DELETE FROM auditLog WHERE createdAt < datetime('now','-90 day')")
c.commit(); c.close()
print("audit purged (< 90 day)")
PY

# 4. 轮转保留 14 天
find "$DIR" -name "geo-*.db" -mtime +14 -delete
find "$DIR" -name "uploads-*.tgz" -mtime +14 -delete

# 5. 校验非空
SZ=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT" 2>/dev/null || echo 0)
if [ "$SZ" -lt 4096 ]; then echo "[$DATE] ❌ 备份异常 db=$SZ" >> "$LOG"; exit 1; fi
echo "[$DATE] ✅ 备份完成 db=$SZ" >> "$LOG"
