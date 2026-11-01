# GEO 平台建设计划

> **实现状态（2026-10-31）：Goal A/B/C/D 全部完成。** E2E 端到端验收 44/44 通过（`node scripts/e2e.mjs`）。
> 启动：`cd platform && node server.js`（http://localhost:3438，演示账号 demo@geo.local / demo1234）；详见 [README.md](README.md)。

> 依据：
> - 《GEO 平台与 Skills 操作手册（课程补充草稿）》（feishu://A9SgdnnGqoveR4xNj6kcmNpZnig）
> - 《GEO破局行动营｜学员可复制提示词与实战模板》（feishu://NH8Lwg3PDiSPxbkQHt5chdhWnkh）
> 配套规范：[docs/skills-and-prompts.md](docs/skills-and-prompts.md)（技能清单与全部提示词，严格按文档）
> 日期：2026-10-30（10-31 更新：并入第二份方法论文档，进入完整实现）

---

## Goals（实现目标）

- **Goal A：GEO 平台**——Web 界面（十步工作台 + 六阶段模块 + Open Key 设置）+ Open API（plan/apply 两步写）+ Mock Provider 层（LLM 双模式 / AI 监测种子语料 / 发布渠道异步模拟），零外部依赖（Node 24 原生 + node:sqlite）。
- **Goal B：geo CLI**——version / capabilities / guide / auth login（本机录入密钥）/ call / plan / apply，输出统一 JSON。
- **Goal C：GEO Skills 技能包**——17 个技能（第一份文档技能地图）+ 第二份文档全部提示词与记录模板作为 references 模板库，提示词严格按两份文档原文。
- **Goal D：端到端验收**——自动化 E2E：从建项目 → 知识库 → 问题池 → 内容创作 → 三道审核 → 发布 → 监测命中 → 信源资产 → 分析复盘全链路跑通；七步品牌轮/产品轮提示词可原样执行。

## 第二份文档（提示词与实战模板）整合映射

| 文档章节 | 落点 |
|---|---|
| 1.1 摸底与溯源追问 | geo-brand-diagnosis references |
| 1.2 50 问生成提示词 | 平台"问题拓展"生成功能 + geo-keyword-pool references |
| 1.3 40 问精简与结构化 | 平台"问题库精简"功能（探索30/评估5/行动5 + Markdown 表格输出）+ geo-keyword-pool references |
| 1.4 未被推荐归因诊断 | geo-brand-diagnosis references |
| 1.5 品牌知识库六模块标准化 | 知识库数据结构（01-06 模块 + QA 索引 + 待补充标记 + 口径冲突清单）+ geo-knowledge references |
| 3.1 创作前输入检查 | 内容创作页前置检查 + geo-content-audit references |
| 3.2–3.4 三类内容创作提示词 | 内容创作功能 + geo-content-production / geo-ai-answer-card references（答案卡三形态：文章版/图片版/视频口播版） |
| 3.5 一键审核与发布 | 三道审核功能（通过/修改后通过/不通过）+ geo-content-audit references |
| 3.6 发布操作指令（发布包 7 字段） | 发布预览页 + geo-content-to-publish-pipeline references |
| 3.7 发布前审核记录模板 | 审核记录表单/存储 |
| 3.8 答案型文章正文模板 | 品牌文章结构模板 |
| 4.1 信源资产清单模板 | 信源资产字段与枚举（证据类型/发布主体/账号类型/可控性/页面状态）+ geo-source-assets references |
| 4.2 监测与引用记录模板 | 监测结果字段（精准命中/弱命中/未命中/待复测） |
| 4.3 逆向分析记录模板 | 逆向分析报告 + geo-analysis references |
| 5.1–5.9 全流程演示提示词 | 各技能 references（挖掘/完整性检查/语义解析/文章匹配/意图归类/语料库/第三方口吻/收录检测/循环优化） |
| 6.1–6.2 承接页检查与验证路径 | geo-analysis references |
| 7.1–7.5 商务诊断与沟通模板 | 报告类型"一页纸诊断" + geo-student-workflow references |

## 0. 一句话总结

按文档做一个「**GEO 平台（Web + Open API）+ 本地 CLI + GEO Skills 技能包**」三位一体的系统：学员在平台管理公司/项目/知识库/问题/文章/发布/监测数据，在 AI 编程工具（Codex / Claude Code / ZCode / WorkBuddy）里用文档中的提示词驱动 Skills 完成内容生产和 GEO 优化闭环；发布渠道（头条/搜狐/网易/抖音/知乎/小红书）与 AI 监测平台（豆包/DeepSeek/元宝/通义千问）第一期全部 mock。

## 0.5 关键架构决策（默认值，待你确认）

| # | 决策 | 默认方案 | 备选 |
|---|---|---|---|
| D1 | 平台形态 | 多租户 SaaS 结构（学员注册、独立项目/密钥），v1 注册做简版（邮箱+密码） | 内部单租户工具 |
| D2 | 技术栈 | Next.js 15 全栈（App Router）+ SQLite（Drizzle ORM，字段设计兼容 Postgres 迁移） | 前后端分离 |
| D3 | Skills 接入 | 仿 best-geo 做 Node CLI（`geo` 命令）：Skills → CLI → Open API，密钥存本地 CLI 配置 | Skills 内置脚本直连 REST |
| D4 | AI 生成 | Provider 抽象双模式：默认 mock（高质量固定样例），配置 `LLM_API_KEY` 后自动切真实 OpenAI 兼容接口（GLM/DeepSeek/Qwen 任一） | 全 mock / 直接真实 |
| D5 | 第三方 mock 范围 | 发布渠道、AI 监测、付费媒体、口碑监测、客户端发布全部 mock；内容生成按 D4 | — |

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  AI 编程工具（Codex / Claude Code / ZCode / WorkBuddy）        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  GEO Skills 技能包（17 个 SKILL.md，提示词严格按文档）     │  │
│  │  geo-student-workflow / geo-runtime / geo-config /      │  │
│  │  geo-brand / geo-knowledge(+sync) / geo-keyword-pool /  │  │
│  │  geo-content-production / geo-ai-answer-card /          │  │
│  │  geo-content-audit / geo-content-to-publish-pipeline /  │  │
│  │  geo-publish / geo-indexing / geo-source-assets /       │  │
│  │  geo-analysis / geo-brand-diagnosis / geo-troubleshooter│  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ spawn CLI（JSON in/out）
┌──────────────────────────────▼──────────────────────────────┐
│  geo CLI（Node 20+，npm 全局包，密钥存 ~/.geo/config.json）    │
│  version / capabilities / guide / auth login / call /        │
│  plan → apply（写操作两步制）/ 密钥本机录入页（loopback）        │
└──────────────────────────────┼──────────────────────────────┘
                               │ HTTPS + Bearer Open Key
┌──────────────────────────────▼──────────────────────────────┐
│  GEO 平台（Next.js 全栈）                                     │
│  ├─ Web 界面：十步工作台 + 六阶段模块 + 系统设置(Open Key)       │
│  ├─ Open API (/api/open/v1)：projects/questions/knowledge/   │
│  │  articles/materials/accounts/publishTasks/monitorTasks/   │
│  │  monitorResults/sources/reports                            │
│  ├─ Provider 层（可插拔）                                      │
│  │  ├─ llm-provider：内容/问题/审核生成（mock ⇄ 真实 LLM）      │
│  │  ├─ monitor-provider：豆包/DeepSeek/元宝/通义（mock）        │
│  │  ├─ publish-provider：头条/搜狐/网易/抖音/知乎/小红书（mock） │
│  │  └─ storage：本地上传 → /uploads URL（预留 OSS 适配）        │
│  └─ SQLite（Drizzle ORM）                                     │
└─────────────────────────────────────────────────────────────┘
```

**三层职责**（与文档"平台与 Skills 的分工"表严格对应）：

- **GEO 平台**：保存公司、项目、知识库、问题、文章、发布任务、上榜监测、复盘和报告；项目数据可追踪，发布和监测状态可回查。
- **GEO Skills**：把自然语言目标转成品牌、知识库、内容、审核、发布、监测和分析动作；不用记复杂操作，一句话完成一组工作。
- **学员**：提供真实资料，确认事实、发布范围、预算和外部写操作；对结果负责，不把未经核验的内容直接发布。

## 2. 数据模型（SQLite，核心表）

```
users                学员/管理员：id, email, passwordHash, role, createdAt
companies            公司：id, ownerUserId, name, industry, intro
projects             GEO 项目：id, companyId, name, brandName, productName,
                     defaultPlatforms(json), status, createdAt
                     （文档：公司+产品决定知识库/文章/发布/监测数据归属）
openKeys             接口密钥：id, userId, name, keyPrefix, keyHash,
                     authorizedProjectIds(json), lastUsedAt, revokedAt
knowledgeBases       知识库：id, projectId, type(brand|product), name, updatedAt
kbDocuments          知识库文档：id, kbId, title, content, factType
                     (事实|案例|优势|边界|资质), evidence(json：案例/数据/
                     资质/第三方链接), pendingEvidence(待补标记), updatedAt
questions            问题：id, projectId, text, category(品牌认知|产品推荐|
                     对比选型|效果验证|行动转化|风险判断), priority(P0-P3),
                     status(待监测|监测中|已上榜|优化中), version, withBrand,
                     source(人工|生成)
articles             文章：id, projectId, questionId, title, content,
                     type(答案卡|品牌优化|产品推荐), coverMaterialId,
                     status(已生成|已上传|已创建发布任务|已正式发布), createdAt
materials            素材：id, projectId, type(image|video|answerCardSet),
                     url, meta(json), createdAt
auditRecords         三道审核记录：id, articleId,
                     gate1(知识库一致性)+issues, gate2(媒体投稿标准)+issues,
                     gate3(GEO相关性与可信度)+issues, verdict, auditedAt
publishAccounts      授权账号：id, projectId, platform, accountName,
                     authStatus, quota  （mock 授权）
publishTasks         发布任务：id, projectId, articleId, platform,
                     accountId, status(已创建|发布中|已发布|失败),
                     publishedUrl, publishedAt, failReason
monitorTasks         上榜监测任务：id, projectId, questionIds(json),
                     aiPlatform(豆包|DeepSeek|元宝|通义千问|自定义),
                     mode(one-shot|scheduled), scheduleDays(如 3/7/14),
                     status(排队|运行中|完成|失败), createdAt
monitorResults       监测结果：id, taskId, questionId, aiPlatform, ranAt,
                     answerText(AI回答全文), brandMentioned, mentionPosition,
                     recommendLevel(优先推荐|明确推荐|提及|未出现),
                     recommendReason, competitors(json),
                     citations(json：title,url,platform,siteType),
                     keywords(拆解词json), isExactUrlHit
sourceAssets         信源资产：id, projectId, question, aiPlatform,
                     articleTitle, url, publishPlatform, publisher,
                     accountType, evidenceType, citedCount, brandPerformance,
                     competitorLink, controllability(自有|合作|不可控),
                     pageStatus, nextAction,
                     status(已引用|潜在|可投放|观察)
reports              报告：id, projectId, type(品牌诊断|产品推荐诊断|
                     优化前后对比|逆向分析), content(md), relatedTaskIds, createdAt
```

状态机（文档第七章"复测判断"硬编码进系统）：
- 文章：`已生成 → 已上传 → 已创建发布任务 → 已正式发布`（文章 ID≠已发布）
- 收录证据分级：`weak_title_account_hit（标题/账号提及=弱命中） < exact_url_hit（正式链接被引用）`，`stable` 需跨批次/跨平台持续出现。

## 3. 平台 Web 端功能模块（按文档第二章六阶段）

| 阶段 | 页面 | 核心功能 | 应留下的资产 |
|---|---|---|---|
| 基础建设 | 工作台、品牌管理、知识库 | 添加公司、添加 GEO 项目、添加知识库（品牌/产品两类）；知识库文档支持事实/案例/优势/边界/待补标记 | 品牌事实、产品事实、案例、优势、边界和更新时间 |
| 问题准备 | 问题拓展、搜索问题库 | 平台生成搜索问题（mock LLM）+ 手动导入；分类（品牌认知/产品推荐等 6 类）、P0-P3 优先级、状态流转 | 问题集、问题类型、优先级和问题状态 |
| 内容生产 | 内容创作、文章管理、资源中心 | 平台侧生成文章/答案卡/图片（mock LLM）；文章列表带状态标签；素材库 | 答案卡、品牌优化文章、产品推荐文章和素材 |
| 发布投放 | 内容发布、自媒体发布、付费媒体、授权账号管理 | 预览 → 创建发布任务 → 状态回查（异步模拟）；授权账号管理（mock）；十步工作台的"授权账号、创建发布、客户端发布" | 发布任务、文章 ID、正式链接和发布状态 |
| 效果监测 | 上榜监测、收录站点、口碑监测 | 创建监测任务（固定问题+平台+周期：一次性/3/7/14 天）；结果页展示 AI 回答全文、品牌表现、竞品、引用来源；收录站点列表 | 监测基线、AI 回答、竞品和引用记录 |
| 分析复盘 | 诊断报告、监测报告 | 品牌/产品诊断报告、优化前后对比、逆向分析（关键词频次、竞品对标）、信源资产库视图（四状态） | 信源资产、逆向分析表和下一轮行动计划 |
| 系统 | 系统设置 → Open Key | 创建/吊销接口密钥、勾选授权项目；密钥只显示一次 | 密钥记录 |

**十步工作台**做成向导页（进度条 + 每步入口）：添加公司 → 添加 GEO 项目 → 添加知识库 → 生成搜索问题 → 创建提示词 → 生成文章 → 授权账号 → 创建发布 → 客户端发布(mock) → 收录查询。

## 4. Open API 设计（/api/open/v1，Bearer Open Key）

响应统一包络：`{ ok, code, data, nextAction? }`；编码字段成对返回 `status`+`statusLabel`（展示用 Label，判断用数值——沿用参考仓库约定）。

| 能力组 | 端点 | mode |
|---|---|---|
| projects | list / create / update | read / write |
| questions | list / create / batchCreate | read / write |
| knowledge | list / uploadDoc / updateDoc | read / write |
| articles | list / get / create / update / delete | read / write（delete 最严确认） |
| materials | list / upload | read / write |
| accounts | list | read |
| publishTasks | create / list / get（含 publishedUrl、failReason） | write / read |
| monitorTasks | create（one-shot / scheduled）/ list / get | write / read |
| monitorResults | list / get（AI 回答全文 + citations） | read |
| sources | list / upsert | read / write |
| reports | create / list / get | write / read |

规则：
- 所有写操作支持 `dryRun=true` 返回变更摘要（CLI 的 plan/apply 基于此实现）；
- 批量导入类（questions.batchCreate）返回"将新增/已存在跳过/重复跳过"三类计数；
- publishTasks.create 返回 `pending:true`（任务排队≠完成）；
- monitorTasks.create 可带 `platforms: [豆包...]`、`questions[]`、`mode`；
- Open Key 只授权勾选的项目，越权返回 `AUTH_REQUIRED`/`FORBIDDEN` + `nextAction`。

## 5. geo CLI 设计（D3）

- npm 全局包，Node 20+，**零 Python 依赖**（文档加粗要求）。
- 命令：
  - `geo version --check`（版本可用性，返回 `CLI_UPDATE_REQUIRED` 时带 nextAction）
  - `geo capabilities`（能力清单 + 输入 schema）
  - `geo guide list` / `geo guide get <project|question|article|knowledge|material|publish|monitor|sources|report>`
  - `geo auth login`（阻塞式：起 loopback 本机页 → 用户浏览器粘贴 Open Key → 设备绑定写入 `~/.geo/config.json`(0600)；密钥不经过对话）
  - `geo auth status`
  - `geo call <capability> --input '{json}'`（read 直接执行）
  - `geo plan <capability> --input '{json}'`（write：调 API dryRun，本地暂存 planId+payload，30 分钟有效）
  - `geo apply <planId>`（确认后真正执行；apply 返回后不重复执行）
- 输出永远是单个 JSON 对象；`ok:false` 时带 `nextAction`（auth_login / ask_user / retry）。
- Skills 的 SKILL.md 中写明：说给用户听用 Label；写数据必须 plan→用户明确同意→apply；删除类要逐条确认；任务类 `pending:true` 表示排队中，回话告知而不是反复查询。

## 6. GEO Skills 技能包（规范见 docs/skills-and-prompts.md）

- 格式：Agent Skills（SKILL.md + references/），兼容 Codex / Claude Code / ZCode / WorkBuddy；仓库根提供 `install.js` 升级器（备份旧版 → 安装 `geo` CLI 与全部 `geo-*` 到 `~/.codex/skills`、`~/.claude/skills` 等目标目录）。
- 数量：14 个地图技能 + 品牌诊断（含产品推荐模式）+ AI 答案卡 + 故障排查 = **17 个**；文档中的同名异称（引用源资产库、内容发布流水线）作为 description 触发词别名。
- 每个技能 SKILL.md 包含：职责边界、触发词（文档提示词原句）、执行步骤（调用哪个 CLI 能力）、行为约束（文档原句：先脚本后图片需确认、发布前三道审核+确认清单、不编造标待补、仅执行一次、固定问题复测等）。
- 安装提示词（文档第三章原句）作为 README 与安装教程页的标准验证路径。

## 7. Mock 方案（D5）

| Mock 对象 | 设计要点 |
|---|---|
| llm-provider | 接口：generateQuestions / generateArticle / generateAnswerCard / generateCover / auditAssist。mock 返回按知识库内容拼装的高质量模板文（结论先行+证据+边界结构），保证三道审核可演示通过/不通过两种路径；配置 `LLM_BASE_URL`+`LLM_API_KEY`+`LLM_MODEL` 后走 OpenAI 兼容协议。封面 mock 生成 SVG 占位图。 |
| monitor-provider | 接口：`ask(platform, question) → {answer, citations, competitors, keywords}`。实现一个**种子语料检索器**：把项目内已发布的文章（标题+URL+摘要）和预置竞品语料建倒排索引，按问题相关度生成 AI 回答——已发布且匹配的 URL 会作为 citation 返回，从而真实演示"发布→监测→exact_url_hit→信源资产→优化复测"闭环。四个平台各配偏好权重（文档第倾六(四)的观察假设表：豆包偏头条/抖音、元宝偏腾讯系、通义偏阿里系/什么值得买、DeepSeek 偏公共/商业/垂直媒体）。同题重复提问支持受控随机（模拟 10 次逆向分析的变化）。 |
| publish-provider | 接口：`createTask(account, article) → taskId`、`getStatus(taskId) → {status, publishedUrl?, failReason?}`。模拟异步：创建后 30–120 秒（可配置加速）变为"已发布"并生成 `https://mock.toutiao.com/article/<id>` 形式的正式链接；预留故障注入开关（演示"发布失败→故障排查技能"路径）。客户端发布 mock 为自动完成。 |
| storage | 本地 `/uploads` 目录 + 静态服务；预留 S3/OSS 适配器接口。 |
| 口碑监测 / 付费媒体 | v1 仅菜单 + 空态页 + mock 数据开关，不进闭环（文档未展开细节）。 |

## 8. 实施阶段

### Phase 0：骨架与数据层（约 1–2 天）
- monorepo：`apps/web`（Next.js）、`packages/cli`、`skills/`、`packages/shared`（类型与常量）
- Drizzle schema 全量建表 + 种子数据（演示公司/项目/知识库/问题/竞品语料）
- 注册/登录（简版）、会话、系统设置 → Open Key（创建/吊销/授权项目）
- **验收**：Web 能建公司→项目→知识库→问题；能创建 Open Key。

### Phase 1：平台核心 + Open API + mock LLM（约 3–4 天）
- 六阶段页面（基础建设、问题准备、内容生产先行）；平台侧内容生成（mock）
- Open API v1 全量端点 + dryRun + 统一包络 + Label 对
- **验收**：纯 Web 跑通文档第二章前四阶段；用 curl + Open Key 完成 articles.create → materials.upload。

### Phase 2：CLI + Skills 包（约 3–4 天）
- `geo` CLI（auth/call/plan/apply/guide/capabilities/version）+ 安装器 install.js
- 17 个技能 SKILL.md（提示词与行为约束逐条对照 docs/skills-and-prompts.md）
- **验收**：在 Claude Code/Codex 里原样执行文档第三章安装提示词 → G1–G11 一句话入口全部路由正确；B 系列提示词跑通内容生产。

### Phase 3：发布与监测 mock 闭环（约 3–4 天）
- publish-provider / monitor-provider mock；发布状态机与回查页；上榜监测任务/结果页；3/7/14 天复测调度；信源资产库（四状态、14 字段）；诊断/对比/逆向分析报告
- **验收**：执行文档第十章**品牌轮七步**和**产品轮七步**全流程提示词，产出第八章全部交付物（问题、证据任务单、答案卡、文章、三道审核记录、发布任务、正式链接、监测结果、关键词频次、竞品对标、信源资产、优化计划）。

### Phase 4：打磨与真实预留（约 2–3 天）
- 十步工作台向导、报告导出（Markdown/图片）、口碑监测/付费媒体空态、安装教程页（对应文档的 bihuogeo.com/skills/）
- 真实 provider 适配器接口冻结（发布渠道、AI 监测、LLM、OSS 各留实现位）
- 端到端回归：文档"卡点处理"表 4 个场景逐一演练
- **验收**：新学员从安装提示词到独立跑完第三轮七步，全程无需人工干预平台。

总计约 12–17 个工作日（单人 + AI 辅助）。

## 9. 风险与说明

1. **文档草稿的同名异称**（发布工作流/流水线、信源管理/引用源资产库、"由 技能名称 列出最近任务"占位符）已按第四章规范名统一，见 docs/skills-and-prompts.md 一节。
2. **文档中两份课程 PDF**（内容创作与发布 49MB、信源投放监测与逆向分析 9.8MB）因素材下载权限未读取；其中"两层逆向分析"等细节如需纳入，需授权 `docs:document.media:download` 后补读。
3. **监测"本地/云端能力"**：文档 B8 提示词两词并列。当前按"云端=平台监测任务（mock）、本地=学员让宿主 Agent 直接问 AI（v1 不实现）"理解，待确认。
4. 平台偏好表（文档第六章第四节）在 mock 与 Skills 中都实现为**观察假设**，不写成固定规则（文档明确要求）。
