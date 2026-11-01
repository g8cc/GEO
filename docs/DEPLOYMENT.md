# 部署手册

> 适用版本：v1.0.0 ｜ 组件：GEO 平台（platform/）+ geo CLI（cli/）+ GEO Skills（skills/）
> 环境要求：Linux / macOS，**Node.js ≥ 22.5**（推荐 24 LTS），无任何 npm 依赖、无 Python、无原生编译。

## 1. 部署形态

| 形态 | 说明 | 适用 |
|---|---|---|
| 单机演示 | `node server.js` 直接跑 | 培训、POC、内网演示 |
| 单机生产 | systemd 守护 + Nginx 反代 + HTTPS | 中小团队商用（SQLite 单机） |
| 集群扩展 | 前置负载均衡，DB 换 Postgres（见 §7） | 多并发商用（需开发排期） |

## 2. 配置的两种方式

1. **UI 配置（推荐）**：管理员登录 → 侧边栏「系统配置（真实化开关）」→ 分组填写/粘贴 Key → 保存即生效（无需重启），带连通测试按钮；配置存于数据库 `settings` 表，密钥脱敏显示。
2. **环境变量**：下表全部可用环境变量设定（作为默认值；UI 保存的值会覆盖同名环境变量）。

## 2.1 环境变量（全部可选项）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3438 | 监听端口 |
| `GEO_DB_PATH` | `platform/data/geo.db` | SQLite 数据库文件（WAL 模式） |
| `SEED_DEMO` | 1 | `=0` 跳过演示数据种子（**生产必设为 0**） |
| `DISABLE_REGISTER` | 0 | `=1` 关闭自助注册（**生产建议设为 1**，管理员建号） |
| `SESSION_SECURE` | 0 | `=1` 会话 Cookie 加 `Secure` 标记（**HTTPS 部署必设为 1**） |
| `GEO_MOCK_FAST` | 1 | 发布 mock 结算 4 秒；`=0` 20 秒 |
| `GEO_MOCK_FAIL_RATE` | 0 | 发布失败注入率（演练用，生产保持 0） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 未设 | 配置后内容生成切真实 LLM（OpenAI 兼容协议），未配置走模板 |
| `MONITOR_ARK_KEY` / `MONITOR_DEEPSEEK_KEY` / `MONITOR_HUNYUAN_KEY` / `MONITOR_DASHSCOPE_KEY`（各含 `_*_BASE/_*_MODEL`） | 未设 | 四平台真实 AI 监测；配谁谁真，未配回落演示数据 |
| `MONITOR_MOCK` | 1 | `=0` 严格模式：未配置真实监测的平台显式报错，不给演示数据（**生产建议 =0**） |
| `IMAGE_API_KEY` / `IMAGE_BASE_URL` / `IMAGE_MODEL` / `IMAGE_PROVIDER` | 未设 | 真实封面生成（OpenAI 兼容 images 或 `IMAGE_PROVIDER=dashscope` 万相）；未配置回落 SVG |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `S3_PUBLIC_BASE` | 未设 | 对象存储（OBS/OSS/MinIO，S3 兼容 SigV4）；未配置回落本地 uploads |
| `PUBLISH_MODE` | manual | `manual`=真实流程（人工/回填/Webhook）；`mock`=演示自动结算（**生产保持 manual**） |
| `PUBLISH_WEBHOOK_URL` / `PUBLISH_WEBHOOK_TOKEN` | 未设 | Webhook 发布渠道：确认发布后推送发布包，回包 `{ok,publishedUrl}` 自动落库 |
| `TRUST_PROXY` | 0 | `=1` 部署在反代后信任 X-Forwarded-For（登录限流按真实客户端 IP） |

## 3. 标准部署步骤（Linux 单机生产）

```bash
# 1. 准备（Node 22.5+；Ubuntu 可用 nodesource 安装 22/24 LTS）
node --version

# 2. 放置代码
mkdir -p /opt/geo && cd /opt/geo
#    将项目文件同步到 /opt/geo（git clone 或安装包解压）

# 3. 首次启动（生成空库；SEED_DEMO=0 不含演示账号）
cd /opt/geo/platform
SEED_DEMO=0 DISABLE_REGISTER=1 PORT=3438 node server.js
#    用首个管理员流程建号：临时放开注册或使用下述 CLI 方式创建（见 §3.1）

# 4. 数据目录（默认自动创建）
#    /opt/geo/platform/data/geo.db      业务数据库
#    /opt/geo/platform/data/uploads/    素材文件
#    建议将 data/ 纳入备份与磁盘监控
```

### 3.1 创建首个管理员（注册关闭时）

方式 A（推荐）：临时放开注册 → 注册后立刻改回：
```bash
DISABLE_REGISTER=0 PORT=3438 node server.js   # 浏览器 /register 创建管理员
# 然后 Ctrl+C，改回 DISABLE_REGISTER=1 重启
```

方式 B：直接初始化（sqlite3 CLI 不可用时可用 node 脚本调用 `hashPassword` 写 users 表）。

### 3.2 systemd 守护

`/etc/systemd/system/geo.service`：

```ini
[Unit]
Description=GEO Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/geo/platform
Environment=PORT=3438
Environment=SEED_DEMO=0
Environment=DISABLE_REGISTER=1
Environment=SESSION_SECURE=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=geo
# 硬化
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/geo/platform/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin geo && sudo chown -R geo:geo /opt/geo
sudo systemctl daemon-reload && sudo systemctl enable --now geo
curl -s http://127.0.0.1:3438/healthz   # {"ok":true,...}
```

### 3.3 Nginx 反向代理 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name geo.example.com;
    ssl_certificate     /etc/letsencrypt/live/geo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/geo.example.com/privkey.pem;

    client_max_body_size 25m;          # 素材上传（服务端上限 20MB）
    location / {
        proxy_pass http://127.0.0.1:3438;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server { listen 80; server_name geo.example.com; return 301 https://$host$request_uri; }
```

> HTTPS 部署后务必 `SESSION_SECURE=1`（Cookie Secure 标记），Open API 同域走 `https://geo.example.com/api/open/v1/...`。

## 4. CLI 与 Skills 部署（学员/运营机器）

```bash
# CLI（二选一）
cd /opt/geo/cli && npm install -g .
alias geo='node /opt/geo/cli/geo.js'

# 登录（本机设备绑定；密钥在平台「系统设置 → Open Key」创建）
geo auth login --server https://geo.example.com

# Skills 安装到 AI 编程工具（预演 → 执行）
node /opt/geo/install.js            # 预演
node /opt/geo/install.js --apply    # 安装 ~/.codex/skills 与 ~/.claude/skills
```

学员安装提示词（文档原文中的平台地址替换为实际地址）：
`请从 <你的 skills 仓库地址> 安装最新 GEO Skills：…在系统设置 → Open Key 创建接口密钥：<平台地址>/#/settings/keys…`

## 5. 备份与恢复

```bash
# 备份（WAL 模式下请连 -wal/-shm 一起拷贝，或用 sqlite3 在线备份）
sqlite3 /opt/geo/platform/data/geo.db ".backup '/backup/geo-$(date +%F).db'"
tar czf /backup/uploads-$(date +%F).tgz /opt/geo/platform/data/uploads

# 恢复（停服 → 替换 → 启服）
systemctl stop geo
cp /backup/geo-2026-10-31.db /opt/geo/platform/data/geo.db
rm -f /opt/geo/platform/data/geo.db-wal /opt/geo/platform/data/geo.db-shm
tar xzf /backup/uploads-*.tgz -C /
systemctl start geo
```

建议：每日定时备份 + 保留 30 天 + 每季度做一次恢复演练；`data/` 所在磁盘空间告警阈值 80%。

## 6. 升级

1. 备份（§5）；
2. 替换代码（git pull / 新安装包），`node --check server.js` 校验；
3. 重启——库结构迁移为幂等 `CREATE TABLE IF NOT EXISTS`，自动补建；
4. 冒烟：`/healthz`、登录、任一项目页、`node scripts/e2e.mjs`（测试环境预演后再上生产）；
5. Skills/CLI 升级：`node install.js --apply`（自动备份旧技能到 `~/.geo-skills-backups/`）+ `geo version --check`。

## 7. 生产化检查单（上线前逐项打勾）

- [ ] `SEED_DEMO=0`（无演示账号/演示数据）
- [ ] `DISABLE_REGISTER=1`（关闭自助注册）+ 管理员账号强密码
- [ ] HTTPS 启用且 `SESSION_SECURE=1`
- [ ] Nginx 限流（至少对 `/login`、`/register`、`/api/open/v1/auth/verify`）
- [ ] systemd 硬化（非 root 用户、ProtectSystem、ReadWritePaths 仅 data/）
- [ ] 备份定时任务 + 恢复演练通过
- [ ] 磁盘监控（data/ 目录）+ `/healthz` 拨测
- [ ] 日志收集（journalctl / 文件）与保留策略
- [ ] 已知边界确认（docs/AUDIT.md §3：同步 SQLite 规模、auth/verify 限流建议）
- [ ] 真实能力配置：管理员登录 →「系统配置」页填写 LLM/监测四平台/图像/S3（或用环境变量，见 docs/REAL-INTEGRATION.md）；`MONITOR_MOCK=0`（严格模式）、`PUBLISH_MODE=manual`（默认）
- [ ] 反代后设置 `TRUST_PROXY=1`

## 8. 故障回滚

`systemctl stop geo` → 恢复上一版本代码目录 → 恢复最近备份（§5）→ 启动 → 冒烟。数据库结构向前兼容（幂等建表），回滚旧版本代码无需回滚库。
