#!/bin/bash
# GEO 平台监控（Rust 版）：healthz / systemd / 磁盘 / 备份新鲜度 → 告警 webhook（企微机器人等），未配置时写本地日志
# crontab 示例（每 5 分钟）：*/5 * * * * /opt/geo-rust/ops/monitor.sh
set -u
ENV_FILE=${ALERT_ENV:-/opt/geo/ops/alert.env}
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
LOG=${ALERT_LOG:-/var/log/geo-alerts.log}
PORT=${GEO_PORT:-3438}
SERVICE=${GEO_SERVICE:-geo-rust}
DB=${GEO_DB:-/opt/geo/platform/data/geo.db}
alert() {
  echo "[$(date '+%F %T')] $1" >> "$LOG"
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -s -m 5 -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[GEO平台] $1\"}}" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
}
# 1. 服务存活
curl -s -m 5 "http://127.0.0.1:$PORT/healthz" | grep -q '"ok":true' || alert "❌ 服务无响应（healthz 失败）"
# 2. systemd 状态
command -v systemctl >/dev/null 2>&1 && systemctl is-active "$SERVICE" >/dev/null 2>&1 || alert "❌ systemd 服务 $SERVICE 非 active"
# 3. 磁盘（DB 与备份所在分区）
USAGE=$(df -P "$(dirname "$DB")" | tail -1 | awk '{print $5}' | tr -d '%')
[ "${USAGE:-0}" -ge 85 ] && alert "⚠️ 磁盘使用率 ${USAGE}%（阈值 85%）"
# 4. 备份新鲜度（09 点档检查：超过 26 小时无备份告警）
if [ "$(date +%H)" = "09" ]; then
  LATEST=$(ls -t "${BACKUP_DIR:-/opt/geo-backup}"/geo-*.db 2>/dev/null | head -1)
  if [ -z "$LATEST" ] || [ $(( $(date +%s) - $(stat -c%Y "$LATEST") )) -gt 93600 ]; then
    alert "⚠️ 备份超过 26 小时未更新"
  fi
fi
