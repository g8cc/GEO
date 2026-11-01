# GEO 营销平台 v1.6.0 — 项目文档索引

> 交付日期：2026-10-31 ｜ 状态：**已交付，服务器在线运行中**
> 线上地址：http://120.46.133.88:3438（Rust 版主服务）
> 登录：demo@geo.local（密码已由管理员设置，请通过强制改密流程设置你自己的密码）

## 项目演进时间线

| 阶段 | 版本 | 内容 |
|---|---|---|
| 方法论学习 | — | 深度阅读两份飞书方法论文档（操作手册 + 提示词模板） |
| M1 计划 | — | PLAN.md：架构、数据模型、文档整合映射 |
| M2 Spec | — | docs/spec/00–06 七份规格文档 |
| M3 开发 | — | Node.js 版全功能实现 + Spec 对照修正 |
| M4 测试 | — | E2E 44 项 + 扩展套件 31 项 |
| M5 验收 | — | docs/ACCEPTANCE.md：75/75 全绿 |
| M6 文档 | — | 全套交付文档 + CHANGELOG |
| v1.0 审计 | 1.0.0 | 两轮审计，17 项发现全部修复 |
| v1.1 真实化 | 1.1.0 | AI 监测真实 Provider、手动发布回填、聚光灯引导 |
| v1.2 终局 | 1.2.0 | 卡密收款、白标导出、事件通知、移动端、Postgres 迁移包 |
| v1.3 合规 | 1.3.0 | 密码策略、登录锁定、审计日志、协议勾选、AI 声明 |
| v1.4 组织 | 1.4.0 | 组织/角色/用量/调度器 |
| v1.5 Rust | 1.5.0 | Rust 版开发（Axum + SQLite + 40 能力） |
| v1.6 异步 | 1.6.0 | 全站异步加载 + 后台任务系统 |
| v1.6.1 加固 | 1.6.1 | 安全修复 + LLM 重试 + 内存监控 + 文件清理 |
| Rust 部署 | 1.6.0 | Rust 版切换为主服务，Node 版停止 |

## 当前架构

```
线上（华为云 120.46.133.88）
├── Rust 版（geo-rust.service）← 主服务，端口 3438，内存 5MB
│   ├── 二进制: /opt/geo-rust/target/release/geo-platform (4.1MB)
│   ├── 源码: /opt/geo-rust/src/ (main.rs, db.rs, auth.rs, api.rs, ops.rs, web.rs, pages.rs, pages2.rs)
│   └── 数据库: /opt/geo/platform/data/geo.db（与 Node 版共享）
├── Node.js 版（geo.service）← 已停止，保留作为开发参考
│   ├── 代码: /opt/geo/platform/
│   └── 启动: systemctl start geo
├── 备份: /opt/geo-backup/（每日 02:30 自动备份）
├── 监控: /opt/geo/ops/monitor.sh（每 5 分钟）
└── cron: /etc/cron.d/geo
```

## 文档索引

### 开发者
| 文档 | 内容 |
|---|---|
| [PLAN.md](../PLAN.md) | 建设计划与里程碑 |
| [docs/spec/00–06](spec/) | 七份规格文档（总览/数据模型/API/Web/CLI/Mock/测试） |
| [docs/AUDIT.md](AUDIT.md) | 三轮审计报告（17+6+6 项发现与修复） |
| [docs/HANDOVER.md](HANDOVER.md) | 交接文档（代码地图/设计决策/扩展指南） |
| [docs/skills-and-prompts.md](skills-and-prompts.md) | 38 条方法论提示词逐条映射 |
| [docs/REAL-INTEGRATION.md](REAL-INTEGRATION.md) | 真实场景接入指南 |

### 运维
| 文档 | 内容 |
|---|---|
| [docs/DEPLOYMENT.md](DEPLOYMENT.md) | 部署手册（systemd/Nginx/HTTPS/备份/检查单） |
| [docs/OPERATIONS.md](OPERATIONS.md) | 运维手册（巡检/Runbook/监控） |
| [docs/SECURITY.md](SECURITY.md) | 安全说明（认证/授权/防护/威胁模型） |

### 用户
| 文档 | 内容 |
|---|---|
| [docs/USER-GUIDE.md](USER-GUIDE.md) | 使用手册 |
| [docs/API-REFERENCE.md](API-REFERENCE.md) | API 参考 |
| [docs/FAQ.md](FAQ.md) | 常见问题 |
| [docs/product/产品介绍.md](product/产品介绍.md) | 产品介绍 |
| [docs/DELIVERY-CHECKLIST.md](DELIVERY-CHECKLIST.md) | 交付验收单 |

### 测试
| 文件 | 说明 |
|---|---|
| scripts/e2e.mjs | E2E 端到端 46 项（Node 版） |
| scripts/test-suite.mjs | 扩展套件 123 项（含安全/合规/真实化/组织回归） |
| /opt/geo-rust/test-all.sh | Rust 版功能测试（服务器上） |

## 当前系统状态

| 指标 | Node.js 版（开发参考） | Rust 版（生产主服务） |
|---|---|---|
| 内存 RSS | 150~300 MB | **5.25 MB** |
| 二进制 | 需要 Node.js ≥22.5 | **4.1 MB 单文件** |
| 能力 | 39 | **40** |
| 页面 | 23 | **21** |
| systemd | geo.service（已停止） | geo-rust.service（**active + enabled**） |
| 测试 | 169 项全绿 | 10 API + 21 页面 + 单元测试 |

## 待你操作的事项

1. 域名 + ICP 备案 → 通过后 5 分钟启用 HTTPS
2. 法务审阅 `/terms` 和 `/privacy` 模板
3. 企微机器人 Webhook → 填到 `/opt/geo/ops/alert.env` 开启告警
4. 找 2~3 个真实客户用卡密模式试点收费

## 快速操作备忘

```bash
# 查看服务状态
systemctl status geo-rust

# 查看日志
journalctl -u geo-rust -f

# 重启服务
systemctl restart geo-rust

# 备份
/opt/geo/ops/backup.sh

# 切换回 Node 版（如需 Web UI 完整功能）
systemctl stop geo-rust && systemctl start geo

# 切换回 Rust 版
systemctl stop geo && systemctl start geo-rust
```
