# 更新日志

本项目的所有重要变更记录在此文件。格式参考 Keep a Changelog。

## [1.6.5] - 2026-11-04

### Added
- **封面图像真实化（二期真实化收官）**：`image.rs` 双 Provider——OpenAI 兼容 images/generations（b64_json 或 url 下载）与阿里云万相同步提交+异步轮询（3s×20 次上限，对齐 Node providers/image.js）；产物落本地 uploads，meta 记录 coverSource/imageGenerated；未配置或失败显式回落内置 SVG（coverSource=svg-fallback:<原因>），不产生"已生成"假象
- **「系统设置 → 服务集成」补齐图像配置项**：IMAGE_PROVIDER / IMAGE_BASE_URL / IMAGE_MODEL / IMAGE_API_KEY
- **封面生成锁纪律**：create_content_full 三阶段——锁内读配置与组提示词 → 锁外 LLM 正文 + 图像生成 → 锁内入库（图像生成 30s+60s 轮询绝不持 DB 锁）
- **测试 +3**（37 项总计）：OpenAI b64 落盘校验、万相三段交互（提交→轮询→下载）、失败回落链

## [1.6.4] - 2026-11-04

### Added
- **真实 LLM 生成（二期真实化第一段）**：OpenAI 兼容客户端（ureq，settings 表优先/环境变量回落）；内容创作三类文章、50 问生成、知识库整理在配置 `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL` 后走真实调用（方法论提示词原文移植），失败显式回落模板并记录——语义对齐 Node 版 providers/llm.js
- **真实 AI 监测（四平台）**：豆包（火山方舟）/DeepSeek/元宝（混元）/通义（百炼）均为 OpenAI 兼容端点，配置对应 `MONITOR_*_KEY` 即走真实联网问答；引用来源多形态提取（annotations / DashScope search_result / 混元 search_info / 通用兜底），我方判定=URL 与已发布正式链接精确匹配，品牌表现保守启发式——对齐 Node runMonitorReal；未配置平台回落确定性 mock（dataSource 区分 real-llm/mock）
- **锁纪律重构**：run_checkpoint 拆两阶段（网调在锁外），修复"真实监测长调用持 DB 锁阻塞全站"的隐患；create_monitor_task/reputation/content/questions50/organize 均拆 locked（闭包内模板）+ full（公开两阶段）变体
- **测试 +10**：mock OpenAI 服务器真实调用、文章 JSON 解析与兜底、引用多形态提取与去重、我方精确匹配命中分级、create_content 全流程真实→回落、推理模型 reasoning 兜底（合计 34 项单元/集成测试）

### Fixed
- **Node 版潜在 bug**：providers/llm.js 的 `parseQuestionLines` 未定义——配置真实 LLM 后 50 问路径会 ReferenceError（真实路径从未跑通过）；Rust 版实现宽容解析器（序号/维度/口语行）
- **测试竞态**：notify/llm mock 服务器早关连接致偶发 RST——改为 Content-Length 感知完整读取

## [1.6.3] - 2026-11-03

### Added
- **事件通知真实推送**：`monitor.done` / `publish.done` 经 org Webhook 推送（10s 超时、事件过滤、后台线程不阻塞请求）；本地 TCP 监听器真实 HTTP 链路测试 4 项
- **viewer 只读守卫**：axum 中间件单点拦截只读成员的全部 POST（仅放行登出），对齐 Node 版角色守卫；注册语义对齐（不再自动建组织，否则 viewer 永不触发）——全量测试新增 T5 角色守卫 4 项
- **SESSION_SECURE=1**：会话 Cookie Secure 标记（HTTPS 部署）
- **质量门自动化**：`make verify` 单命令五道防线（clippy -D warnings / 单测 / 全量 93 项 / HTML 标签平衡审计 27 页 / 渲染级截图 14 页）；pre-commit 钩子与 GitHub Actions CI（浮动 stable，已全绿）
- **结构性出口收口**：`pub_page`/`user_page` 统一页面壳、`redirect_q` 统一跳转编码，杜绝缺壳与双重编码类事故

### Fixed
- **登录锁定失效**（Rust 版锁 0 秒）→ 15 分钟 + 剩余分钟数提示
- **登录失败提示双重编码**（Node/Rust 四处）→ redirect_q 收口
- **Node 版注册页 error 双重渲染**（历史遗留）
- **ops 脚本五连修**（全新安装实测发现）：geo.env 配置发现机制、bash 3.2 多字节变量名吞噬（全量花括号化）、本地模式 GEO_DB_PATH 丢失、set -e 下 kill 失败中断安装、geo.pid 写入安装器自身 PID（改为 lsof 反查监听进程）

## [1.6.2] - 2026-11-01

### Added
- **Rust 版 Web UI 完整重构（23 页）**：布局引擎（侧边栏 + 项目选择器 + 项目导航 + 新手引导）、mock 确定性引擎（50/40 问、知识库整理、三类内容、三道审核规则引擎、监测模拟、六类报告、一键 GEO 全链路），88 项全量测试本地与生产零失败
- **运维封装**：`ops/geo-ctl.sh`（启停/健康检查/在线备份恢复/日志）、`ops/install.sh` 一键安装与升级、`Makefile`（build/run/test/deploy）、每日备份与巡检脚本切换至 Rust 版现实
- **登录/注册页视觉升级（Node 与 Rust 双版本同源）**：分屏品牌版式（左侧产品介绍 + 右侧表单卡）、密码可见切换、错误横幅、失败倒计时提示；CSS 以 `style.css` 单一来源同步两版

### Fixed
- **Rust 版登录锁定失效**：锁定截止时间误设为「当前时刻」（等于没锁），改为与 Node 版一致的 15 分钟，并显示剩余分钟数
- **登录失败提示双重编码**：跳转 URL 出现 `?error=error=...`，页面横幅带前缀（Node/Rust 四处统一修复）
- **Node 版注册页 error 双重渲染**（历史遗留）
- **ops/monitor.sh 对已停用旧服务误报告警、ops/backup.sh 依赖 Node**：均已切换至 Rust 版（geo-rust / python3 sqlite3 备份）

## [1.5.1] - 2026-10-31

### Fixed
- **已登录用户打开裸域名 `/` 直接 404**（用户实际报告的缺陷）：路由表从未定义根路径处理，已登录会话命中 404 页。修复为 302 → /dashboard（未登录仍跳 /login）。回归测试补齐该入口断言——此前自动化测试始终直达 /dashboard，恰恰漏掉了最基本的入口路径（教训：测试矩阵必须包含用户真实的第一步）

## [1.5.0] - 2026-10-31

**终局交付**：商业化最后一批代码可完成项全部落地。

### Added
- **订阅与卡密收款闭环**：内置套餐（体验/基础/专业）、管理员卡密生成（系统配置 → 卡密管理）、组织所有者兑换开通（无需在线支付接口，线下收款 + 卡密交付即可商用）；套餐联动监测配额与成员上限
- **报告白标导出**：打印友好 HTML（客户品牌 + 打印/PDF 按钮，无平台品牌）+ Markdown 下载
- **事件通知**：组织级 Webhook（monitor.done / publish.done 推送到企微机器人或自建系统，10s 超时保护）
- **移动端适配**：≤900px 侧边栏折叠、表格横滚、任务面板换行
- **Postgres 迁移包**：`scripts/postgres/schema.sql`（完整 DDL + 索引）+ `export-data.js`（SQLite → PG 数据导出），切换指南见 HANDOVER §5

### Fixed
- 修复组织迁移未覆盖 seed 路径导致的新库项目页 404（seed 直挂组织 + 启动幂等 backfill）
- 修复 reports/create 路由缺 await 导致的 /reports/undefined 跳转
- 修复 getProjectSafe 参数顺序（组织模型重构引入）

## [1.4.0] - 2026-10-31

**P1 组织化改造**：从「单人账号」升级为「团队协作」结构。

### Added
- **组织/成员/角色**：orgs + orgMembers（owner/管理者/操作员/只读四级角色），公司挂接组织；「团队成员」页支持邀请（须已注册）、改角色、移除、月度配额设置
- **角色鉴权（Web + Open API 双层）**：只读成员全站写操作 403；系统配置/审计日志仅团队所有者与平台管理员
- **用量计量**：monitor/llm/image 调用按组织按日计数；监测月度配额（0=不限），超限创建显式 CONFLICT 提示
- **定时调度器**：每 60 秒自动执行全站到期复测点（3/7/14 天复测不再依赖页面访问）
- 访问模型迁移：全部项目可见性从 ownerUserId 切换为组织成员关系（含历史数据自动迁移）

### Fixed
- 组织迁移覆盖 seed 路径（新库演示公司直接挂组织 + 启动时幂等 backfill），修复新库项目页 404

## [1.3.0] - 2026-10-31

**P0 商用合规包**（见 docs/AUDIT.md 与 DELIVERY-CHECKLIST）。

### Added
- **账号安全收口**：密码策略（≥8 位含字母数字）、连续 5 次失败锁定 15 分钟、初始/临时密码强制改密、操作审计日志（全部登录与写操作留痕 90 天，管理员可查看，Open API 写操作同样入审计）
- **用户协议 + 隐私政策**公开页（模板版，标注需法务审阅），注册强制勾选
- **AIGC 合规**：内容创作默认携带 AI 生成声明（可关闭），发布包包含声明字段与渠道粘贴文案（对应《人工智能生成合成内容标识办法》）
- **服务器运维包**（ops/）：每日自动备份（VACUUM INTO 快照 + uploads 归档，保留 14 天，审计日志 90 天自动清理）、监控告警脚本（healthz/磁盘/服务/备份新鲜度 → 企微机器人或 Server酱）、Nginx+HTTPS 配置模板（域名备案后一键启用）
- 密码修改页（主动/强制两用）

### Security
- 登录失败锁定防爆破；审计日志脱敏（password/token/secret/key 字段 ***）
- 注册接口强制协议勾选与密码策略

## [1.2.0] - 2026-10-31

**Mock 全量真实化改造 + 聚光灯引导 + 交付华为云。** 所有默认 mock 路径均具备真实实现，演示回退全部改为显式可选并可在结果中区分；v1.2 审计轮修复 6 项（见 docs/AUDIT.md）。

### Added
- **封面/配图真实生成**（`providers/image.js`）：OpenAI 兼容 images 与 DashScope 万相（异步任务轮询），产物落对象存储；失败显式回落 SVG（meta.coverSource 记录原因）
- **S3 兼容对象存储**（`providers/storage.js`）：零依赖手写 AWS SigV4，支持华为 OBS / 阿里 OSS / MinIO；素材与封面上对象存储，未配置回落本地
- **发布真实流程**（默认 manual）：确认后无假结算；新增 **Webhook 发布适配器**（推送发布包到自建 RPA/客户端，回包 publishedUrl 自动落库，15s 超时 + 64KB 回包上限）；mock 自动结算仅显式 `PUBLISH_MODE=mock`
- **口碑监测真实功能**：一键生成 8 个口碑探测问题（`reputation.create` 能力）× 真实监测 Provider；口碑摘要报告（type 6：负面信号词频 + 语境摘录 + 引用来源）；Web 功能页替换占位
- **文章生成真实 LLM 路径**：修复隐蔽 mock 残留——`articles.create` 此前未接 LLM；现走方法论原文提示词 + JSON 解析，meta 标注 source
- **监测严格模式** `MONITOR_MOCK=0`：未配置真实通道的平台显式报错，生产不给演示假数据
- **认证接口限流**：login/register/auth/verify 30 次/分钟/IP（`TRUST_PROXY=1` 适配反代），关闭旧审计已知边界

### Changed
- 报告类型新增 6（口碑监测摘要）；Open API 能力 38 → 39；版本号全线 1.2.0
- 聚光灯式新手引导（见 1.1b）在部署版同步生效

### Security（v1.2 审计轮）
- 限流 X-Forwarded-For 伪造绕过修复；图像 API 全链路超时；webhook 回包大小上限

## [1.0.0] - 2026-10-31

首个完整实现版本。依据两份方法论文档完成计划 → Spec → 开发 → 测试 → 验收 → 项目文档全流程（6 个里程碑，见 `docs/ACCEPTANCE.md`）。

### Added
- **GEO 平台**（`platform/`）：Node 24 原生 HTTP 服务 + `node:sqlite`，零 npm 依赖
  - Web 18+ 页面：十步工作台、公司/项目、知识库（六模块+QA索引+口径冲突清单）、问题拓展（50 问/40 问）、内容创作（三类资产+封面）、文章管理（三道审核）、资源中心、授权账号、内容发布（发布包 7 字段确认流）、上榜监测（0+3/7/14 天检查点）、收录站点、信源资产（四状态 14 字段）、五类报告、系统设置 Open Key
  - Open API 37 个能力（16 read / 21 write），plan→apply 两步写，统一包络与 Label 机制（歧义字段按行类型转换）
  - Mock Provider 层：LLM 双模式（mock / OpenAI 兼容真实接口）、AI 监测种子语料检索（发布后可复现 exact_url_hit）、发布渠道异步模拟（失败注入）、SVG 封面
- **geo CLI**（`cli/`）：version --check / capabilities / guide / auth login（本机设备绑定，密钥不经对话）/ call / plan / apply
- **GEO Skills**（`skills/`）：17 个技能（Agent Skills 格式），提示词严格按《GEO 平台与 Skills 操作手册》与《学员可复制提示词与实战模板》原文；references 收录全部方法论模板（1.2/1.3/1.4/1.5/3.1–3.8/4.1–4.3/5.1–5.9/6.1–6.2/7.1–7.5）
- **install.js**：预演/执行两段式安装器（备份旧版 geo-*，多目标目录）
- **测试与验收**：`scripts/e2e.mjs`（44 项端到端）+ `scripts/test-suite.mjs`（31 项契约/安全/边界/故障注入），验收报告 `docs/ACCEPTANCE.md`
- **Spec 文档**（`docs/spec/00–06`）：总览/数据模型/Open API/Web/CLI 与 Skills/Mock/测试与验收标准

### Added（v1.2b：系统配置 UI）
- **管理员「系统配置」页**：全部真实化配置（LLM/监测四平台/图像/S3/发布/安全/演示开关）集中到 UI——保存即生效（无需重启）、密钥脱敏显示（留空保持不变）、**连通测试按钮**（LLM/豆包/DeepSeek/元宝/通义/对象存储）
- 配置存 SQLite settings 表（schema 白名单，杜绝任意环境变量注入）；DB 配置覆盖环境变量，空值回落部署默认
- 测试：套件新增 §8（管理员门禁/URL 校验/脱敏/env 立即生效/白名单外丢弃），回归 44+84=128 项全绿

### Added（v1.1b：聚光灯式交互引导）
- **聚光灯引导引擎**（零依赖自研，tour.js）：屏幕遮罩 + 目标元素聚光灯（呼吸动画）+ 指向气泡（自动左右翻转定位）+ 上一步/下一步/去操作 + 进度点 + 键盘导航（←/→/Esc）
- **引导步骤按用户数据状态动态生成**（13 个站点）：已完成的步骤自动标 ✓，未完成的给操作指引；无项目用户显示精简 5 步流程
- 首次访问自动播放；全站右下角悬浮「🎬 新手引导」按钮随时重播；欢迎弹窗主按钮改为「开始交互式引导」
- 部署至华为云（120.46.133.88，systemd + 随机化演示密码）

### Added（v1.1：真实场景接入 + 新手引导）
- **AI 监测真实 Provider**（按平台混合模式）：豆包（火山方舟）/ DeepSeek / 元宝（腾讯混元 web-search）/ 通义千问（DashScope enable_search）——配 Key 即真实联网问答；引用来源自动适配四种返回形态（search_result/search_info/annotations/通用）；真实调用失败可观测，不回落假数据
- **手动发布回填** `publishTasks.markPublished`（API + Web 表单）：渠道无公开 API 时人工发布后回填真实 URL，打通「真实发布 → 真实监测 exact_url_hit」闭环；文章状态机联动
- **新手引导系统**：全局「当前建议下一步」智能横幅（按数据状态 13 步自动推进，可跳过）；首次登录欢迎引导浮层（四步认知 + 双玩法说明）；六个关键页面空状态引导 CTA
- 生产化环境变量：`DISABLE_REGISTER` / `SESSION_SECURE` / `SEED_DEMO`
- 文档：`docs/REAL-INTEGRATION.md` 真实场景接入指南

### Added（商业化交付文档包与生产化开关）
- 文档：产品介绍、部署手册（systemd/Nginx/HTTPS/备份恢复/升级/生产检查单）、运维手册（巡检+7 类 Runbook）、安全说明（威胁模型/加固清单）、使用手册、API 参考、交接文档、FAQ、交付验收单、文档总索引
- LICENSE（专有软件默认条款，正式商用前由法务替换）
- 生产化环境开关：`DISABLE_REGISTER=1`（关闭自助注册）、`SESSION_SECURE=1`（会话 Cookie Secure）、`SEED_DEMO=0`（跳过演示数据）

### Security（两轮审计修复，见 docs/AUDIT.md）
- 集中所有权守卫：所有以资源 ID 定位的 Web 路由统一校验项目归属（修复跨租户写越权）
- plan/apply 原子占用（修复并发双 apply 双写竞态，执行失败自动回滚占用）
- 素材上传扩展名白名单 + 10MB 上限（修复任意文件写入）
- safeUrl() 收口全部用户可控 URL 出口（修复 javascript: 伪协议与属性注入 XSS）
- 上传 SVG 强制下载 + nosniff/Referrer-Policy 安全头；500 页不再泄露堆栈
- 密码比较改 timing-safe；Open Key lastUsedAt 60 秒节流（写放大治理）
- 边界钳制：分页 [1,100]、批量导入 ≤500、单次监测 ≤50 题、逆向分析 ≤30 次、发布平台枚举 1-10
- 正确性：跨项目问题/问题归属校验、文章状态仅前进不回退、BizError → 400 友好页
- 性能/稳定性：补 12 个索引、过期会话启动清理、发布结算定时器异常隔离

### Fixed（验收过程发现）
- 服务层发布未校验三道审核（API 可绕过 Web 校验）→ createPublishTask 增加 verdict 校验
- 发布账号额度未校验未扣减 → create 校验 + confirm 扣减
- mock 50 问部分条目缺少文档 1.2 要求的引导词（哪家好/推荐/怎么选/排行）→ 题库重写
- 跨表歧义字段（status/platform）Label 不分类型 → withRowLabels(kind, row)
- openapi apply 分支 planId 误当能力名；matchAll 正则缺 g；createReport 参数 TDZ 遮蔽

### 已知边界
- 第三方（AI 监测/发布渠道/OSS）为 Mock，切换点见 Spec 05；付费媒体与口碑监测为占位页
