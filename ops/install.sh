#!/bin/bash
# install.sh —— GEO 营销平台（Rust 版）一键安装 / 升级
# 适用：Linux x86_64 / aarch64（CentOS 8+、Ubuntu 20.04+、Debian 11+）与 macOS（本地开发，无 systemd 时用本地进程模式）
#
# 用法（在仓库根目录或 ops/ 下执行）：
#   sudo bash ops/install.sh                       # 默认安装到 /opt/geo-rust，端口 3438，DB /opt/geo/platform/data/geo.db
#   sudo bash ops/install.sh --port 8080 --db /data/geo.db --dir /srv/geo
#   sudo bash ops/install.sh --upgrade             # 只重建+重启（跳过 systemd 变更），等同幂等重跑
#
# 选项：
#   --dir PATH            安装目录（默认 /opt/geo-rust）
#   --port N              监听端口（默认 3438）
#   --db PATH             SQLite 数据库路径（默认 /opt/geo/platform/data/geo.db；不存在会自动创建并种子演示数据）
#   --service NAME        systemd 服务名（默认 geo-rust）
#   --seed-demo 0|1       是否写入演示数据种子（默认 1；生产建议 0）
#   --disable-register 0|1 是否关闭自助注册（默认 0；生产建议 1）
#   --skip-build          跳过 cargo build（使用已有二进制，适合只改配置）
#   --no-start            安装后不启动服务

set -euo pipefail

# ---------- 默认配置 ----------
GEO_DIR=/opt/geo-rust
GEO_PORT=3438
GEO_DB=/opt/geo/platform/data/geo.db
GEO_SERVICE=geo-rust
SEED_DEMO=1
DISABLE_REGISTER=0
SKIP_BUILD=0
DO_START=1
UPGRADE_ONLY=0

info()  { echo -e "\033[1;34m▸\033[0m $*"; }
ok()    { echo -e "\033[1;32m✓\033[0m $*"; }
warn()  { echo -e "\033[1;33m!\033[0m $*"; }
err()   { echo -e "\033[1;31m✗\033[0m $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) GEO_DIR="$2"; shift 2;;
    --port) GEO_PORT="$2"; shift 2;;
    --db) GEO_DB="$2"; shift 2;;
    --service) GEO_SERVICE="$2"; shift 2;;
    --seed-demo) SEED_DEMO="$2"; shift 2;;
    --disable-register) DISABLE_REGISTER="$2"; shift 2;;
    --skip-build) SKIP_BUILD=1; shift;;
    --no-start) DO_START=0; shift;;
    --upgrade) UPGRADE_ONLY=1; shift;;
    *) err "未知参数：$1"; exit 1;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_RUST="$REPO_ROOT/rust"

[ -f "$SRC_RUST/Cargo.toml" ] || { err "找不到源码：$SRC_RUST（请在仓库目录内执行）"; exit 1; }

# ---------- 1. 前置检查 ----------
info "检查构建环境…"
if ! command -v cargo >/dev/null 2>&1; then
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
fi
command -v cargo >/dev/null 2>&1 || { err "未找到 cargo。请先安装 Rust 工具链：curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }
command -v python3 >/dev/null 2>&1 || warn "未找到 python3（geo-ctl 备份功能需要它）"
ok "Rust 工具链：$(rustc --version 2>/dev/null || cargo --version)"

USE_SYSTEMD=0
command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ] && USE_SYSTEMD=1

# ---------- 2. 停止旧服务（升级场景）----------
if [ "$USE_SYSTEMD" = "1" ] && systemctl list-unit-files "$GEO_SERVICE.service" &>/dev/null && [ -f "/etc/systemd/system/$GEO_SERVICE.service" ]; then
  info "停止现有服务 $GEO_SERVICE…"
  systemctl stop "$GEO_SERVICE" 2>/dev/null || true
fi
if [ -f "$GEO_DIR/geo.pid" ]; then kill "$(cat "$GEO_DIR/geo.pid")" 2>/dev/null || true; rm -f "$GEO_DIR/geo.pid"; fi

# ---------- 3. 备份现有数据库（升级保护）----------
if [ -f "$GEO_DB" ] && command -v python3 >/dev/null 2>&1; then
  info "备份现有数据库…"
  BK_DIR="${GEO_BACKUP_DIR:-/opt/geo-backup}"; mkdir -p "$BK_DIR"
  python3 - "$GEO_DB" "$BK_DIR/pre-install-$(date +%Y%m%d-%H%M%S).db" <<'PY'
import sqlite3, sys
s = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
d = sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()
PY
  ok "数据库已备份至 $BK_DIR"
fi

# ---------- 4. 同步源码 ----------
info "同步源码 → $GEO_DIR"
mkdir -p "$GEO_DIR/data"
cp -a "$SRC_RUST/Cargo.toml" "$SRC_RUST/Cargo.lock" "$GEO_DIR/"
rm -rf "$GEO_DIR/src" "$GEO_DIR/migrations" "$GEO_DIR/tests"
cp -a "$SRC_RUST/src" "$SRC_RUST/migrations" "$GEO_DIR/"
[ -d "$SRC_RUST/tests" ] && cp -a "$SRC_RUST/tests" "$GEO_DIR/"
# 运维脚本随包安装
mkdir -p "$GEO_DIR/ops"
cp -a "$REPO_ROOT/ops/"*.sh "$REPO_ROOT/ops/geo.env.example" "$GEO_DIR/ops/" 2>/dev/null || true
ok "源码同步完成（$(ls "$GEO_DIR/src" | wc -l | tr -d ' ') 个源文件）"

# ---------- 5. 构建 ----------
if [ "$SKIP_BUILD" != "1" ]; then
  info "构建 release 二进制（首次约 1-3 分钟）…"
  (cd "$GEO_DIR" && cargo build --release --quiet) || { err "构建失败"; exit 1; }
  ok "构建完成：$GEO_DIR/target/release/geo-platform"
else
  warn "跳过构建（--skip-build）"
fi

# ---------- 6. systemd 服务 ----------
if [ "$USE_SYSTEMD" = "1" ] && [ "$UPGRADE_ONLY" != "1" ]; then
  info "写入 systemd 服务 $GEO_SERVICE…"
  cat > "/etc/systemd/system/$GEO_SERVICE.service" <<EOF
[Unit]
Description=GEO Platform (Rust)
After=network.target

[Service]
Type=simple
WorkingDirectory=$GEO_DIR
Environment=PORT=$GEO_PORT
Environment=GEO_DB_PATH=$GEO_DB
Environment=SEED_DEMO=$SEED_DEMO
Environment=DISABLE_REGISTER=$DISABLE_REGISTER
ExecStart=$GEO_DIR/target/release/geo-platform
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$GEO_SERVICE" >/dev/null 2>&1
  ok "systemd 服务已写入并设为开机自启"
fi

# ---------- 7. 启动与健康检查 ----------
if [ "$DO_START" = "1" ]; then
  info "启动服务…"
  if [ "$USE_SYSTEMD" = "1" ]; then systemctl restart "$GEO_SERVICE"; else
    (cd "$GEO_DIR" && PORT="$GEO_PORT" nohup "$GEO_DIR/target/release/geo-platform" >> "$GEO_DIR/geo.out.log" 2>&1 & echo $! > "$GEO_DIR/geo.pid")
  fi
  for i in $(seq 1 15); do
    sleep 1
    curl -s -m 2 "http://127.0.0.1:$GEO_PORT/healthz" 2>/dev/null | grep -q '"ok":true' && break
  done
  if curl -s -m 3 "http://127.0.0.1:$GEO_PORT/healthz" | grep -q '"ok":true'; then
    ok "服务健康：http://127.0.0.1:$GEO_PORT"
  else
    err "健康检查未通过，请查看日志"; exit 1
  fi
fi

# ---------- 8. 摘要 ----------
echo
echo "═══════════════════════════════════════════════════"
echo "  GEO 营销平台（Rust 版）安装完成"
echo "═══════════════════════════════════════════════════"
echo "  访问地址   http://<服务器IP>:$GEO_PORT"
echo "  演示账号   demo@geo.local / demo1234（SEED_DEMO=1 时）"
echo "  安装目录   $GEO_DIR"
echo "  数据库     $GEO_DB"
if [ "$USE_SYSTEMD" = "1" ]; then
  echo "  服务管理   systemctl {start|stop|restart|status} $GEO_SERVICE"
  echo "  日志       journalctl -u $GEO_SERVICE -f"
fi
echo "  运维命令   $GEO_DIR/ops/geo-ctl.sh {status|health|backup|logs|restore}"
echo
warn "安全清单（生产必做）："
echo "  1. 登录后修改演示密码（右上角退出旁 → 修改密码）"
echo "  2. --disable-register 1 或在「系统设置」关闭自助注册"
echo "  3. 配置防火墙仅放行必要端口；HTTPS 部署见 ops/nginx-geo.conf.example"
