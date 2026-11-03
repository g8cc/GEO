# 真实场景接入指南

> **✅ Rust 版真实化进度（v1.6.4）**：LLM 内容生成/50 问/知识库整理、四平台真实监测已接入（settings 表配置，失败回落模板/mock）。图像生成真实化仍未接入（回落内置 SVG 封面）。

> 回答一个问题：**系统里哪些是 mock、哪些能接真实、怎么接。**
> 结论先行：内容生成开箱即真（填 Key 即可）；AI 监测按平台混合接入（v1.1 已实现，填 Key 即真）；发布渠道走「手动发布回填」立即可用（v1.1 已实现，打通真实 exact_url_hit）；RPA 自动发布属于二期。

## 1. 真实度全景表

| 环节 | v1.0 状态 | v1.1 状态 | 接真实的前置条件 |
|---|---|---|---|
| 内容生成（文章/答案卡/50问/知识库整理） | mock | ✅ **已可真实**：配置任一 OpenAI 兼容 LLM 即切真 | 一个 API Key（GLM/DeepSeek/Qwen/Kimi/Moonship…） |
| AI 监测·通义千问 | mock | ✅ **已可真实**（DashScope `enable_search`，返回真实引用来源） | 阿里云百炼 Key |
| AI 监测·DeepSeek | mock | ✅ **已可真实**（官方 API；注意官方接口无联网引用 → 引用为空、命中最多弱命中） | DeepSeek Key |
| AI 监测·豆包 | mock | ✅ **已可真实**（火山方舟 Ark，联网需在方舟侧开通联网插件/bot） | 火山方舟 Key + 联网应用配置 |
| AI 监测·元宝 | mock | ✅ **已可真实**（腾讯混元 API web-search；语义等同"腾讯系"） | 腾讯云混元 Key |
| 发布渠道（头条/搜狐/网易/抖音/知乎/小红书） | mock | ✅ **手动回填模式已实现**（真实发布 → 回填真实 URL → 参与真实监测命中） | 无需 API；见 §3 流程 |
| 发布渠道（自动发文 API） | mock | ⏸ 二期：头条号开放平台 API、小红书专业号 API 可接；其余平台需 RPA（文档一的"客户端发布"即此形态） | 各平台企业认证 |
| 封面/配图 | SVG mock | ⏸ 可接图像生成 API（预留 provider 位） | 图像服务 Key |
| OSS 对象存储 | 本地 uploads | ⏸ 预留适配位 | 对象存储服务 |
| 知识库/问题/审核/信源/报告 | **本就真实**（纯平台逻辑） | 不变 | — |

**关键洞察**：监测的真实性不依赖发布渠道 API——用「手动发布回填」登记真实 URL 后，真实 AI 监测即可判定 exact_url_hit。这条链路（§3）**今天就能全部真实**。

## 2. AI 监测真实接入（按平台混合）

**混合模式**：为哪个平台配了 Key，哪个平台走真实；其余保持 mock。监测结果带 `real` 标记，真实调用失败会在结果中显式记录（不静默回落假数据）。

### 2.1 环境变量（都可选，配谁谁真实）

| 平台 | 变量 | 默认值 | 说明 |
|---|---|---|---|
| 豆包(1) | `MONITOR_ARK_KEY` / `MONITOR_ARK_BASE` / `MONITOR_ARK_MODEL` | 方舟 v3 端点 | 联网引用需在火山方舟控制台开通联网插件 |
| DeepSeek(2) | `MONITOR_DEEPSEEK_KEY` / `MONITOR_DEEPSEEK_BASE` / `MONITOR_DEEPSEEK_MODEL` | api.deepseek.com / deepseek-chat | 官方接口无联网检索：引用为空属正常 |
| 元宝(3) | `MONITOR_HUNYUAN_KEY` / `MONITOR_HUNYUAN_BASE` / `MONITOR_HUNYUAN_MODEL` | 混元 v1 端点 | 建议配 `hunyuan-websearch` 系模型；引用开关默认开 |
| 通义(4) | `MONITOR_DASHSCOPE_KEY` / `MONITOR_DASHSCOPE_BASE` / `MONITOR_DASHSCOPE_MODEL` | 百炼兼容模式 / 默认模型 | 自动带 `enable_search=true`，返回 `search_result` |

### 2.2 真实模式的语义差异（评审注意）

1. **品牌是否出现/推荐级别**：基于真实回答的保守启发式（出现=原文含品牌名；"优先推荐"需命中强推荐措辞），报告中会标注"启发式判定"；**描述准确性**字段置空，由人对照知识库判断。
2. **引用来源**：来自平台真实联网检索返回（已适配 DashScope search_result / 混元 search_info / OpenAI annotations / 通用 citations 字段）；非 http 链接过滤、URL 去重。
3. **exact_url_hit**：引用 URL 与项目内「已正式发布的链接」（mock 或手动回填的真实链接）精确匹配。**真实 AI 不会引用 mock 域名**——要走真实命中闭环，必须用 §3 的真实发布/回填。
4. **调用失败**：结果行显示 `[真实监测调用失败] 原因`、状态=待复测、页面可访问=0——可观测，不污染假数据。

### 2.3 成本预估（按当前价目自行核对）

单次监测 ≈ 1 次联网问答调用；50 题 × 4 平台 × 每日 1 轮 ≈ 200 次调用/天。联网搜索的 token 消耗约为普通调用的 2–5 倍。建议先小规模（10 题 × 2 平台）试跑一周估算。

## 3. 发布真实化：手动回填闭环（v1.1 已实现）

渠道无公开 API 时（知乎、搜狐、网易、小红书图文等），这是今天就能跑通的真实链路：

```
① 平台生成发布包（七字段确认清单）
② 人工到渠道后台按发布包发布（或交给运营同学）
③ 「内容发布」页 → 手动发布回填 → 选任务 + 粘贴真实正式 URL
④ 文章状态 → 已正式发布；真实监测中该 URL 参与 exact_url_hit 判定
```

- API：`publishTasks.markPublished`（write，两步制）；重复回填/非 http(s) URL 会被拒绝。
- 已有正式链接的任务不可覆盖（防误操作），需人工确认流程。
- 与 mock 自动发布并存：mock 结算只处理"发布中"任务，不会覆盖回填数据。

## 4. 真实 LLM 内容生成（v1.0 已实现）

```bash
export LLM_BASE_URL=https://api.deepseek.com        # 或任意 OpenAI 兼容端点
export LLM_API_KEY=sk-…
export LLM_MODEL=deepseek-chat
```

提示词严格使用方法论原文（`providers/llm.js PROMPTS`）；生成结果仍必须过三道审核（平台强制）。真实模式下知识库文本会进入提示词——不影响安全边界（见 SECURITY §7.4）。

## 5. 二期路线（按价值排序）

| 优先级 | 事项 | 说明 |
|---|---|---|
| P1 | 头条号开放平台 API 自动发文 | 有官方接口，企业认证后可接；发布状态/链接回调替代 mock 结算 |
| P1 | 监测任务调度器（3/7/14 天自动触发真实调用） | 当前到期检查点在页面访问时执行；生产可加 cron 定时 |
| P2 | 小红书专业号 / 抖音开放能力 | 各自开放平台，图文笔记 API |
| P2 | RPA 客户端（文档一"客户端发布"形态） | 覆盖无 API 渠道；工程量大 |
| P3 | 图像生成封面、OSS、企业微信/飞书通知 | 按需 |

## 6. 验收清单（接真实后跑一遍）

- [ ] 配置通义 Key → 创建监测任务 → 结果含真实 search_result 引用、`real` 标记
- [ ] 未配 Key 的平台 → 结果仍为 mock（混合模式）
- [ ] 手动回填真实 URL → 文章状态已正式发布 → 监测引用含该 URL 时 exact_url_hit=1
- [ ] 断网/错 Key → 结果行显式失败原因，无假数据
- [ ] `node scripts/test-suite.mjs` §6 全绿（回填/引用提取/分流）
