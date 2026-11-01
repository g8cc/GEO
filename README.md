# GEO 营销平台（Rust 版）

生成式引擎优化（GEO）运营平台：让 AI 在用户提问时**准确认识你、推荐你、引用你**。
覆盖完整运营闭环：公司/项目 → 知识库六模块 → 50/40 问 → 内容创作 → 三道审核 → 发布 → 上榜监测 → 信源资产 → 诊断报告。

> **主版本为 Rust (Axum) 实现**：单二进制、零 npm 依赖、SQLite 存储，release 版常驻内存约 10 MB（对比 Node 参考实现的 150-300 MB）。
> `platform/` 下的 Node.js 实现为参考实现（已由 Rust 版替代，其 mock Provider 语义与提示词与之对齐）。

## 功能总览

| 模块 | 能力 |
|---|---|
| 工作台 | 十步工作台（每步自动打勾）、任务式快速上手、新手引导 |
| 基础建设 | 公司管理、GEO 项目（品牌/产品/卖点/关键词）、双知识库（品牌/产品，六模块标准化 + QA 索引 + 口径冲突清单） |
| 问题池 | 一键 50 问（综合/场景/人群/痛点/功能/决策）、精简标准 40 问（探索30/评估5/行动5）、优先级 P0-P3 |
| 内容 | AI 答案卡 / 品牌优化文章 / 产品推荐文章（自动生成 SVG 封面）、三道审核（知识库一致性 / 媒体投稿标准 / GEO 可信度，规则引擎可解释） |
| 发布 | 七字段发布包确认清单、发布状态机（已创建→发布中→已发布/失败）、手动回填真实 URL、授权账号与额度 |
| 监测 | 上榜监测（多题多平台、3/7/14 周期复测）、收录站点聚合、口碑监测（负面信号词探测）、信源资产四状态沉淀 |
| 报告 | 品牌诊断 / 产品推荐诊断 / 优化前后对比 / 逆向分析（同题 N 次）/ AI 现状一页纸 / 口碑摘要，白标导出（打印即 PDF） |
| 系统 | Open Key（Open API 40 能力）、服务集成配置、卡密兑换（订阅套餐）、操作审计、团队成员与配额、一键 GEO（粘贴文档自动跑通全链路） |

## 快速开始

### 服务器部署（一键）

```bash
# 在装有 Rust 工具链的 Linux 服务器上（环境要求见 docs/DEPLOYMENT.md）
git clone <仓库地址> && cd GEO
sudo bash ops/install.sh                       # 默认 /opt/geo-rust，端口 3438
# 生产建议：sudo bash ops/install.sh --seed-demo 0 --disable-register 1
```

安装脚本幂等：重复执行即升级（自动备份数据库 → 同步源码 → 重建 → 重启 → 健康检查）。

### 本地开发

```bash
make run          # 端口 3439，自动种子演示数据
# 或 cd rust && cargo run

make test         # 单元测试（19 项）
make fulltest     # 全量 89 项集成测试（需 make run 后另开终端）
make verify       # 单命令质量门：clippy + 单测 + 全量 + HTML 结构审计 + 渲染截图（交付前必跑）
```

演示账号：`demo@geo.local` / `demo1234`（SEED_DEMO=1 时自动创建）

### 日常运维（geo-ctl）

```bash
/opt/geo-rust/ops/geo-ctl.sh status      # 服务状态
/opt/geo-rust/ops/geo-ctl.sh health      # 健康检查（服务/healthz/登录页/数据库/磁盘）
/opt/geo-rust/ops/geo-ctl.sh backup      # 在线备份（WAL 一致，不停服，自动轮转 14 份）
/opt/geo-rust/ops/geo-ctl.sh logs -f     # 跟踪日志
/opt/geo-rust/ops/geo-ctl.sh restore <备份.db>
```

开发机上等价命令：`make status | health | backup | logs`（读取 `ops/geo.env`）。

## 架构

```
浏览器 / AI 工具(Skills) → :3438 geo-platform(Rust/Axum, 单二进制)
                              ├─ Web UI   23 个服务端渲染页面（format! 拼装，零模板引擎依赖）
                              ├─ Open API POST /api/open/v1/call/*（11 read）+ /plan/*（8 write）
                              └─ SQLite(WAL) + data/uploads/
```

- `rust/` — **主实现**：src/ 11 个模块（web 布局引擎、pages×3 页面集、mock 确定性引擎、ui 组件、auth 会话、db、api、ops）
- `platform/` — Node.js 参考实现（含真实 LLM/监测 Provider 的接入语义，供二期真实化对照）
- `cli/` + `skills/` — geo CLI 与 17 个 Agent Skills（连接 AI 编程工具与平台）
- `ops/` — **运维套件**：install.sh 一键安装、geo-ctl.sh 服务管理、backup.sh 每日备份、monitor.sh 巡检告警、nginx-geo.conf.example HTTPS 模板
- `scripts/rust-full-test.sh` — 88 项全量测试（页面路由/业务闭环/数据完整性/安全）

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3438 | 监听端口 |
| `GEO_DB_PATH` | `data/geo.db`（相对工作目录） | SQLite 数据库 |
| `GEO_UPLOADS` | `data/uploads` | 封面/素材目录 |
| `SEED_DEMO` | 1 | `=0` 不写演示种子（**生产设 0**） |
| `DISABLE_REGISTER` | 0 | `=1` 关闭自助注册（**生产建议 1**） |
| `PUBLISH_MODE` | manual | `manual`=人工发布+回填（真实语义）；`mock`=确认后约 4 秒自动结算（仅演示） |

密码哈希与 Node 版 scrypt 完全兼容，可直接接管既有 Node 版数据库。

## 第三方能力说明（当前为确定性模板引擎）

50 问生成、知识库整理、内容创作、三道审核、监测回答、报告均为**可复现的确定性实现**（mock 引擎，零外部依赖，结果随输入稳定）。
真实化路径：`platform/src/providers/` 内有 LLM / 四平台监测 / 图像 / 对象存储的完整接入语义；系统设置页已保留对应配置项，按 `docs/REAL-INTEGRATION.md` 二期接入。

## 文档地图

| 文档 | 内容 |
|---|---|
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | **部署手册**：一键安装/升级/回滚、环境变量、systemd、Nginx+HTTPS、安全清单 |
| **[docs/OPERATIONS.md](docs/OPERATIONS.md)** | **运维手册**：geo-ctl 命令参考、日常巡检、备份恢复、故障排查 Runbook |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | 平台功能使用指南（十步工作台详解） |
| [docs/API-REFERENCE.md](docs/API-REFERENCE.md) | Open API 40 能力参考 |
| [docs/SECURITY.md](docs/SECURITY.md) | 安全设计与加固清单 |
| [docs/FAQ.md](docs/FAQ.md) | 常见问题 |
| [docs/README.md](docs/README.md) | 文档总索引 |
| [docs/RUST-UI-REFACTOR.md](docs/RUST-UI-REFACTOR.md) | Rust 版重构计划与执行记录 |
| [docs/spec/](docs/spec/) | 完整 Spec（数据模型 / Open API / Web / CLI / Mock / 验收标准） |

## 测试与验收

- `cargo test`：19 项单元测试
- `bash scripts/rust-full-test.sh`：88 项全量测试（本地与生产均已跑通零失败）
- 历史验收记录（Node 版时代）：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)、[docs/AUDIT.md](docs/AUDIT.md)

## Skills（AI 编程工具连接）

平台可被 Codex / Claude Code / ZCode 等工具通过 geo CLI 与 17 个 geo-* Skills 驱动（见 `skills/`，安装器 `node install.js`）。
在 AI 工具里对它说：「我是新学员，帮我选择合适模式并跑一个 GEO 项目。」即可带跑完整闭环。
