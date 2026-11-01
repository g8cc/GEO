#!/bin/bash
# ops/verify.sh —— 单命令质量门：交付前唯一入口（make verify）
# 五道防线一次跑完：静态(clippy) → 单元(cargo test) → 协议(全量 89 项) → 结构(HTML 标签平衡) → 渲染(14 页截图)
# 用法：bash ops/verify.sh        （退出码非 0 = 未过门，禁止交付）
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=3439
DB="/tmp/geo-verify-$$.db"
LOG=/tmp/geo-verify-server.log
FAIL=0

info() { echo -e "\033[1;34m▸\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
bad()  { echo -e "\033[1;31m✗\033[0m $*"; }

cleanup() { pkill -f "target/release/geo-platform" 2>/dev/null; rm -f "$DB" "$DB-wal" "$DB-shm"; }
trap cleanup EXIT

echo "═══════════════════════════════════════════"
echo " GEO 营销平台 · 质量门（make verify）"
echo "═══════════════════════════════════════════"

# ── 第 1 道：静态检查（clippy -D warnings）──
info "① 静态检查 cargo clippy（警告即失败）"
(cd rust && cargo clippy --release --quiet -- -D warnings) || { echo "✗ clippy 未过"; FAIL=1; }

# ── 第 2 道：单元测试 ──
info "② 单元测试 cargo test"
(cd rust && cargo test --release --quiet) >/dev/null 2>&1 && ok "单元测试通过" || { echo "✗ 单元测试未过"; FAIL=1; }

# ── 第 3 道：协议层全量测试（全新临时库，自启服务）──
info "③ 启动验证实例（全新库 ${DB}）"
(cd rust && PORT=$PORT GEO_DB_PATH="$DB" nohup ./target/release/geo-platform > "$LOG" 2>&1 &)
for _ in $(seq 1 20); do
  sleep 1
  curl -s -m 1 "http://localhost:$PORT/healthz" 2>/dev/null | grep -q ok && break
done
curl -s -m 2 "http://localhost:$PORT/healthz" | grep -q ok || { echo "✗ 验证实例未启动（见 ${LOG}）"; exit 1; }
ok "实例就绪"

info "④ 全量测试（含页面完整性守卫）"
if bash scripts/rust-full-test.sh "http://localhost:$PORT" > /tmp/geo-verify-fulltest.log 2>&1; then
  LC_ALL=C grep -a "测试结果" /tmp/geo-verify-fulltest.log
else
  LC_ALL=C grep -a "❌" /tmp/geo-verify-fulltest.log | head -10
  LC_ALL=C grep -a "测试结果" /tmp/geo-verify-fulltest.log
  FAIL=1
fi

# ── 第 4 道：HTML 结构（标签平衡）──
info "⑤ HTML 标签平衡审计"
python3 scripts/rust-html-audit.py "http://localhost:$PORT" || FAIL=1

# ── 第 5 道：渲染级截图（人眼确认的输入）──
info "⑥ 渲染级截图（14 页 → /tmp/geo-visual，交付人必须逐张打开确认）"
node scripts/rust-visual-check.mjs "http://localhost:$PORT" /tmp/geo-visual || FAIL=1

echo "═══════════════════════════════════════════"
if [ "$FAIL" = "0" ]; then
  ok "质量门通过 —— 截图在 /tmp/geo-visual，逐张确认后即可交付"
else
  echo "✗ 质量门未通过（上述 ❌ 项修复后重跑）"
fi
exit $FAIL
