# GEO 平台 + GEO Skills 完整实现

按两份方法论文档完整实现的 GEO（生成式引擎优化）运营系统：

- 《GEO 平台与 Skills 操作手册》—— 平台十步工作台、技能功能地图、七步实操模板、卡点处理
- 《GEO破局行动营｜学员可复制提示词与实战模板》—— 50 问生成、知识库六模块、三类内容创作、三道审核、发布包、信源/监测/逆向分析模板、商务诊断模板

**所有技能提示词严格按文档原文实现**（对照表见 `docs/skills-and-prompts.md` 与 `PLAN.md`）。

## 文档地图

| 文档 | 内容 |
|---|---|
| [PLAN.md](PLAN.md) | 建设计划与里程碑（M1） |
| [docs/spec/](docs/spec/) | **完整 Spec**：00 总览与范围 / 01 数据模型 / 02 Open API 规范 / 03 Web 功能规格 / 04 CLI 与 Skills 规范 / 05 Mock Provider 规范 / 06 测试与验收标准（M2） |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 验收报告：E2E 44/44 + 扩展套件 31/31，含发现与修复记录（M5） |
| [docs/skills-and-prompts.md](docs/skills-and-prompts.md) | 技能清单与 38 条文档提示词逐条映射 |
| [docs/AUDIT.md](docs/AUDIT.md) | 两轮审计报告：17 项发现与修复、扫描复核、交付边界 |
| [docs/REAL-INTEGRATION.md](docs/REAL-INTEGRATION.md) | 真实场景接入指南：监测四平台真实 Provider、手动发布回填、二期路线 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志（M6） |
| **[docs/README.md](docs/README.md)** | **文档总索引（按角色导航：商业交付全套 16 份）** |

## 组成

```
platform/   GEO 平台（Web + Open API + Mock Providers，零外部依赖）
cli/        geo CLI（Skills 与平台之间的桥接层，零依赖）
skills/     17 个 geo-* 技能（Agent Skills 格式，兼容 Codex / Claude Code / ZCode 等）
scripts/    e2e.mjs 端到端验收（44 项检查）
docs/       技能清单与提示词对照表
PLAN.md     建设计划与文档整合映射
install.js  Skills 安装器
```

## 快速开始

### 1. 启动平台（要求 Node 22.5+，推荐 24，无需 npm install）

```bash
cd platform && node server.js
# Web 界面 http://localhost:3438  演示账号 demo@geo.local / demo1234
```

### 2. 安装 Skills 到你的 AI 编程工具

```bash
node install.js          # 预演
node install.js --apply  # 安装到 ~/.codex/skills 和 ~/.claude/skills
```

### 3. 安装并登录 CLI

```bash
cd cli && npm install -g .        # 或 alias geo='node <路径>/cli/geo.js'
geo version --check
geo auth login --server http://localhost:3438   # 浏览器粘贴 Open Key，密钥只存本机
```

Open Key 在平台「系统设置 → Open Key」创建（勾选授权项目，只显示一次）。

### 4. 在 Codex / Claude Code 里跑通闭环

```text
我是新学员，帮我选择合适模式并跑一个 GEO 项目。
```

或按课程提示词逐条执行（全部收录于各技能 SKILL.md 与 references/）：

```text
使用知识库整理技能，帮我整理品牌知识库和产品知识库，并列出证据缺口。
使用内容创作技能，基于这个问题和知识库生成 AI 答案卡、品牌优化文章和产品推荐文章。
帮我审核这篇内容，检查知识库一致性、媒体投稿标准和 GEO 相关性与可信度。
使用上榜监测技能，基于这批问题创建收录监测任务，并记录 AI 回答和引用来源。
使用信源管理技能，从这次监测结果生成引用源资产库和信源补强建议。
使用 GEO 分析技能，对比竞品和自身在 AI 回答、引用来源和证据缺口上的差异。
```

## Mock 说明（第三方）

| 第三方 | Mock 行为 | 切换真实 |
|---|---|---|
| 内容生成（LLM） | 按知识库事实拼装的结构化样例 | 配置 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（OpenAI 兼容），提示词用文档原文 |
| AI 监测（豆包/DeepSeek/元宝/通义） | 种子语料检索：已发布文章 + 竞品种子 + 平台偏好权重；发布后可真实演示 exact_url_hit | 实现 `src/providers/monitor.js` 同名接口 |
| 发布渠道（头条/搜狐/网易/抖音/知乎/小红书/公众号/什么值得买） | 异步模拟：确认后约 4 秒完成（`GEO_MOCK_FAST=0` 慢速），生成 `https://mock.<域名>/article/…`；`GEO_MOCK_FAIL_RATE` 注入失败演练 | 实现 `src/providers/publish.js` 同名接口 |
| 封面/图片 | SVG 占位图 | 接 OSS（storage 适配位） |

## 关键机制（与参考实现 best-geo 对齐）

- **写操作两步制**：`geo plan`（变更摘要，30 分钟有效）→ 用户明确同意 → `geo apply`（只能执行一次）；read 直接 `geo call`。
- **Label 机制**：数值字段成对返回 `*Label` 中文名；跨表歧义字段（status/platform）按行类型转换。
- **密钥安全**：Open Key 只显示一次；CLI 本机设备绑定（loopback 录入页），密钥不经对话。
- **状态机**：文章 已生成→已上传→已创建发布任务→已正式发布；监测状态 精准命中/弱命中/未命中/待复测；exact_url_hit 才是收录证据。

## 测试与验收

```bash
node scripts/e2e.mjs        # 44 项端到端：登录→Open Key→50/40问→创作→三道审核→发布→监测命中→信源→四类报告→CLI→页面巡检
node scripts/test-suite.mjs # 43 项扩展套件：单元级 / API 契约 / 安全（密钥/设备/跨租户/所有权守卫）/ 状态机（plan原子性/失败注入/额度/删除保护）/ 审计回归
```

- 验收结论与证据：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)（2026-10-31 验收通过：75/75）
- 两轮安全与质量审计：[docs/AUDIT.md](docs/AUDIT.md)（17 项发现全部修复，回归 87/87 全绿）

## 技能地图

| 技能 | 用途 |
|---|---|
| geo-student-workflow | 学员入口：模式判断 + 启动检查 + 课程带跑 |
| geo-runtime | 环境诊断（不装 Python） |
| geo-config | Open Key 配置 + 公司/产品选择 |
| geo-brand | 品牌定位整理 |
| geo-knowledge / geo-knowledge-sync | 知识库六模块整理 / 平台同步 |
| geo-keyword-pool | 问题池：50 问 / 40 问 / P0-P3 |
| geo-content-production | 三类内容创作 + 封面 |
| geo-ai-answer-card | 答案卡脚本 → 确认 → 图片 |
| geo-content-audit | 三道审核 + 审核记录 |
| geo-content-to-publish-pipeline | 发布包预览 → 确认清单 → 发布 |
| geo-publish | 发布任务创建与回查 |
| geo-indexing | 上榜监测 + 3/7/14 复测 |
| geo-source-assets | 信源资产四状态 |
| geo-brand-diagnosis | 品牌/产品诊断 |
| geo-analysis | 对比 / 逆向分析 / 承接检查 |
| geo-troubleshooter | 卡点排查 |
