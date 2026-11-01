# GEO 平台规格说明书 02 · Open API 规范

> 实现文件：`platform/src/openapi.js`（路由与能力注册表）、`platform/src/guides.js`（guide 文本）、`platform/src/auth.js`（Open Key 认证）、`platform/src/services.js`（业务动作）。
> 基线：**39 个能力 = 16 read + 23 write**（v1.1 新增 publishTasks.markPublished；v1.2 新增 reputation.create），12 份 guide（由能力注册表程序化导出核对）。

## 1. 传输与认证

- 入口：`POST /api/open/v1/{call|plan|apply}/<capability>`，请求体 JSON。
- 认证：`Authorization: Bearer <Open Key>`（sha256 落库比对）+ 可选 `X-Geo-Device` 设备 ID。
- 密钥绑定：首个使用设备绑定该密钥（`auth/verify`），后续设备不一致返回 `DEVICE_MISMATCH`。
- 吊销密钥立即失效（`AUTH_REQUIRED`）。
- 项目授权：所有带 `projectId` 的能力校验该项目在密钥 `authorizedProjectIds` 内；未授权返回错误并引导用户在网页「密钥管理」勾选（立即生效，无需重新登录）。

## 2. 响应包络

```jsonc
// 成功
{ "ok": true, "code": "OK", "data": … }
// 失败
{ "ok": false, "code": "…", "message": "…", "nextAction": { "type": "…", "command": "…" } }
```

错误码：`AUTH_REQUIRED`（未认证/密钥无效/吊销）、`DEVICE_MISMATCH`、`FORBIDDEN`（项目未授权）、`NOT_FOUND`（能力/对象不存在）、`VALIDATION_ERROR`、`CONFLICT`（状态不允许）、`WRITE_REQUIRES_PLAN`、`PLAN_NOT_FOUND` / `PLAN_USED` / `PLAN_EXPIRED`、`CAPABILITY_ERROR`、`INTERNAL`。

Label 约定：列表/对象统一追加 `*Label` 字段（见 01-数据模型 §4）；`projects.list` 等所有 read 能力直调，write 能力直调返回 `WRITE_REQUIRES_PLAN` + `nextAction.command`。

## 3. plan / apply 两步制

```
POST /api/open/v1/plan/<capability>   { input }         → { planId, capability, summary, expiresInMinutes: 30 }
POST /api/open/v1/apply/<planId>      { planId }        → { planId, capability, applied: true, data }
```

- plan 只生成摘要不落库变更（summary 由各能力定义，写清变更前后与连带影响）；
- apply 校验：存在 → 未使用 → 未过期；返回 `PLAN_USED` / `PLAN_EXPIRED`（过期需重新 plan 重新确认）；
- 批量能力（batchCreate）摘要必须列出「将新增 / 已存在跳过 / 重复跳过」计数。

## 4. 能力清单（37 个）

### 4.1 项目（guide: project）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| projects.list | read | 无 → 已授权项目数组（含 companyName） |
| projects.create | write | {companyId,name,brandName?,productName?,region?,business?,sellingPoints?,keywords?,defaultPlatforms?} → 项目行；自动就绪双知识库 |
| projects.update | write | {projectId, …任意字段} → 更新后项目行 |

### 4.2 问题（guide: question / question-task）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| questions.list | read | {projectId, limit?≤100} → 问题数组 |
| questions.create | write | {projectId,text,category?,stage?,priority?,keywords?,intentDimension?} → {added} 或 {duplicate:true} |
| questions.batchCreate | write | {projectId, items:[…]} → {added, skipped, duplicate, errors} |
| questions.generate | write | {projectId, mode:"50"\|"40"} → 50 问（六组结构）或 40 问（探索30/评估5/行动5 + Markdown 表格） |
| questions.update | write | {questionId, priority?, status?, text?…} → 更新后行 |

50 问规则（文档二 1.2）：综合5/场景9/人群9/痛点9/功能9/决策9；每条含「哪家好/推荐/怎么选/排行」；严禁品牌名；10–25 字口语化。40 问规则（1.3）：探索30（严禁品牌名）/ 评估5（必须品牌名）/ 行动5（必须品牌名），输出表格列：编号/问题内容/分类/意图维度/核心关键词。

### 4.3 知识库（guide: knowledge）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| knowledge.list | read | {projectId, type:1\|2} → {kb, docs[]} |
| knowledge.uploadDoc | write | {projectId, type?, module?, title, content, evidence?, pending?, source?} → 文档行 |
| knowledge.organize | write | {projectId, type?, raw} → {docs[6], qaIndex, conflictList}；按 1.5 提示词整理，缺失模块自动「待补充」 |

### 4.4 文章（guide: article / article-task）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| articles.list | read | {projectId, limit?} → 数组 |
| articles.get | read | {articleId} → 文章行（校验项目授权） |
| articles.create | write | {questionId, type:1\|2\|3} → 文章行（status=1）+ 自动封面素材；type=1 答案卡三形态、2 品牌、3 产品 |
| articles.update | write | {articleId, title?, content?, status?} → 行 |
| articles.delete | write | {articleId} → {deleted}；已关联有效发布任务则 CONFLICT |
| articles.audit | write | {articleId} → 审核记录（gate1–3+verdict+issues+pendingFacts） |
| preflight.check | read | {projectId, questionId} → 5 项检查（已具备/待补充/不可使用/不适用） |

审核规则（确定性可解释）：gate1 品牌名/金额与知识库比对、无来源词；gate2 标题长度 8–40、广告法高危词（十大/第一/顶级/最佳/最强/全网最低/国家级认证）、结构层级、篇幅；gate3 开头段落与问题相关度、适用边界、证据/来源覆盖。任何一道不通过不得进入重点投放。

### 4.5 素材（guide: material）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| materials.list | read | {projectId, limit?} → 数组 |
| materials.upload | write | {projectId, name, type?, dataBase64?\|url?} → 素材行（含 /uploads/ URL） |

### 4.6 发布（guide: publication；v1.2 起默认 manual 真实流程）
> 发布模式（环境变量 `PUBLISH_MODE`）：`manual`（默认，确认后停留「发布中」，等待手动回填或 Webhook 回传）/
> `webhook`（配 `PUBLISH_WEBHOOK_URL` 后 confirm 即推送发布包，回包 `{ok,publishedUrl}` 自动落库）/
> `mock`（显式开启的演示自动结算）。AI 监测演示回退可用 `MONITOR_MOCK=0` 禁用。
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| accounts.list | read | {projectId} → 授权账号数组 |
| publishTasks.create | write | {projectId, articleId, platform, accountId} → 任务行 status=1 + 发布包；**校验文章已通过三道审核（verdict=2），否则 CONFLICT；校验账号已授权且额度>0、平台枚举 1–10** |
| publishTasks.markPublished | write | {taskId, publishedUrl} → 手动发布回填：status=3 + 真实 URL；URL 必须 http(s)；已有正式链接的任务拒绝覆盖；文章联动已正式发布 |
| publishTasks.confirm | write | {taskId} → 任务行 status=2；**扣减账号额度 1**；启动异步结算 |
| publishTasks.list | read | {projectId, limit?} → 数组 |
| publishTasks.get | read | {taskId} → 行（publishedUrl / failReason） |

发布包 7 字段（文档二 3.6）：平台 / 标题 / 正文 / 图片视频(文件、顺序、说明) / 账号(名称、类型) / 链接(证据+CTA) / 回填字段(发布状态、正式URL、发布时间、平台、账号、版本号)。

### 4.7 上榜监测（guide: scheduled-monitor / indexing-query）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| monitorTasks.create | write | {projectId, questionIds[], platforms[], mode, scheduleDays?, runNow?} → {task, checkpoints}；第 0 天立即执行 |
| monitorTasks.list | read | {projectId, limit?} → 数组 |
| monitorTasks.get | read | {taskId} → 任务 + checkpoints |
| monitorTasks.runNext | write | {taskId} → {checkpoint, resultIds}；无待执行检查点则 CONFLICT |
| monitorResults.list | read | {taskId} 或 {projectId, limit?} → 结果数组 |
| monitorResults.reverse | write | {projectId, question, platform?, times?=10} → {results[], report}（逆向分析报告） |
| reputation.create | write | {projectId, platforms?, mode?, scheduleDays?} → 自动生成 8 个口碑探测问题并创建监测任务（负面信号聚合见报告 type 6） |

### 4.8 信源资产（guide: sources）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| sources.list | read | {projectId, limit?} → 数组 |
| sources.collect | write | {projectId, taskId?} → {upserted}；从监测 citations 沉淀 |
| sources.upsert | write | {projectId, id?} 更新 / {projectId, articleTitle, url, …14字段} 新增 |

### 4.9 报告（guide: report）
| 能力 | mode | 输入 → 输出 |
|---|---|---|
| reports.create | write | type=1 品牌诊断 / 2 产品推荐诊断 / 3 优化前后对比（必传 taskIdA+taskIdB）/ 4 逆向分析（必传 question）/ 5 一页纸诊断 / 6 口碑监测摘要（负面信号词频+语境摘录）→ 报告行 |
| reports.list | read | {projectId, limit?} → 数组 |
| reports.get | read | {reportId} → 报告全文 |

### 4.10 元能力
| 端点 | 说明 |
|---|---|
| `POST /api/open/v1/call`（不带能力名） | 能力清单：[{name, mode, guide, description}] + version |
| `POST /api/open/v1/guide/list` | 12 份指南目录 |
| `POST /api/open/v1/guide/get/<name>` | 指南全文（CLI 按需读取一份，不要一次全读） |
| `POST /api/open/v1/auth/verify` | {key, deviceId} 设备绑定（登录流程专用，无需 Bearer） |
| `GET /healthz` | 存活探针 |

## 5. 分页与限额

列表默认 20 条、最大 100（`limit`）；超出上限按 100 截断。plan 30 分钟过期。发布任务 mock 结算约 4 秒（`GEO_MOCK_FAST=0` 时 20 秒）。
