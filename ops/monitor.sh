#!/bin/bash
# GEO 平台监控（P0-7）：healthz / 磁盘 / 服务 / 备份新鲜度 → 告警 webhook（企微机器人/Server酱），未配置时写本地日志
set -u
ENV_FILE=${ALERT_ENV:-/opt/geo/ops/alert.env}
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
LOG=${ALERT_LOG:-/var/log/geo-alerts.log}
alert() { # $1=消息
  echo "[$(date '+%F %T')] $1" >> "$LOG"
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -s -m 5 -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[GEO平台] $1\"}}" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
}
# 1. 服务存活
curl -s -m 5 http://127.0.0.1:3438/healthz | grep -q '"ok":true' || alert "❌ 服务无响应（healthz 失败）"
# 2. systemd 状态
systemctl is-active geo >/dev/null 2>&1 || alert "❌ systemd 服务 geo 非 active"
# 3. 磁盘
USAGE=$(df -P / | tail -1 | awk '{print $5}' | tr -d '%')
[ "${USAGE:-0}" -ge 85 ] && alert "⚠️ 磁盘使用率 ${USAGE}%（阈值 85%）"
# 4. 备份新鲜度（超过 26 小时无备份告警，仅 09:00-10:00 的cron执行时检查）
H=$(date +%H)
if [ "$H" = "09" ]; then
  LATEST=$(ls -t /opt/geo-backup/geo-*.db 2>/dev/null | head -1)
  if [ -z "$LATEST" ] || [ $(( $(date +%s) - $(stat -c%Y "$LATEST") )) -gt 93600 ]; then
    alert "⚠️ 备份超过 26 小时未更新"
  fi
fi
