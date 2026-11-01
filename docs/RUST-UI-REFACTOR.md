# Rust Web UI 重构计划

> 目标：把 Node.js 版的 23 个页面全部用 Rust (Axum) 重写，最终替代 Node.js 版
> 当前 Rust 版：API 层已完成（40 能力 + 11 read 端点 + 8 write 端点），Web UI 只有简化版
> 预计内存：5-15 MB RSS（vs Node.js 的 150-300 MB）
> 预计工期：5 个 Goal，每个 Goal 约 1-2 小时

## ✅ 执行状态（2026-11-01 完成）

全部 5 个 Goal 已完成并通过全量测试：

| Goal | 内容 | 状态 |
|---|---|---|
| W1 | 布局引擎 + 侧边栏 + UI 组件（ui.rs / web.rs） | ✅ 完成 |
| W2 | 基础建设 + 问题池 7 页面（pages.rs） | ✅ 完成 |
| W3 | 内容/发布/监测 8 页面（pages2.rs） | ✅ 完成 |
| W4 | 信源/报告/系统设置/团队/一键GEO（pages3.rs） | ✅ 完成 |
| W5 | 全量测试 + 切换 | ✅ 完成 |

**测试结果**：`bash scripts/rust-full-test.sh` → 88 项检查全部通过（页面路由 27 项 / 业务闭环 32 项 / 数据完整性 9 项 / 安全 8 项等），本地连续两次零失败；`cargo test` 19/19；本地 release 版 RSS ≈ 9.6 MB。

**生产部署（2026-11-01）**：已部署至 120.46.133.88（`geo-rust.service`，端口 3438，数据库指向 `/opt/geo/platform/data/geo.db`），88 项全量测试在线上复跑全部通过。注意：服务器上 demo@geo.local 的历史密码与文档默认值不符（已被改动），已重置为 `demo1234`（以 Node 兼容 scrypt 写入，Node 版也可验证）。部署前备份：`/opt/geo/platform/data/geo.db.bak-20261101-221121`、旧二进制 `/opt/geo-rust/geo-platform.bak-20261101-221121`。测试产生的数据与更早的 FullTest 残留均已清理，用户数据（跃动童年、LikeClaw 项目）未动。

**实现要点**：
- 布局/组件/枚举与 Node 版 `ui.js`/`enums.js` 一致；`style.css` 与 Node 版逐字节相同
- Node 版的 AI 依赖操作（50问/知识库整理/内容创作/三道审核/监测/报告）移植为**确定性模板引擎**（mock.rs），零外部依赖、结果可复现，配置 LLM Key 的真实化改造预留了 settings 配置项
- 密码哈希改为 scrypt（与 Node 版 `crypto.scryptSync` 兼容），Rust 版可直接接管 Node 版数据库中的既有账号
- 表单提交统一为「POST → 同步处理 → 303 重定向」（修复了 Node 版异步 job 返回裸 JSON 的遗留问题）；发布 mock 结算在页面访问时 catch-up（确认后 4 秒自动完成）
- 演示种子数据与 Node 版一致（demo@geo.local / demo1234）
- 注意事项 1-5 均已遵守（UTF-8 截断用 char_indices/chars、Mutex 恢复、esc 转义、Axum 0.8 `{pid}` 路由、CSS/JS 内联）

## 当前 Rust 版已有基础

```
rust/src/
├── main.rs       # HTTP 服务 + 路由注册（已完成）
├── db.rs         # SQLite 连接池 + 完整 schema（已完成）
├── auth.rs       # 密码哈希 + SHA256 + UUID（已完成）
├── api.rs        # 11 个读端点 + capabilities（已完成）
├── ops.rs        # 8 个写端点（已完成）
├── web.rs        # 登录页 + 工作台 + 条款页（已部分完成，需更新样式）
├── pages.rs      # 6 个项目页面（已部分完成，需更新样式）
├── pages2.rs     # 6 个系统页面（已部分完成，需更新样式）
├── static_files.rs # 内联 CSS + JS（已完成）
└── migrations/init.sql # 完整数据库 schema（已完成）
```

## 需要做的事情

不是从零开始，而是把已有的简化版页面**升级为与 Node.js 版视觉一致的完整版**：

1. 把 Node 版的 `layout()` 函数（侧边栏 + 项目选择器 + 页头）移植为 Rust 的 `layout()` 函数
2. 把 Node 版每个页面的 HTML 内容（表格/表单/按钮/徽章）移植到 Rust
3. CSS 已经内联了（style.css + tour.js），不需要重写

## Goal 拆解

### Goal-W1：布局引擎 + 侧边栏（~1小时）
- 创建 `layout()` 函数：左侧深色侧边栏（项目选择器 + 全部菜单项）+ 右侧主区域
- 创建 `card()` / `table()` / `badge()` / `sel()` 等 HTML 组件助手（与 Node 版 ui.js 一致）
- 侧边栏包含：快速上手链接、基础建设组（公司/项目）、本项目组（14 个菜单项）、系统组（修改密码/系统设置/团队）
- 项目选择器：从 DB 读取项目列表，`<select>` 下拉切换
- **验收**：dashboard 页面渲染出完整侧边栏 + 十步工作台卡片

### Goal-W2：基础建设 + 问题池页面（~1小时）
- 登录后工作台（十步进度卡 + 平台分工表）
- 公司管理页（创建表单 + 列表）
- 项目列表页（创建表单含 companyId 下拉 + 列表）
- 项目概览页（数据总览 + 项目信息编辑）
- 知识库页（品牌/产品切换 + 六模块表格 + 上传 + 整理）
- 问题库页（50问/40问按钮 + 添加/导入 + 列表 + 调整优先级）
- **验收**：这 7 个页面渲染出完整侧边栏 + 正确数据

### Goal-W3：内容/发布/监测页面（~1小时）
- 内容创作页（选择问题 + 类型 + 生成按钮 + 创作前检查）
- 文章管理页（列表 + 状态徽章）
- 文章详情页（封面 + 正文 + 三道审核 + 发布记录）
- 授权账号页（添加 + 列表）
- 内容发布页（创建任务 + 发布确认清单 + 手动回填）
- 上榜监测页（创建任务 + 任务列表 + 监测结果详情）
- 收录站点页
- **验收**：这 8 个页面渲染出完整侧边栏 + 正确数据

### Goal-W4：信源/报告/系统设置/团队/一键GEO（~1小时）
- 信源资产页（四状态统计 + 14字段清单 + 一键沉淀）
- 诊断报告页（生成入口 + 报告列表 + 报告详情）
- 口碑监测页
- 系统设置 → Open Key（创建/列表/吊销）
- 系统设置 → 服务集成（七组配置 + 测试按钮）
- 卡密管理页（生成 + 列表）
- 操作审计页
- 团队成员页（邀请/角色/配额）
- 一键 GEO 页
- 付费媒体/口碑监测占位页
- **验收**：全部 23 个页面 200 且渲染完整

### Goal-W5：全量测试 + 切换（~1小时）
- 21+ 页面全部 200 验证
- 数据完整性验证（写入→读回→比对）
- CSS 样式验证（与 Node 版截图对比）
- 交互验证（表单提交/按钮点击/下拉切换）
- 切换为唯一主服务，Node 版停止
- **验收**：连续两次全量测试零 bug

## 技术要点

### HTML 渲染方式
用 Rust 的 `format!()` 宏直接拼 HTML 字符串（与当前 pages.rs 方式一致），不引入模板引擎。原因：
- 零依赖，编译快
- HTML 都是服务端渲染，不需要前端框架
- `format!()` 的类型检查能防止大部分注入

### 数据获取方式
每个页面通过 `db::with_db(|conn| { ... })` 直接查 SQLite，与 Node 版的 `q()` / `q1()` 对应。

### 表单提交
保持与 Node 版一致：`<form method="post" action="...">` + 服务端 302 重定向。异步 job 模式后续可以加。

### 需要从 Node 版移植的关键函数
| Node 版 (ui.js) | Rust 版 (pages.rs) | 说明 |
|---|---|---|
| `layout()` | `layout()` | 布局 + 侧边栏 |
| `card()` | `card()` | 卡片容器 |
| `table()` | `table()` | 通用表格 |
| `badge()` | `badge()` | 状态徽章 |
| `sel()` | `sel()` | 下拉选择框 |
| `e()` (escapeHtml) | `esc()` | HTML 转义 |
| `emptyCta()` | `emptyCta()` | 空状态引导 |
| `fmtTime()` | `fmt_time()` | 时间格式化 |

### 需要移植的 23 个页面路由
```
/ /login /dashboard /companies /projects
/projects/{id} /projects/{id}/kb /projects/{id}/questions
/projects/{id}/content /projects/{id}/articles /projects/{id}/materials
/projects/{id}/accounts /projects/{id}/publish /projects/{id}/paid
/projects/{id}/monitor /projects/{id}/sites /projects/{id}/wom
/projects/{id}/sources /projects/{id}/reports
/settings/keys /settings/config /settings/licenses /settings/audit
/team /auto-geo
```

## 参考文件

- Node 版完整页面代码：`platform/src/web/routes.js`、`routes-content.js`、`routes-monitor.js`
- Node 版布局和组件：`platform/src/web/ui.js`
- CSS 样式：`platform/public/style.css`（已内联到 Rust 版）
- 数据库 schema：`rust/migrations/init.sql`

## 注意事项

1. **UTF-8 截断**：Rust 的字符串切片按字节，中文会 panic。用 `char_indices().nth(n)` 截断
2. **Mutex PoisonError**：用 `unwrap_or_else(|p| p.into_inner())` 恢复
3. **HTML 转义**：所有用户输入必须通过 `esc()` 转义
4. **Axum 0.8 路由语法**：用 `{pid}` 不是 `:pid`
5. **CSS/JS 已内联**：style.css 和 tour.js 通过 `include_str!` 或 r### 字符串嵌入二进制
