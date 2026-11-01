# GEO 平台验收报告

> 验收日期：2026-10-31 ｜ 验收依据：`docs/spec/06-测试与验收标准.md`
> 结论：**验收通过** —— E2E 44/44 + 扩展套件 31/31，全绿，无遗留红项。

## 1. 验收环境

| 项 | 值 |
|---|---|
| Node.js | v24.18.0（内置 node:sqlite） |
| 测试实例 | 独立端口 3439（E2E）/ 3440（套件主实例）/ 3441（故障注入实例），临时数据库 |
| 被测版本 | v1.0.0（M3 修正后） |
| 运行命令 | `node scripts/e2e.mjs`、`node scripts/test-suite.mjs`（均 exit 0） |

## 2. 端到端验收（E2E，44/44 通过）

| 组 | 验收点 | 结果 |
|---|---|---|
| 准入 | Web 登录（demo@geo.local）；种子项目就绪；Open Key 创建只显示一次 | ✅ 3/3 |
| API 基线 | capabilities 37 能力；无效密钥 AUTH_REQUIRED；未授权项目拒绝；projects.list Label 对；questions.list | ✅ 5/5 |
| 两步写 | write 直调被拦（WRITE_REQUIRES_PLAN）；plan→apply 成功；重复问题去重（已存在跳过） | ✅ 3/3 |
| 方法论 | 50 问生成 50 条入库；标准 40 问（探索30/评估5/行动5）+ 三阶段分布；知识库六模块整理（QA 索引 6 条） | ✅ 4/4 |
| 内容 | 创作前输入检查 5 项；品牌文章（已上传+封面）；AI 答案卡三形态；产品文章五段结构 | ✅ 4/4 |
| 审核 | 三道审核执行（一致性/媒体标准/GEO），总体结论合法 | ✅ 1/1 |
| 发布 | 创建（已创建）→人工确认（发布中）→异步完成 publishedUrl=`https://mock.toutiao.com/article/…`→文章联动已正式发布 | ✅ 4/4 |
| 监测 | 任务创建（0+3/7/14 四检查点）；结果含回答全文+引用；**exact_url_hit=1**；runNext 复测点执行 | ✅ 4/4 |
| 信源 | 沉淀 upserted>0；文档二 4.1 的 14 字段完整 | ✅ 2/2 |
| 报告 | 品牌诊断（病根）/一页纸诊断（开场首问+推进建议）/优化前后对比/逆向分析（同题×10+关键词频次）/产品推荐诊断（竞品占位） | ✅ 5/5 |
| CLI | version / capabilities / guide get / call / plan（planId+摘要）/ apply / 重复 apply 被拒（PLAN_USED） | ✅ 7/7 |
| Web | 18 页面全部 200；文章详情页；监测结果页 | ✅ 3/3 |

关键证据摘录：

```
✅ 异步发布完成 + publishedUrl —— https://mock.toutiao.com/article/a84a9f6b22594afc
✅ exact_url_hit：我方正式链接被 AI 引用 —— 豆包:精准命中 / 元宝:精准命中
✅ 50 问生成并入库（≥45 条新增） —— 新增 50，重复 0
✅ CLI: 重复 apply 被拒（PLAN_USED）
```

## 3. 扩展套件（31/31 通过）

| 分层 | 验收点 | 结果 |
|---|---|---|
| §1 单元级 | 审核规则 4 项（合规全过/广告法词 gate2=0/品牌缺失 gate1=0/缺边界 gate3 降级）；50 问结构 5+9×5=50、无品牌名、**每条含引导词（核心规则1）**；40 问 30/5/5、品牌名规则、五列表格 | ✅ 10/10 |
| §2 API 契约 | 37 能力；read16/write21；write 直调拦截；Label kind 契约（article=已正式发布 / monitorResult=豆包 / publishTask=今日头条）；分页上限 100；guide 12 份 | ✅ 8/8 |
| §3 安全 | 无效密钥；设备不匹配 DEVICE_MISMATCH；跨租户 404；跨租户工作台无数据；未授权项目拒绝 | ✅ 5/5 |
| §4 状态机 | 过期 plan→PLAN_EXPIRED；重复 apply→PLAN_USED；确认发布额度-1（20→19）；未过审创建发布→CONFLICT；删除保护→CONFLICT；空材料整理全部「待补充」 | ✅ 6/6 |
| §4b 故障注入 | FAIL_RATE=1：任务→失败+failReason；文章不联动（保持已创建发布任务） | ✅ 2/2 |

## 4. 验收过程中发现并修复的问题

| # | 问题 | 来源 | 修复 |
|---|---|---|---|
| 1 | 服务层发布未校验三道审核（仅 Web 层校验，API 可绕过） | M3 Spec 对照 | `createPublishTask` 增加 verdict=2 校验 → CONFLICT |
| 2 | 发布账号额度未校验、未扣减（文档要求检查额度） | M3 Spec 对照 | create 校验 authStatus/quota；confirm 扣减 1 |
| 3 | **mock 50 问多条缺少「哪家好/推荐/怎么选/排行」引导词，违反文档二 1.2 核心规则 1** | M4 测试套件 | 重写题库 27 条，套件断言全量含引导词 |
| 4 | 跨表歧义字段 status/platform 的 Label 转换不区分行类型 | 早前 E2E | `withRowLabels(kind, row)` 按行类型转换 |
| 5 | openapi apply 分支把 planId 当能力名查找 | 早前 E2E | 分支重排，apply 优先按 planId 处理 |
| 6 | `matchAll` 正则缺 `g` 标志导致监测崩溃 | E2E | 补 `g` 标志 |
| 7 | createReport 参数 `platform` 被 const 遮蔽（TDZ） | E2E | 重命名为 plat |

## 5. 遗留与说明（非验收项）

1. 真实第三方对接（AI 监测/发布渠道/OSS/真实 LLM）为 v1 Mock，切换点见 Spec 05 与 README。
2. 付费媒体、口碑监测为占位页（文档「按需自助开通」）。
3. 文档引用的 `geo.bihuogeo.com` / `chenshuke/geo-skills` 地址，学员安装提示词中需替换为自己的平台与仓库地址。

## 6. 验收签字

- 测试：`scripts/e2e.mjs`（exit 0）+ `scripts/test-suite.mjs`（exit 0），日志见运行输出。
- 覆盖：功能闭环、方法论提示词、API 契约、安全边界、状态机、故障注入、CLI、Web 巡检。
- **验收结论：通过。**
