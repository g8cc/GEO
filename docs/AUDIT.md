# GEO 平台审计报告

> 审计日期：2026-10-31 ｜ 方式：两轮独立审计（R1 逐文件人工审计 + R2 工具扫描/对抗测试复验）
> 范围：`platform/`（server、src、providers、web）、`cli/`、`skills/`、`install.js`
> 结论：**发现 17 个问题，全部修复，87/87 回归全绿，交付。**

## 0. 审计方法

| 轮次 | 手段 |
|---|---|
| R1 | 按五个维度（安全/正确性/边界/性能/稳定性）逐文件审读全部源码；对每个发现先复现、再修复、再回归 |
| R2 | 工具扫描（SQL 拼接、未转义输出、文件写入点、密钥落盘）+ 对抗性回归测试（跨租户写入、并发双 apply、恶意扩展名、负数分页）+ 修复项逐一回归 |

## 1. 发现与修复清单

### 安全（P0）

| # | 等级 | 问题 | 修复 | 回归 |
|---|---|---|---|---|
| S1 | P0 | **跨租户写越权**：知识库上传/更新、问题增改、内容创建、文章审核、发布确认/重试、信源、报告等 POST 路由只校验登录未校验项目归属，任何登录用户可直接对他人项目写数据 | `server.js` 增加**集中所有权守卫**：凡 `/projects/:id/*`、`/articles/:id/*`、`/publish/:id/*`、`/monitor/:id/*`、`/reports/:id/*` 一律先解析资源归属，不属于当前用户 → 404（不泄露存在性） | §5 守卫三连 |
| S2 | P0 | **任意文件写入**：`materials.upload` 扩展名取自用户文件名（`a.svg/../../../evil.html` 可逃逸 uploads 目录） | 扩展名白名单（png/jpg/jpeg/gif/webp/svg/mp4/webm/mp3/pdf）+ 字符清洗 + 10MB 体积上限 | §5 上传两连 |
| S3 | P0 | **URL 型 XSS**：`materials.url`、`sources.url`、citations 等用户可控 URL 直接进 `href`/`src` 属性（`javascript:` 伪协议、引号逃逸） | 新增 `safeUrl()`（仅 http/https/站内相对路径 + 属性级转义），应用到全部 9 处 URL 出口；剩余 2 处为内部硬编码路由 | §5 safeUrl 四连 |
| S4 | P0 | **plan/apply 并发竞态**：先 SELECT 再 UPDATE 非原子，并发双 apply 会双写数据 | 原子占用：`UPDATE plans SET usedAt WHERE usedAt IS NULL AND expiresAt > now`，`changes===0` 才判 USED/EXPIRED；执行失败回滚占用允许重试 | §5 并发双 apply 恰好成功一次 + 无双写 |
| S5 | P1 | **500 页泄露堆栈与内部路径** | 改通用错误页 + log_id，细节仅入服务端日志 | 全量回归 |
| S6 | P1 | **上传 SVG 可内嵌脚本**：用户可上传 SVG，直接访问时 `<script>` 会执行 | `/uploads/*.svg` 响应 `Content-Disposition: attachment` + 全局 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin` | 全量回归 |
| S7 | P2 | 密码比较非常量时间 | `crypto.timingSafeEqual` | 全量回归 |

### 正确性与边界（P1）

| # | 问题 | 修复 | 回归 |
|---|---|---|---|
| B1 | **负数 limit**：`LIMIT -5` 在 SQLite 等于不限制，可拉全表 | `pageLimit()` 钳制 [1,100]，9 处列表统一 | §5 limit=-5 → 1 条 |
| B2 | `preflight` 不校验问题归属项目（跨项目数据混用） | question.projectId 校验 | 全量回归 |
| B3 | `monitorTasks.create` 只校验第一个问题，后续问题可来自其他项目；问题数/平台枚举不设限 | 全量归属校验 + 上限 50 题 + 平台枚举 1–5 | 全量回归 |
| B4 | 逆向分析次数无上限（可一次拉 10⁴ 次模拟） | 钳制 [1,30] | 全量回归 |
| B5 | 批量导入无上限 | 单批 ≤500 | 全量回归 |
| B6 | **状态回退**：重发已发布文章时 `confirm` 把文章状态 3→2 | `AND status<2` 仅前进 | 全量回归 |
| B7 | 发布平台枚举未校验（任意整数可建任务） | 1–10 校验 → VALIDATION_ERROR | §5 平台枚举 |
| B8 | Web 层业务校验错误（BizError）落到 500 页 | 捕获 BizError → 400 友好页 + 消息 | 全量回归 |

### 性能与稳定性（P2）

| # | 问题 | 修复 |
|---|---|---|
| F1 | 13 个热查询列无索引（publishTasks.articleId、monitorResults.projectId、kbDocuments.kbId 等） | 补齐 12 个索引 |
| F2 | sessions 表过期行只在被访问时删除，长期运行无限增长 | 启动 + 登录时清理过期会话 |
| F3 | Open Key `lastUsedAt` 每次调用写库（读接口写放大） | 60 秒节流 |
| F4 | 发布结算定时器内 DB 异常会击穿进程 | settle 包裹 try/catch |
| F5 | （评估项）node:sqlite 同步 API 阻塞事件循环——当前规模（演示/单机）无影响，已用 WAL + 索引；规模上升时切 better-sqlite3 连接池或 Postgres，接口不变 | 记录为已知边界 |

### R2 扫描复核（确认无问题项）

| 检查项 | 结论 |
|---|---|
| SQL 注入 | ✅ 无。全部参数化；仅有的 `${}` 拼接为白名单列名（update 字段集）与占位符构造 |
| XSS | ✅ 修复后无。全部用户文本经 `e()` 转义；URL 经 `safeUrl()`；剩余 href 为内部路由 |
| 文件写入 | ✅ 仅 2 处，均在 uploads 内，扩展名白名单 |
| 密钥落盘 | ✅ Open Key 仅存 sha256；密码 scrypt+salt；明文只在创建响应出现一次 |
| CSRF | ✅ SameSite=Lax Cookie 阻断跨站 POST；Open API 走 Bearer 头不受 CSRF 影响 |
| 命令注入 | ✅ CLI 无 exec/eval/spawn 到 shell |
| 路径穿越 | ✅ 静态服务 `path.basename` 收口；上传扩展名白名单 |

## 2. 回归结果

```
E2E 端到端：      44 通过 / 0 失败（exit 0）
扩展套件：        43 通过 / 0 失败（exit 0，含新增 §5 审计回归 12 项）
合计：            87/87 全绿
```

新增 §5 审计回归（12 项）：跨租户 POST 404 + 数据未写入、负数分页钳制、恶意扩展名回落 .bin 且无逃逸文件、safeUrl 四断言（javascript:/https/相对路径/协议相对）、**并发双 apply 原子性**（恰好成功一次 + 单条写入）、发布平台枚举校验。

## 3. 交付边界说明（知悉项，非缺陷）

1. `node:sqlite` 同步 API 为单机演示规模设计（见 F5），生产大流量需换连接池方案。
2. `auth/verify` 无速率限制——密钥空间 48 位十六进制，暴力枚举不可行，公网部署建议加 IP 限流。
3. Cookie 未加 `Secure`（本机 HTTP 演示）；公网部署（HTTPS）时在会话 Cookie 上补 Secure。
4. 真实 LLM 模式下知识库文本会进入提示词（注入只影响生成内容，不溢出到命令执行）；默认关闭。
5. Mock 监测/发布为演示语义，非真实平台行为。


---

# v1.2 真实化改造审计轮（2026-10-31）

> 范围：Goal-A~E 新增代码（image.js / storage.js / 发布三模式 / 口碑监测 / reputation.create / 引导引擎 / 限流）。
> 方法：同两轮制（逐文件审读 + 对抗回归）。发现 **6 个问题，全部修复**；回归 **44+77=121 → 134 项全绿**（含新增 §7 真实化回归 14 项）。

## 发现与修复

| # | 等级 | 问题 | 修复 |
|---|---|---|---|
| 1 | 高 | **限流可绕过**：直连场景攻击者伪造 X-Forwarded-For 即可获得独立限流桶 | 默认只信任 socket 地址；`TRUST_PROXY=1`（反代后）才信任代理头；部署手册与检查单同步 |
| 2 | 高 | **隐蔽 mock 残留**：`articles.create`（三类内容生成）从未接真实 LLM 分支，配了 Key 也走模板 | 新增 `createArticleWithLlm`：方法论原文提示词 + JSON 输出解析（失败降级整文采用）；meta 记录 `source=llm/template/llm-failed-template` |
| 3 | 中 | **图像 API 无超时**：提交/轮询/下载任一挂起将拖死内容创作 | 全部 fetch 加 AbortController（30s/10s） |
| 4 | 中 | **webhook 回包无界**：恶意/异常回包可注入超大 body | 64KB 上限 + JSON 解析容错（失败保持「发布中」等待手动回填） |
| 5 | 中 | **监测演示回退不可关闭**：生产环境未配 Key 的平台会静默给演示假数据 | `MONITOR_MOCK=0` 严格模式：未配置平台显式失败（`[真实监测未配置]`），绝不给假数据 |
| 6 | 低 | 新代码 TDZ 变量声明（createContent genMeta） | 开发期 node --check + 回归捕获，已修复 |

## 复核确认项（无需修改）

- SigV4：payload 哈希进签名、Secret 不落日志；签名确定性有单元断言；与真实 S3 服务端的兼容性建议用户配 OBS/MinIO 后做一次联调（本机假 S3 已验证客户端 HTTP 路径）。
- webhook URL / 图像 / S3 / LLM 端点全部来自环境变量（运维控制），无请求参数注入面。
- 口碑负面词表为固定安全字符串，无 ReDoS 面；报告正文全部经转义渲染。
- 聚光灯引导步骤由服务端常量构建，无用户输入注入。
- `reputation.create` / `markPublished` 走统一两步制 + 项目授权 + 所有权守卫。

## 回归

```
E2E：44/44 ｜ 扩展套件：77/77（含 §7 真实化回归 14 项：存储/图像/发布 manual/口碑/限流）
合计 121 → 新增用例后 134 次断言全绿
```
