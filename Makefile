# GEO 营销平台 —— 开发与运维快捷命令
# 常用：make build | run | test | fulltest | status | health | backup | logs | deploy
# 远程部署参数从环境变量或 ops/geo.env 读取（见 ops/geo.env.example）

SHELL := /bin/bash
-include ops/geo.env

RUST_DIR := rust
GEO_DIR ?= /opt/geo-rust
GEO_PORT ?= 3438
GEO_SERVICE ?= geo-rust
DEPLOY_HOST ?=
DEPLOY_KEY ?= ~/.ssh/id_rsa
DEPLOY_DIR ?= /opt/geo-rust

.PHONY: help build run test fulltest verify status health backup logs stop restart deploy clean

help:
	@echo "GEO 营销平台（Rust 版）常用命令："
	@echo "  make build      构建 release 二进制（rust/target/release/geo-platform）"
	@echo "  make run        本地启动开发服务（端口 $(GEO_PORT)，演示数据种子）"
	@echo "  make test       运行单元测试"
	@echo "  make fulltest   全量测试（需先 make run）"
	@echo "  make verify     单命令质量门（clippy+单测+全量+HTML审计+渲染截图）交付前必跑"
	@echo "  make status     查看本机/远程服务状态"
	@echo "  make health     健康检查"
	@echo "  make backup     触发一次数据库备份"
	@echo "  make logs       跟踪服务日志"
	@echo "  make restart    重启服务"
	@echo "  make deploy     部署最新源码到服务器（需设 DEPLOY_HOST/DEPLOY_KEY）"
	@echo "  make clean      清理构建产物"

build:
	cd $(RUST_DIR) && cargo build --release

run:
	cd $(RUST_DIR) && PORT=$(GEO_PORT) cargo run

test:
	cd $(RUST_DIR) && cargo test

fulltest:
	bash scripts/rust-full-test.sh http://localhost:$(GEO_PORT)

# 单命令质量门：静态 clippy + 单测 + 全量 + HTML 结构审计 + 渲染截图（交付前唯一入口）
verify:
	bash ops/verify.sh

# ---- 运维（本地有 systemd 服务时直接可用；远程见 deploy）----
GEOCTL = $(GEO_DIR)/ops/geo-ctl.sh

status health backup logs stop restart:
	@if [ -f "$(GEOCTL)" ]; then bash $(GEOCTL) $@; \
	else echo "本机未安装 geo-ctl（\$$GEOCTL 不存在）。远程执行：make deploy 后用 SSH 运行 geo-ctl"; fi

# ---- 远程部署：同步源码 → 服务器构建 → 重启 → 健康检查 ----
deploy:
	@test -n "$(DEPLOY_HOST)" || { echo "用法：make deploy DEPLOY_HOST=root@x.x.x.x DEPLOY_KEY=~/.ssh/key [DEPLOY_DIR=/opt/geo-rust]"; exit 1; }
	@echo "▸ 打包源码…"
	tar czf /tmp/geo-rust-src.tar.gz --exclude data --exclude target -C $(RUST_DIR) src migrations tests Cargo.toml Cargo.lock
	@echo "▸ 上传…"
	scp -q -i $(DEPLOY_KEY) /tmp/geo-rust-src.tar.gz $(DEPLOY_HOST):/tmp/
	@echo "▸ 远程构建并重启…"
	ssh -i $(DEPLOY_KEY) $(DEPLOY_HOST) 'set -e; 	  if [ ! -d $(DEPLOY_DIR) ]; then echo "远程未安装，请先运行 ops/install.sh"; exit 1; fi; 	  cp $(DEPLOY_DIR)/target/release/geo-platform $(DEPLOY_DIR)/geo-platform.bak-$$(date +%s) 2>/dev/null || true; 	  cd $(DEPLOY_DIR) && rm -rf src migrations tests && tar xzf /tmp/geo-rust-src.tar.gz; 	  source $$HOME/.cargo/env 2>/dev/null || export PATH=$$HOME/.cargo/bin:$$PATH; 	  cargo build --release --quiet && systemctl restart $(GEO_SERVICE) && sleep 2 && 	  curl -s -m 5 http://127.0.0.1:$(GEO_PORT)/healthz'
	@echo "✓ 部署完成"

clean:
	cd $(RUST_DIR) && cargo clean
	rm -f /tmp/geo-rust-src.tar.gz
