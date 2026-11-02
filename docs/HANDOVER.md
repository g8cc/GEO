# 项目交接文档

> **⚠️ 架构定位（v1.6.3）**：主实现已切换为 `rust/`（Axum 单二进制，23 页 Web UI + Open API）。
> 本文的代码地图与设计决策描述的是 **Node 参考实现（platform/）**，其中「所有权集中守卫 / Label 成对返回 /
> 写操作两步制 / 密钥只显示一次」等设计原则在 Rust 版同样成立（分别由 require_project/require_admin、
> ui.rs label、Open API plan 端点、openKeys 哈希存储承担）。运维命令见 `docs/OPERATIONS.md`（geo-ctl），
> 部署见 `docs/DEPLOYMENT.md`（ops/install.sh）。

> 读者：接手开发/维护的工程师。目标：30 分钟建立全貌，半天能改第一个功能。

## 1. 仓库地图

```
GEO/
├── platform/                 # GEO 平台（零 npm 依赖，Node ≥22.5）
│   ├── server.js             # 入口：HTTP 服务、静态资源、路由分发、所有权守卫、安全头
│   └── src/
│       ├── db.js             # node:sqlite + DDL(幂等) + 种子 + purgeExpiredSessions
│       ├── enums.js          # 全部枚举 + withLabels/withRowLabels（Label 机制核心）
│       ├── util.js           # 转义/safeUrl/safeUploadExt/确定性随机/tokenize 等
│       ├── auth.js           # Web 会话 + Open Key 认证（authOpenKey）
│       ├── settings.js       # 系统配置中心：CONFIG_SCHEMA 白名单 + settings 表 + 应用到 process.env（UI 保存即生效）
│       ├── services.js       # ★ 业务动作层（Web 与 Open API 共用）：项目/知识库/问题/内容/审核/发布/监测/信源/报告
│       ├── openapi.js        # ★ 能力注册表（39 个）+ call/plan/apply 路由 + 原子占用（写能力按组织角色校验）
│       ├── guides.js         # CLI guide 文本（12 份）
│       ├── providers/        # Mock/真实切换层
│       │   ├── llm.js        #   内容生成双模式（mock / OpenAI 兼容）+ 三道审核规则引擎 + 报告生成
│       │   ├── monitor.js    #   AI 监测：mock（种子语料）+ 真实（Ark/DeepSeek/混元/DashScope，按平台混合）
│       │   ├── publish.js    #   发布 mock（显式 PUBLISH_MODE=mock）：异步结算 + 故障注入 + SVG 封面
│       │   ├── image.js      #   封面真实生成（OpenAI 兼容 / DashScope 万相），失败显式回落 SVG
│       │   └── storage.js     #   S3 兼容对象存储（手写 SigV4），未配置回落本地 uploads
│       └── web/              # 服务端渲染 UI
│           ├── ui.js         #   layout/badge/table/safeUrl 组件
│           ├── routes.js     #   认证/工作台/公司/项目/知识库/问题
│           ├── routes-content.js  # 内容/文章/素材/账号/发布
│           └── routes-monitor.js  # 监测/站点/信源/报告/OpenKey
├── cli/geo.js                # geo CLI（零依赖）：version/capabilities/guide/auth/call/plan/apply
├── skills/                   # 17 个 geo-* 技能（SKILL.md + references 方法论原文）
├── install.js                # Skills 安装器（预演/--apply，备份旧版）
├── scripts/
│   ├── e2e.mjs               # 端到端 44 项（独立实例 + 端口 3439）
│   └── test-suite.mjs        # 43 项（单元/契约/安全/状态机/审计回归，端口 3440/3441）
├── docs/                     # 全部交付文档（见 docs/README.md 索引）
└── PLAN.md / README.md / CHANGELOG.md / LICENSE
```

## 2. 必须先懂的五个设计决策

1. **零依赖**：运行时只用 Node 内置模块（node:sqlite / node:http / node:crypto）。换 Postgres 或加框架是显式决策，不是顺手的事。
2. **写操作两步制**：能力分 read/write；write 走 plan（摘要，30 分钟）→ apply（原子占用，一次性）。业务校验放在 `services.js`（服务层），Web 路由不得作为唯一防线（审计 S1 的教训）。
3. **Label 机制**：库里存数值、展示用 Label；`status`/`platform` 是跨表歧义字段，必须经 `withRowLabels(kind, row)` 按行类型转换——新增含 status/platform 的表时必须注册 ROW_KIND_MAPS。
4. **所有权守卫在 server.js 集中做**：新增 `/xxx/:id` 形态的路由时，在 `ownershipGuard` 里补对应分支，否则跨租户防护有洞。
5. **业务闭环靠 mock 语料**：`monitor.js` 用「已发布文章」建检索语料——发布新文章 → 监测结果改变 → exact_url_hit 出现。替换真实监测源时保持这个语义（结果可随我方内容变化），否则七步教学闭环失去演示力。

## 3. 常见修改怎么做

| 需求 | 步骤 |
|---|---|
| 新增 Open API 能力 | `openapi.js` CAPABILITIES 注册 {kind, mode, guide, summary(变更摘要), exec}；write 需要服务层动作 + 校验；在 `guides.js` 挂 guide；补 spec 02 表；test-suite §2 加契约项 |
| 新增 Web 页面 | `web/routes-*.js` 加路由（注意所有权守卫分支）；`ui.js` 若有新 URL 出口一律 safeUrl；页面巡检 e2e §16 加一行 |
| 切真实 LLM | 不改代码：配置 `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`（OpenAI 兼容）；提示词在 `llm.js PROMPTS`（文档原文） |
| 切真实 AI 监测 | **已实现**：`runMonitorReal`（四平台混合）+ `MONITOR_MOCK=0` 严格模式；引用提取 `extractCitations` 适配四种返回形态 |
| 切真实发布渠道 | 自动发文：实现 `providers/publish.js` 同语义；**无 API 渠道用 `publishTasks.markPublished` 手动回填（已实现）** |
| 换 Postgres | 替换 `db.js`（接口 q/q1/run/insert），DDL 改方言；services/openapi 无需感知。组织模型已就绪，触发条件：>20 活跃客户或多实例部署 |
| 计费/支付 | 需商户资质（外部）；用量计量已就绪（usageCounters 表），套餐层待商务决策 |
| 换图像/存储供应商 | `image.js`（openai/dashscope 两形态）/ `storage.js`（S3 兼容 SigV4）：都是 env 驱动，无需改业务层 |
| 发布接官方 API | `services.fireWebhookPublish` 旁加同签名适配器；或直接用 Webhook 对接你的 RPA 客户端 |
| 改审核规则 | `llm.js auditArticle`（确定性规则引擎）；规则变更需同步 spec 02 §4.4 与 test-suite §1 |

## 4. 测试与质量门槛

```bash
node scripts/e2e.mjs        # 44 项：任何提交前必跑
node scripts/test-suite.mjs # 43 项：涉及 API/安全/状态机改动必跑
```

- 测试用独立端口与临时库，可随时跑；新增能力/页面必须补对应断言（e2e 或 suite）。
- 审计回归在 suite §5（跨租户/上传/原子 apply/分页钳制/safeUrl）——**动 auth、openapi、services、providers 前先看这些用例**。

## 5. 已知限制与技术债（按优先级）

| 级别 | 事项 | 建议 |
|---|---|---|
| 中 | node:sqlite 同步 API 阻塞事件循环；单进程写吞吐有限 | 并发商用时迁移 Postgres（db.js 接口已收敛） |
| 中 | auth/verify 与登录无限流 | 接 Nginx 限流或加内存令牌桶 |
| 低 | 付费媒体、口碑监测为占位页 | 按需求设计后替换 routes 占位 |
| 低 | Web 层为服务端渲染 + 少量内联交互，无前端框架 | 复杂交互需求出现时再引入构建链 |
| 低 | docs/spec 与代码人工同步 | 大改后跑一遍能力导出脚本核对（见 M2 做法） |
| 提示 | 会话 Cookie Secure 由 `SESSION_SECURE=1` 控制 | HTTPS 部署必开（DEPLOYMENT §7） |

## 6. 关键文档索引

需求与流程：`PLAN.md` → Spec：`docs/spec/00–06` → 验收：`docs/ACCEPTANCE.md` → 审计：`docs/AUDIT.md` → 提示词规范：`docs/skills-and-prompts.md` → 交付：`docs/DEPLOYMENT.md` / `OPERATIONS.md` / `SECURITY.md` / `USER-GUIDE.md` / `API-REFERENCE.md` / `FAQ.md` / `DELIVERY-CHECKLIST.md`。
