# 部署手册（Rust 版）

> 适用版本：v1.6.0 ｜ 组件：geo-platform（Rust/Axum 单二进制）+ geo CLI + GEO Skills
> 环境要求：Linux x86_64 / aarch64（CentOS 8+、Ubuntu 20.04+、Debian 11+）或 macOS；**Rust 工具链（rustup，1.75+）**；磁盘 ≥ 2GB（含构建缓存）。
> 旧 Node.js 版部署方式（`platform/` + node server.js）已废弃，见文末附录。

## 1. 部署形态

| 形态 | 说明 | 适用 |
|---|---|---|
| 单机生产（推荐） | `ops/install.sh` 一键安装 + systemd 守护 + SQLite(WAL) | 中小团队商用 / 内部开源 |
| 单机演示 | `ops/install.sh --seed-demo 1` | 培训、POC、内网演示 |
| Nginx + HTTPS | 单机生产之上加反代（`ops/nginx-geo.conf.example`） | 对外域名访问 |
| 本地开发 | `make run`（cargo run） | 开发调试 |

## 2. 一键安装

```bash
git clone <仓库地址> && cd GEO
sudo bash ops/install.sh
```

脚本动作（幂等，可重复执行 = 升级）：
1. 检查 Rust 工具链（缺省给出 rustup 安装命令）
2. 停止旧服务 → **备份现有数据库**（python3 sqlite3 backup API，WAL 一致）
3. 同步 `rust/` 源码到安装目录（默认 `/opt/geo-rust`），运维脚本随包就位
4. `cargo build --release`
5. 写入 systemd 服务（`geo-rust`）并设开机自启
6. 启动 + 健康检查，输出访问地址与安全清单

常用参数：

```bash
sudo bash ops/install.sh --port 8080                 # 自定义端口
sudo bash ops/install.sh --db /data/geo/geo.db       # 自定义数据库路径
sudo bash ops/install.sh --seed-demo 0 --disable-register 1   # 生产推荐
sudo bash ops/install.sh --upgrade                   # 只重建+重启（跳过 systemd 变更）
sudo bash ops/install.sh --skip-build --no-start     # 只同步源码不构建不启动
```

安装完成后：

- 访问 `http://<服务器IP>:3438`，演示账号 `demo@geo.local / demo1234`（SEED_DEMO=1 时）
- 运维命令 `/opt/geo-rust/ops/geo-ctl.sh`（见 `OPERATIONS.md`）

## 3. 手动部署（不使用 install.sh）

```bash
# 1. 构建本地二进制，或直接在服务器上构建
cd rust && cargo build --release
# 2. 部署目录
sudo mkdir -p /opt/geo-rust/data && sudo cp -a src migrations Cargo.toml Cargo.lock /opt/geo-rust/
sudo cp -a target/release/geo-platform /opt/geo-rust/
# 3. systemd 单元（/etc/systemd/system/geo-rust.service）
[Unit]
Description=GEO Platform (Rust)
After=network.target
[Service]
Type=simple
WorkingDirectory=/opt/geo-rust
Environment=PORT=3438
Environment=GEO_DB_PATH=/opt/geo/platform/data/geo.db
Environment=SEED_DEMO=0
Environment=DISABLE_REGISTER=1
ExecStart=/opt/geo-rust/target/release/geo-platform
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
# 4. 启动
sudo systemctl daemon-reload && sudo systemctl enable --now geo-rust
```

## 4. 配置（环境变量，systemd `Environment=` 或本地进程环境）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3438 | 监听端口 |
| `GEO_DB_PATH` | `data/geo.db`（相对 WorkingDirectory） | SQLite 数据库（WAL 模式，自动迁移建表） |
| `GEO_UPLOADS` | `data/uploads` | 封面/素材上传目录 |
| `SEED_DEMO` | 1 | `=0` 跳过演示数据种子（**生产必设 0**；空库 + SEED_DEMO=1 会创建 demo@geo.local/demo1234） |
| `DISABLE_REGISTER` | 0 | `=1` 关闭自助注册（**生产建议 1**，账号由管理员邀请/创建） |
| `PUBLISH_MODE` | manual | `manual`=人工发布+回填（真实语义）；`mock`=确认后约 4 秒自动结算（仅演示培训） |

服务集成（LLM / 监测四平台 / 图像 / 对象存储 / 发布 Webhook）通过管理员界面「系统设置 → 服务集成」配置，存于数据库 `settings` 表，密钥脱敏显示。当前 Rust 版内容生成与监测为**确定性模板引擎**，真实 Provider 接入为二期（语义参考 `platform/src/providers/`，见 `docs/REAL-INTEGRATION.md`）。

## 5. 升级与回滚

**升级（两条等价路径）**：

```bash
# 路径 A：服务器上重跑安装脚本（拉最新代码后）
git pull && sudo bash ops/install.sh

# 路径 B：开发机一键远程部署
make deploy DEPLOY_HOST=root@<IP> DEPLOY_KEY=~/.ssh/<key>
# 流程：打包源码 → scp → 服务器备份旧二进制 → 重建 → systemctl restart → healthz 验证
```

升级自动完成数据库备份（`/opt/geo-backup/pre-install-*.db`）；数据库迁移使用 `CREATE TABLE IF NOT EXISTS`，向后兼容。

**回滚**：

```bash
sudo systemctl stop geo-rust
cp /opt/geo-rust/geo-platform.bak-<时间戳> /opt/geo-rust/target/release/geo-platform
# 如需连数据一起回滚：
sudo cp /opt/geo-backup/pre-install-<时间戳>.db /opt/geo/platform/data/geo.db
sudo systemctl start geo-rust && /opt/geo-rust/ops/geo-ctl.sh health
```

## 6. Nginx 反代 + HTTPS

模板见 `ops/nginx-geo.conf.example`：域名解析 → certbot 签证书 → 替换 `server_name` 与证书路径 → `cp` 到 `/etc/nginx/conf.d/geo.conf` → `nginx -t && systemctl reload nginx`。
启用 HTTPS 后建议在 systemd 单元追加 `Environment=DISABLE_REGISTER=1`（如未关）并确认登录 Cookie 策略符合内网/外网要求。

## 7. 安全清单（上线前逐项打勾）

- [ ] 修改演示密码 `demo@geo.local / demo1234`（登录 → 修改密码）
- [ ] `SEED_DEMO=0`、`DISABLE_REGISTER=1`（install.sh 参数或 systemd 单元）
- [ ] 防火墙仅放行必要端口（3438 或 443）
- [ ] HTTPS 部署（对外域名场景）
- [ ] 每日备份 cron 已配置（`ops/backup.sh`，见 OPERATIONS.md §3）
- [ ] 监控告警接入（`ops/monitor.sh` + 企微机器人 webhook，可选）

## 8. 数据归属与迁移

- 数据库默认建议与旧版共存路径 `/opt/geo/platform/data/geo.db`——Rust 版密码哈希（scrypt）与 Node 版完全兼容，**直接指向既有库即可接管全部账号与业务数据**。
- 全新部署（空库）时，首次启动自动建表；`SEED_DEMO=1` 会写入演示公司与项目。
- 迁移到其他机器：`geo-ctl backup` → 拷贝备份文件 → 新机 `geo-ctl restore`。

## 附录：旧 Node.js 版部署（已废弃，仅供追溯）

```bash
cd platform && node server.js        # 需 Node ≥ 22.5，端口 3438
```

Node 版的运维文档历史版本见 git（`docs/DEPLOYMENT.md` @ v1.5 之前）。
