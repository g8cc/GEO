# GEO 平台规格说明书 05 · Provider 体系规范（v1.2：真实优先，回退显式）

> 实现文件：`platform/src/providers/`（llm.js / monitor.js / publish.js / image.js / storage.js）。
> v1.2 设计原则：**真实优先、回退显式**——所有默认曾为 mock 的能力均已具备真实实现；
> 演示回退仅作为显式行为存在（llm 未配置 / monitor 未配置且 MONITOR_MOCK≠0 / PUBLISH_MODE=mock），
> 且全部可在结果与 meta 中区分（source/meta.coverSource/结果行内标注），严格模式可整体禁用。

## 1. LLM Provider（双模式）

| 模式 | 触发 | 行为 |
|---|---|---|
| mock（默认） | 未配置 LLM 环境变量 | 按知识库事实拼装结构化内容：结论先行 + 判断标准 + 证据（标注来源模块）+ 适用边界 + 行动入口；确定性输出可审核 |
| real | `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | OpenAI 兼容 `/chat/completions`；提示词严格使用文档二原文（1.2/1.3/1.5/3.2/3.3/3.4 等） |

生成能力清单：
- `generateQuestions50(project)`：六组结构 50 问（综合5/场景9/人群9/痛点9/功能9/决策9）。
- `simplifyTo40(questions, brand)`：探索30（无品牌名）/评估5（口碑2+竞品2+人群1）/行动5（价格1+预约联系2+门店2）+ Markdown 表格。
- `organizeKnowledge(brand, raw)`：行级关键词归类到六模块；金额口径冲突检测→冲突清单；缺失模块「待补充」；QA 索引（答案回溯六模块）。
- `createAnswerCard`：三形态（文章版/图片版文案 4 页/视频口播 ~45s）。
- `createBrandArticle`：3.8 答案型正文模板五段 + 证据清单表 + 待审核事实。
- `createProductArticle`：适合谁/为什么推荐/如何比较/不适合谁/如何行动五段。
- `preflightCheck`：5 项检查（已具备/待补充/不可使用/不适用）。
- `auditArticle`：三道关确定性规则引擎——
  - gate1 知识库一致性：品牌名在场校验、金额与知识库集合比对、无来源词（据传/听说/据称）；
  - gate2 媒体投稿标准：标题 8–40 字、广告法高危词（十大/第一/顶级/最佳/最强/全网最低/国家级认证）、结构层级≥3、正文≥500 字；
  - gate3 GEO：开头段落与问题 bigram 相关度 ≥0.12、适用边界词在场、知识库引用/链接覆盖；
  - verdict = min(gate1..3)；每关输出问题定位（issues）。
- 报告生成：brandDiagnosis / productDiagnosis / compare（前后对比表）/ reverseAnalysis（关键词频次 Top15 + 稳定性判断 + 单一优化动作）/ 一页纸诊断（7.1 六段结构）。

## 2. AI 监测 Provider（mock，种子语料检索）

`runMonitor({project, question, platform, runSeed})` 流程：

1. **我方语料**：项目内 status=3 已发布文章（含 publishedUrl 域名），`score = jaccard(问题, 标题+正文) × 平台域名权重 × (1+抖动±4%)`。
2. **竞品语料**：固定竞品种子（跳跳鲨少儿体感、乐翻高儿童运动馆，各 2 篇第三方来源）+ 从知识库 04 模块解析竞品名单过滤；`score = 强度 × 平台声量系数 × (1+抖动)`。
3. **品牌基础认知**：含品牌名的问题给 base 分（知识库文档 ≥3 篇时 0.55，否则 0.35）。
4. **判定**：
   - brandMentioned = brandScore ≥ 0.22；
   - recommendLevel：≥0.62 优先推荐 / ≥0.42 明确推荐 / ≥0.22 提及；竞品分 > 我方 1.6 倍且问题不带品牌名时降一档（制造「为什么没推荐我」诊断场景）；
   - citations = 我方 Top3（own=true）+ 竞品来源（score>0.3）+ 通用第三方（35% 概率）；exactUrlHit = citations 含我方 URL；
   - hitStatus：exactUrlHit && mentioned && recommendLevel≥2 → 精准命中；mentioned && !exactUrlHit → 弱命中；!mentioned → 未命中；其余 → 待复测；
   - brandAccurate：知识库越全越准确（20% 概率失准制造「描述不准确」场景）。
5. **AI 回答合成**：中文回答全文（含推荐名单、选择标准、参考来源列表、免责句）。
6. **关键词频次**：问题 bigram ×2 + 回答 bigram ×1（逆向分析用；`_question` 字段保存原文）。

**确定性**：同 (project, question, platform, runSeed, 语料状态) → 同结果；发布新文章改变语料 → 结果改变（复测提升的原理）。`runSeed` 变化模拟同题重复 10 次的波动。

**平台偏好（观察假设，文档六(四)）**：

| 平台 | 域名权重加成 | 竞品声量系数 |
|---|---|---|
| 豆包(1) | toutiao 1.6 / douyin 1.5 | 1.15 |
| DeepSeek(2) | gov 1.6 / news 1.5 / industry 1.4 / b2b 1.3 | 1.10 |
| 元宝(3) | mp.weixin 1.7 / news.qq 1.5 / penguin 1.4 | 0.95 |
| 通义(4) | smzdm 1.6 / ownsute 1.4 / sohu 1.2 / 163 1.2 | 1.00 |

## 3. 发布 Provider（mock，异步模拟）

| 参数 | 默认 | 说明 |
|---|---|---|
| GEO_MOCK_FAST | 1 | 结算延迟 4 秒；=0 时 20 秒 |
| GEO_MOCK_FAIL_RATE | 0 | 失败注入率（演练「发布失败→故障排查」） |

状态机：已创建(1) → [confirm] → 发布中(2) → [定时结算] → 已发布(3, publishedUrl=`https://mock.<域名>/article/<id>`) 或 失败(4, failReason)。
**服务重启追赶**：启动时扫描 status=2 且超时的任务直接结算（不丢失）。结算成功联动文章→已正式发布。
域名映射：1 mock.toutiao.com / 2 mock.sohu.com / 3 mock.163.com / 4 mock.douyin.com / 5 mock.zhihu.com / 6 mock.xiaohongshu.com / 7 mock.mp.weixin.qq.com / 8 mock.smzdm.com / 9 mock.ownsite.cn。

## 4. 存储

- 本地 `platform/data/uploads/`，静态服务 `/uploads/*`；`materials.upload` 支持 dataBase64（自动扩展名）或 url 直通。
- 封面配图：SVG 渐变卡（标题+「GEO 内容资产·封面配图（mock 生成）」水印），按标题哈希取色。
- 预留 S3/OSS 适配位（同名接口替换即可）。
