# 安全说明

> 读者：安全评审 / 运维 / 集成方。配合 `docs/AUDIT.md`（两轮审计全记录）与 `DEPLOYMENT.md §7`（生产检查单）阅读。

## 1. 认证与身份

| 面 | 机制 |
|---|---|
| Web 登录 | 邮箱 + 密码；密码 scrypt（N=16384 默认，32 字节）+ per-user salt；比较使用 `timingSafeEqual` |
| 会话 | 服务端会话表 + HttpOnly Cookie（14 天）；`SameSite=Lax`（阻断跨站 POST 的 CSRF 面）；`SESSION_SECURE=1` 时加 Secure；登录时清理过期会话 |
| 自助注册 | `DISABLE_REGISTER=1` 关闭（生产默认建议），账号由管理员发放 |
| Open API 密钥 | `gk-` 前缀 48 位十六进制；库中仅存 SHA-256；明文只在创建响应返回一次；可随时吊销（立即失效） |
| 设备绑定 | 密钥首次 `auth/verify` 绑定设备 ID；异机使用返回 `DEVICE_MISMATCH`（防密钥扩散） |
| 密钥录入 | CLI `auth login` 起本机 loopback 录入页，密钥只写 `~/.geo/config.json`(0600)，**不经对话、不经服务端日志** |

## 2. 授权模型

- **组织与角色（v1.4）**：org → member（owner/管理者/操作员/只读）→ company → project；项目可见性与操作权限按组织成员关系判定。只读成员全站写操作 403；系统配置/审计仅所有者与管理员。Open API 写能力同样按密钥所属用户的组织角色校验。

- **租户隔离**：资源树 `user → company → project`，项目下一切资源随项目归属。
- **Web 层**：集中所有权守卫（`server.js ownershipGuard`）——凡按资源 ID 定位的路径（/projects、/articles、/publish、/monitor、/reports）统一校验归属，不属于当前用户一律 404（不泄露存在性）。回归：§5「跨租户 POST → 404 + 数据未写入」。
- **Open API 层**：密钥 × 项目授权（`authorizedProjectIds`），越权请求拒绝并引导到密钥管理；`projectId` 缺失时报错引导 `projects.list`，不猜测。
- **写操作闸门**：所有写能力必须 plan（变更摘要）→ 明确确认 → apply（一次性，30 分钟）；删除类在摘要中必须声明连带影响；文章未过三道审核不可发布（服务层强制，非仅前端）。

## 3. 输入与注入防护

| 面 | 措施 |
|---|---|
| SQL 注入 | 全部参数化查询；动态部分仅为白名单列名集合；无字符串拼接用户值 |
| XSS | 服务端渲染统一 HTML 转义（`e()`）；用户可控 URL 经 `safeUrl()`（仅 http/https/站内相对路径，属性级转义，`javascript:`/协议相对路径一律置空） |
| 文件上传 | 扩展名白名单 + 字符清洗（防路径穿越逃逸 uploads）；≤10MB；SVG 从 /uploads 直开强制 `Content-Disposition: attachment` |
| 路径穿越 | 静态服务 `path.basename` 收口 |
| 请求体 | 20MB 上限；JSON/表单解析失败静默降级为空对象 |
| 分页 | `limit` 钳制 [1,100]（SQLite 负 LIMIT = 不限制，已防护） |
| 批量滥用 | 单批导入 ≤500 题；单次监测 ≤50 题；逆向分析 ≤30 次 |
| 广告法/合规词 | 内容审核 gate2 内置高危词检测（十大/第一/顶级…），命中即不通过 |

## 4. 传输与响应头

- 生产强制 HTTPS（Nginx 终结），`SESSION_SECURE=1`。
- 全局响应头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`。
- 500 页不泄露堆栈与内部路径（仅 log_id + 服务端日志）。

## 5. 数据保护

- Open Key 明文只在创建时出现一次；日志、报告、对话均不得复述（写入各 Skills 行为约束）。
- 密码不可逆（scrypt）；会话随机 UUID。
- 敏感操作审计现状：auditRecords（内容审核）、plans（写操作摘要与执行记录）留痕；登录日志在 systemd/应用日志。
- 备份含全部业务数据，需按企业数据分级策略保管（见 DEPLOYMENT §5）。

## 6. 威胁模型（概要）

| 威胁 | 现状 | 剩余风险/建议 |
|---|---|---|
| 账号撞库/爆破 | 无速率限制（本机演示定位） | 生产按 DEPLOYMENT §7 加 Nginx 限流（login/register/auth/verify） |
| 密钥泄露（学员侧） | 本机 0600 文件 + 设备绑定；吊销即时生效 | 培训强调不进聊天/仓库；泄露即吊销重建 |
| 恶意管理员 | 平台内等同数据全权 | 管理员账号最小化 + 操作留痕（plans/auditRecords） |
| AI 生成内容失实 | 三道审核 + 知识库待补机制 + 「不编造」写进 Skills 约束 | 人工审核不可跳过（发布前置校验） |
| 供应链 | 零 npm 运行时依赖，无第三方包 | 升级 Node 走官方源 |
| SSRF（真实 LLM 模式） | LLM_BASE_URL 仅环境变量可配（运维控制），不接受请求参数 | 保持环境变量方式 |

## 6.1 v1.3 商用加固（已实现）

- **密码策略**：≥8 位且同时包含字母与数字；注册与改密强制执行
- **登录锁定**：连续 5 次失败锁定 15 分钟（按账号）
- **强制改密**：初始/临时密码账号登录后强制进入改密页
- **操作审计日志**：全部登录与写操作留痕（90 天，每日任务自动清理），管理员在「操作审计日志」页查看；Open API 写操作（apply）同样入审计
- **限流**：login/register/auth/verify 30 次/分钟/IP（TRUST_PROXY=1 时按真实 IP）
- **协议与隐私**：注册强制勾选《用户协议》《隐私政策》（模板版，需法务审阅）
- **AIGC 标识**：发布包默认携带 AI 生成声明（可按篇关闭，关闭时提示自行确认渠道合规）

## 7. 已知边界（如实声明）

1. `auth/verify` 与登录无内置速率限制——公网部署必须在 Nginx 层限流（见 DEPLOYMENT §7）。
2. 同步 SQLite 单机架构：并发写吞吐受限于单进程（见 AUDIT F5），大规模需按 HANDOVER §5 迁移。
3. HTTP 直连演示模式 Cookie 无 Secure；HTTPS 部署务必 `SESSION_SECURE=1`。
4. 真实 LLM 模式下知识库文本进入提示词：注入只影响生成内容（内容仍需过三道审核），不构成命令执行面；默认 mock 关闭。
