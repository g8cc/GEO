#!/bin/bash
# geo-ctl —— GEO 营销平台（Rust 版）统一运维命令
# 覆盖：服务启停 / 状态 / 日志 / 健康检查 / 数据库备份恢复 / 版本信息
# 兼容两种运行模式：systemd（生产，服务名 $GEO_SERVICE）与本地直接进程（开发）
#
# 用法：geo-ctl <命令>
#   start | stop | restart | status    服务管理
#   logs [-f] [行数]                   查看日志（默认 100 行）
#   health                             健康检查：进程 + healthz + 登录页 + 磁盘
#   backup [目录]                      在线备份数据库（WAL 一致，不停服）+ uploads 归档
#   restore <备份文件.db>              恢复数据库（自动停服 → 覆盖 → 起服 → 健康检查）
#   version                            版本与构建信息
#   demo-reset                         ⚠️ 清空数据库并重建演示数据（交互确认）
#   help                               帮助
#
# 配置（环境变量，或 source ops/geo.env）：
#   GEO_SERVICE   systemd 服务名     默认 geo-rust
#   GEO_DIR       安装目录           默认 /opt/geo-rust
#   GEO_DB        数据库文件路径      默认从 systemd unit 读取，否则 /opt/geo/platform/data/geo.db
#   GEO_PORT      监听端口           默认 3438
#   GEO_UPLOADS   上传素材目录        默认 $GEO_DIR/data/uploads
#   GEO_BACKUP_DIR 备份目录          默认 /opt/geo-backup
#   GEO_KEEP      备份保留份数        默认 14

set -uo pipefail

GEO_SERVICE="${GEO_SERVICE:-geo-rust}"
GEO_DIR="${GEO_DIR:-/opt/geo-rust}"
GEO_PORT="${GEO_PORT:-3438}"
GEO_BACKUP_DIR="${GEO_BACKUP_DIR:-/opt/geo-backup}"
GEO_KEEP="${GEO_KEEP:-14}"
BIN="$GEO_DIR/target/release/geo-platform"

# ---------- 输出助手 ----------
info()  { echo -e "\033[1;34m▸\033[0m $*"; }
ok()    { echo -e "\033[1;32m✓\033[0m $*"; }
warn()  { echo -e "\033[1;33m!\033[0m $*"; }
err()   { echo -e "\033[1;31m✗\033[0m $*" >&2; }

# ---------- 模式与路径探测 ----------
have_systemd_unit() { command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$GEO_SERVICE.service" &>/dev/null && [ -f "/etc/systemd/system/$GEO_SERVICE.service" ]; }

discover_db() {
  if [ -n "${GEO_DB:-}" ]; then echo "$GEO_DB"; return; fi
  if have_systemd_unit; then
    local from_unit
    from_unit=$(grep -oE 'Environment=GEO_DB_PATH=[^ ]+' "/etc/systemd/system/$GEO_SERVICE.service" 2>/dev/null | head -1 | cut -d= -f3)
    [ -n "$from_unit" ] && { echo "$from_unit"; return; }
  fi
  [ -f "$GEO_DIR/data/geo.db" ] && { echo "$GEO_DIR/data/geo.db"; return; }
  echo "/opt/geo/platform/data/geo.db"
}
GEO_DB="$(discover_db)"
GEO_UPLOADS="${GEO_UPLOADS:-$GEO_DIR/data/uploads}"

# ---------- 服务管理 ----------
svc_start() {
  if have_systemd_unit; then systemctl start "$GEO_SERVICE" && ok "服务已启动（systemd: $GEO_SERVICE）"
  else
    [ -f "$GEO_DIR/geo.pid" ] && kill -0 "$(cat "$GEO_DIR/geo.pid")" 2>/dev/null && { warn "已在运行"; return 0; }
    (cd "$GEO_DIR" && PORT="$GEO_PORT" nohup "$BIN" >> "$GEO_DIR/geo.out.log" 2>&1 & echo $! > "$GEO_DIR/geo.pid")
    ok "服务已启动（本地模式，PID $(cat "$GEO_DIR/geo.pid")）"
  fi
}
svc_stop() {
  if have_systemd_unit; then systemctl stop "$GEO_SERVICE" && ok "服务已停止"
  else
    if [ -f "$GEO_DIR/geo.pid" ]; then kill "$(cat "$GEO_DIR/geo.pid")" 2>/dev/null && rm -f "$GEO_DIR/geo.pid"; ok "服务已停止"; else warn "未在运行（无 PID 文件）"; fi
  fi
}
svc_status() {
  if have_systemd_unit; then
    systemctl status "$GEO_SERVICE" --no-pager -l || true
  else
    if [ -f "$GEO_DIR/geo.pid" ] && kill -0 "$(cat "$GEO_DIR/geo.pid")" 2>/dev/null; then ok "运行中（PID $(cat "$GEO_DIR/geo.pid")）"; else err "未运行"; fi
  fi
  echo
  info "端口 $GEO_PORT 监听：$(ss -tlnp 2>/dev/null | grep ":$GEO_PORT " | head -1 | grep -oE '\((\"[^\"]+\")' || echo '未监听')"
}

cmd_logs() {
  local follow="" n="100"
  while [ $# -gt 0 ]; do case "$1" in -f|--follow) follow="-f"; shift;; *) n="$1"; shift;; esac; done
  if have_systemd_unit; then journalctl -u "$GEO_SERVICE" -n "$n" $follow --no-pager
  else tail -n "$n" $follow "$GEO_DIR/geo.out.log" 2>/dev/null || err "无日志文件 $GEO_DIR/geo.out.log"; fi
}

# ---------- 健康检查 ----------
cmd_health() {
  local fail=0
  info "GEO 平台健康检查（$(date '+%F %T')）"
  # 1. 服务存活
  if have_systemd_unit; then
    if systemctl is-active --quiet "$GEO_SERVICE"; then ok "服务 $GEO_SERVICE：active"; else err "服务 $GEO_SERVICE：$(systemctl is-active "$GEO_SERVICE")"; fail=1; fi
  fi
  # 2. healthz
  local hz; hz=$(curl -s -m 5 "http://127.0.0.1:$GEO_PORT/healthz" 2>/dev/null)
  if echo "$hz" | grep -q '"ok":true'; then ok "healthz：ok"; else err "healthz：无响应"; fail=1; fi
  # 3. 登录页
  local code; code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GEO_PORT/login" 2>/dev/null)
  if [ "$code" = "200" ]; then ok "登录页：200"; else err "登录页：$code"; fail=1; fi
  # 4. 数据库
  if [ -f "$GEO_DB" ]; then
    local users; users=$(python3 -c "import sqlite3;c=sqlite3.connect('file:$GEO_DB?mode=ro',uri=True);print(c.execute('SELECT COUNT(*) FROM users').fetchone()[0])" 2>/dev/null || echo "?")
    ok "数据库：$GEO_DB（用户数 $users）"
  else err "数据库不存在：$GEO_DB"; fail=1; fi
  # 5. 磁盘
  local usage; usage=$(df -P "$(dirname "$GEO_DB")" | tail -1 | awk '{print $5}' | tr -d '%')
  if [ "${usage:-100}" -lt 85 ]; then ok "磁盘：${usage}%"; else warn "磁盘：${usage}%（≥85%，请清理）"; fi
  [ "$fail" = "0" ] && ok "健康检查通过" || { err "健康检查未通过"; return 1; }
}

# ---------- 备份 / 恢复 ----------
cmd_backup() {
  local dir="${1:-$GEO_BACKUP_DIR}"
  local ts; ts=$(date +%Y%m%d-%H%M%S)
  local out_db="$dir/geo-$ts.db" out_up="$dir/uploads-$ts.tgz" log="$dir/backup.log"
  mkdir -p "$dir"
  info "备份数据库（在线，WAL 一致）：$GEO_DB → $out_db"
  python3 - "$GEO_DB" "$out_db" <<'PY' || { err "数据库备份失败"; return 1; }
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
s.isolation_level = None
s.execute("BEGIN")  # 快照一致性：整个备份期间读取同一版本
if hasattr(s, "backup"):
    d = sqlite3.connect(dst); s.backup(d); d.commit(); d.close()
else:
    # Python < 3.7 / 旧 sqlite：iterdump 回退（逐行重放 schema + 数据）
    d = sqlite3.connect(dst)
    for line in s.iterdump():
        d.execute(line)
    d.commit(); d.close()
s.execute("COMMIT"); s.close()
PY
  local size; size=$(stat -c%s "$out_db" 2>/dev/null || stat -f%z "$out_db" 2>/dev/null || echo 0)
  if [ "$size" -lt 4096 ]; then err "备份文件异常（$size 字节），请检查"; return 1; fi
  ok "数据库备份完成（$size 字节）"
  if [ -d "$GEO_UPLOADS" ]; then tar czf "$out_up" -C "$(dirname "$GEO_UPLOADS")" "$(basename "$GEO_UPLOADS")" 2>/dev/null && ok "uploads 归档完成：$out_up"; fi
  # 轮转：只保留最近 GEO_KEEP 份
  ls -t "$dir"/geo-*.db 2>/dev/null | tail -n +$((GEO_KEEP + 1)) | xargs -r rm -f
  ls -t "$dir"/uploads-*.tgz 2>/dev/null | tail -n +$((GEO_KEEP + 1)) | xargs -r rm -f
  echo "[$(date '+%F %T')] ✅ db=$out_db ($size bytes)" >> "$log"
  info "备份目录现有 $(ls "$dir"/geo-*.db 2>/dev/null | wc -l | tr -d ' ') 份（保留 $GEO_KEEP 份）"
}

cmd_restore() {
  local file="$1"
  [ -z "${file:-}" ] && { err "用法：geo-ctl restore <备份文件.db>"; return 1; }
  [ ! -f "$file" ] && { err "备份文件不存在：$file"; return 1; }
  read -r -p "⚠️  将用 $file 覆盖 $GEO_DB，当前数据将被替换。输入 YES 确认: " a
  [ "$a" = "YES" ] || { warn "已取消"; return 1; }
  info "停止服务…"; svc_stop; sleep 1
  cp "$GEO_DB" "$GEO_DB.pre-restore-$(date +%s)" 2>/dev/null || true
  rm -f "$GEO_DB-wal" "$GEO_DB-shm"
  cp "$file" "$GEO_DB"
  info "启动服务…"; svc_start; sleep 2
  cmd_health
}

# ---------- 版本 / 演示数据 ----------
cmd_version() {
  echo "GEO Platform（Rust 版）"
  [ -f "$BIN" ] && echo "  二进制：$BIN（构建于 $(stat -c%y "$BIN" 2>/dev/null | cut -d. -f1)）"
  echo "  服务：$GEO_SERVICE @ 端口 $GEO_PORT"
  echo "  数据库：$GEO_DB"
  echo "  healthz：$(curl -s -m 3 "http://127.0.0.1:$GEO_PORT/healthz" 2>/dev/null || echo '无响应')"
}
cmd_demo_reset() {
  read -r -p "⚠️  将删除 $GEO_DB 全部数据并重建演示数据（demo@geo.local / demo1234）。输入 RESET 确认: " a
  [ "$a" = "RESET" ] || { warn "已取消"; return 1; }
  cmd_backup >/dev/null 2>&1 && ok "已先做安全备份：$(ls -t "$GEO_BACKUP_DIR"/geo-*.db | head -1)"
  svc_stop; sleep 1
  rm -f "$GEO_DB" "$GEO_DB-wal" "$GEO_DB-shm"
  (cd "$GEO_DIR" && SEED_DEMO=1 PORT="$GEO_PORT" "$BIN" & sleep 2; kill %1 2>/dev/null) || true
  sleep 1; svc_start; sleep 2
  cmd_health
}

# ---------- 入口 ----------
case "${1:-help}" in
  start)    svc_start ;;
  stop)     svc_stop ;;
  restart)  svc_stop; sleep 1; svc_start ;;
  status)   svc_status ;;
  logs)     shift; cmd_logs "$@" ;;
  health)   cmd_health ;;
  backup)   shift; cmd_backup "$@" ;;
  restore)  shift; cmd_restore "$@" ;;
  version)  cmd_version ;;
  demo-reset) cmd_demo_reset ;;
  help|*)   sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
