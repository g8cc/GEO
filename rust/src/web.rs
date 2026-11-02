#![allow(clippy::result_large_err)]
// 会话 + 布局引擎 + 认证页面（对应 Node 版 auth.js / ui.js / routes.js 认证部分）
use axum::extract::Request;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};

use crate::auth;
use crate::db;
use crate::ui::{badge, card, empty, esc};

// ============ 表单体解析（支持多选 name=val 对） ============
#[derive(Debug, Default)]
pub struct Fb(pub Vec<(String, String)>);

impl axum::extract::FromRequest<()> for Fb {
    type Rejection = (StatusCode, String);
    async fn from_request(req: Request, _state: &()) -> Result<Self, Self::Rejection> {
        let bytes = axum::body::to_bytes(req.into_body(), 4_000_000)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        let pairs = serde_urlencoded::from_bytes::<Vec<(String, String)>>(&bytes).unwrap_or_default();
        Ok(Fb(pairs))
    }
}

impl Fb {
    pub fn get(&self, k: &str) -> String {
        self.0.iter().find(|(key, _)| key == k).map(|(_, v)| v.trim().to_string()).unwrap_or_default()
    }
    pub fn all(&self, k: &str) -> Vec<String> {
        self.0.iter().filter(|(key, _)| key == k).map(|(_, v)| v.trim().to_string()).filter(|v| !v.is_empty()).collect()
    }
    pub fn i(&self, k: &str) -> i64 {
        self.get(k).parse::<i64>().unwrap_or(0)
    }
    pub fn opt_i(&self, k: &str) -> Option<i64> {
        self.get(k).parse::<i64>().ok()
    }
}

// ============ 会话 ============
#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub role: String,
    pub must_change: i32,
}

pub fn cookie_sid(headers: &HeaderMap) -> String {
    let raw = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("");
    for part in raw.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("geo_session=") {
            return rest.to_string();
        }
    }
    String::new()
}

pub fn current_user(headers: &HeaderMap) -> Option<User> {
    let sid = cookie_sid(headers);
    if sid.is_empty() {
        return None;
    }
    db::with_db(|c| {
        c.query_row(
            "SELECT u.id, u.email, u.role, u.mustChangePassword FROM sessions s JOIN users u ON s.userId=u.id WHERE s.id=? AND s.expiresAt>?",
            rusqlite::params![sid, auth::now_iso()],
            |r| {
                Ok(User {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    role: r.get(2)?,
                    must_change: r.get(3)?,
                })
            },
        )
        .ok()
    })
}

pub fn new_session_cookie(user_id: &str) -> String {
    let sid = auth::gen_uuid();
    let expires = auth::add_days_iso(14);
    db::with_db(|c| {
        c.execute(
            "INSERT INTO sessions (id, userId, expiresAt, createdAt) VALUES (?,?,?,?)",
            rusqlite::params![sid, user_id, expires, auth::now_iso()],
        )
        .ok();
    });
    let secure = if std::env::var("SESSION_SECURE").as_deref() == Ok("1") { "; Secure" } else { "" };
    format!("geo_session={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}{}", sid, 14 * 86400, secure)
}

pub fn logout_resp(sid: &str) -> Response {
    db::with_db(|c| c.execute("DELETE FROM sessions WHERE id=?", [sid]).ok());
    redirect_cookie("/login", "geo_session=; HttpOnly; Path=/; Max-Age=0")
}

pub fn redirect(loc: &str) -> Response {
    Redirect::to(loc).into_response()
}

/// 带查询参数的跳转 —— 唯一合法出口：参数统一 UTF-8 编码，
/// 杜绝手拼 query 串导致的裸中文/双重编码类 bug（v1.6.2 事故类）。
pub fn redirect_q(path: &str, params: &[(&str, &str)]) -> Response {
    if params.is_empty() {
        return redirect(path);
    }
    let pairs: Vec<String> = params
        .iter()
        .map(|(k, v)| serde_urlencoded::to_string([(k.to_string(), v.to_string())]).unwrap_or_default())
        .collect();
    redirect(&format!("{}?{}", path, pairs.join("&")))
}

/// 页面响应统一出口（公开页）：保证 doctype/head/style.css 壳不被遗漏。
/// 任何 GET 处理器不得直接 `html(body)` 返回页面 —— 缺壳类事故（v1.6.2 登录页）由本出口结构性封堵。
pub fn pub_page(title: &str, body: &str) -> Response {
    html(layout(None, title, "", "", "", body))
}

/// 页面响应统一出口（登录态页）
pub fn user_page(u: &User, title: &str, active: &str, pid: &str, query_p: &str, body: &str) -> Response {
    html(layout(Some(u), title, active, pid, query_p, body))
}

pub fn redirect_cookie(loc: &str, cookie: &str) -> Response {
    (
        StatusCode::SEE_OTHER,
        [(header::LOCATION, loc.to_string()), (header::SET_COOKIE, cookie.to_string())],
    )
        .into_response()
}

pub fn html(s: String) -> Response {
    Html(s).into_response()
}

// 登录守卫：未登录 → 302 /login；返回 User
pub fn require_user(headers: &HeaderMap) -> Result<User, Response> {
    match current_user(headers) {
        Some(u) => Ok(u),
        None => Err(redirect("/login")),
    }
}

// 审计写入
pub fn audit_log(user_id: Option<&str>, email: &str, action: &str, target: &str, ip: &str) {
    db::with_db(|c| {
        c.execute(
            "INSERT INTO auditLog (id, userId, email, action, target, ip, createdAt) VALUES (?,?,?,?,?,?,?)",
            rusqlite::params![auth::gen_uuid(), user_id, email, action, target, ip, auth::now_iso()],
        )
        .ok();
    });
}

pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

// ============ 项目可见性 ============
pub fn user_projects(user_id: &str) -> Vec<(String, String)> {
    db::with_db(|c| {
        let mut stmt = match c.prepare(
            "SELECT p.id, p.name FROM projects p JOIN companies co ON p.companyId=co.id JOIN orgMembers om ON om.orgId=co.orgId AND om.userId=? ORDER BY p.createdAt DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows = stmt.query_map([user_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
        match rows {
            Ok(rs) => rs.filter_map(|x| x.ok()).collect(),
            Err(_) => vec![],
        }
    })
}

pub fn project_owned(user_id: &str, pid: &str) -> bool {
    db::with_db(|c| {
        c.query_row(
            "SELECT 1 FROM projects p JOIN companies co ON p.companyId=co.id JOIN orgMembers om ON om.orgId=co.orgId AND om.userId=? WHERE p.id=?",
            [user_id, pid],
            |r| r.get::<_, i32>(0),
        )
        .is_ok()
    })
}

// 项目守卫：未登录或无权限 → Err（404 或 302）
pub fn require_project(headers: &HeaderMap, pid: &str) -> Result<User, Response> {
    let u = require_user(headers)?;
    if project_owned(&u.id, pid) {
        Ok(u)
    } else {
        Err(html404())
    }
}

pub fn html404() -> Response {
    (
        StatusCode::NOT_FOUND,
        Html("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;padding:40px\"><h2>404 · 页面不存在或无权限</h2><p><a href=\"/dashboard\">返回工作台</a></p></body></html>".to_string()),
    )
        .into_response()
}

pub fn html403(msg: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Html(format!("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;padding:40px\"><h2>403 · 无权限</h2><p>{}</p><a href=\"/dashboard\">返回</a></body></html>", esc(msg))),
    )
        .into_response()
}

// ============ 布局引擎（对应 Node ui.js layout） ============
struct TourCounts {
    companies: bool,
    projects: bool,
    project_id: String,
    open_keys: bool,
    kb_docs: bool,
    questions: bool,
    articles: bool,
    audited: bool,
    accounts: bool,
    published: bool,
    monitors: bool,
    source_assets: bool,
    reports: bool,
}

fn gather_counts(user_id: &str, explicit_pid: &str) -> TourCounts {
    let projects = user_projects(user_id);
    let project_id = if !explicit_pid.is_empty() { explicit_pid.to_string() } else { projects.first().map(|x| x.0.clone()).unwrap_or_default() };
    let mut c = TourCounts {
        companies: db::with_db(|d| {
            d.query_row("SELECT COUNT(*) FROM companies WHERE ownerUserId=?", [user_id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0
        }),
        projects: !projects.is_empty(),
        project_id: project_id.clone(),
        open_keys: db::with_db(|d| {
            d.query_row("SELECT COUNT(*) FROM openKeys WHERE userId=? AND revokedAt IS NULL", [user_id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0
        }),
        kb_docs: false,
        questions: false,
        articles: false,
        audited: false,
        accounts: false,
        published: false,
        monitors: false,
        source_assets: false,
        reports: false,
    };
    if !project_id.is_empty() {
        let n = |sql: &str| -> bool {
            db::with_db(|d| d.query_row(sql, [&project_id], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0)
        };
        c.kb_docs = n("SELECT COUNT(*) FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)");
        c.questions = n("SELECT COUNT(*) FROM questions WHERE projectId=?");
        c.articles = n("SELECT COUNT(*) FROM articles WHERE projectId=?");
        c.audited = n("SELECT COUNT(*) FROM auditRecords ar JOIN articles a ON ar.articleId=a.id WHERE a.projectId=? AND ar.verdict=2");
        c.accounts = n("SELECT COUNT(*) FROM publishAccounts WHERE projectId=?");
        c.published = n("SELECT COUNT(*) FROM publishTasks WHERE projectId=? AND status=3 AND publishedUrl IS NOT NULL");
        c.monitors = n("SELECT COUNT(*) FROM monitorTasks WHERE projectId=?");
        c.source_assets = n("SELECT COUNT(*) FROM sourceAssets WHERE projectId=?");
        c.reports = n("SELECT COUNT(*) FROM reports WHERE projectId=?");
    }
    c
}

fn mark(done: bool, name: &str) -> String {
    if done {
        format!("\u{2713} 已完成 \u{00b7} {}", name)
    } else {
        name.to_string()
    }
}

fn build_tour_steps(c: &TourCounts) -> String {
    let mut steps: Vec<String> = Vec::new();
    let mut s = |sel: &str, title: String, desc: &str, href: &str, cta: &str| {
        steps.push(format!(
            r#"{{"sel":"{}","title":{},"desc":{},"href":"{}","cta":"{}"}}"#,
            esc(sel),
            serde_json::to_string(&title).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&desc).unwrap_or_else(|_| "\"\"".into()),
            esc(href),
            esc(cta)
        ));
    };
    s(
        "a.nav[href=\"/dashboard\"]",
        "欢迎 \u{1f44b} 这是你的 GEO 控制台".into(),
        "十步工作台在这里：迷路了随时回这里，每一步完成会自动打勾。下面用 1 分钟带你认全所有入口。",
        "",
        "",
    );
    s(
        "a.nav[href=\"/companies\"]",
        mark(c.companies, "① 公司管理"),
        if c.companies { "公司已创建。多客户/多品牌时在这里区分归属。" } else { "从这里开始：填公司名称、行业、简介——它决定项目与数据的归属。" },
        "",
        "",
    );
    s(
        "a.nav[href=\"/projects\"]",
        mark(c.projects, "② GEO 项目"),
        if c.projects { "项目已创建。认真填品牌名/产品名/卖点，它们决定内容生成质量。" } else { "创建项目时认真填品牌名、产品名、主营业务与核心卖点——AI 写作全靠它们。" },
        "",
        "",
    );
    if !c.project_id.is_empty() {
        s("a.nav[href$=\"/kb\"]", mark(c.kb_docs, "③ 知识库（事实唯一来源）"), if c.kb_docs { "六模块知识库已就绪。记得随时补「待补充」项、处理口径冲突。" } else { "把原始资料粘贴进「知识库整理」，自动生成六模块；AI 只能用库里已确认的事实，绝不编造。" }, "", "");
        s("a.nav[href$=\"/questions\"]", mark(c.questions, "④ 问题拓展 / 搜索问题库"), if c.questions { "问题池已建立。用优先级列标记主攻问题（P0 最高）。" } else { "一键生成 50 个消费者真实会问 AI 的问题，再精简为标准 40 问（探索30/评估5/行动5）。" }, "", "");
        s("a.nav[href$=\"/content\"]", mark(c.articles, "⑤ 内容创作"), if c.articles { "内容已生成。下一步是三道审核。" } else { "选一个问题生成三类资产：AI 答案卡 / 品牌优化文章 / 产品推荐文章（含封面）。" }, "", "");
        s("a.nav[href$=\"/articles\"]", mark(c.audited, "⑥ 三道审核"), if c.audited { "审核已通过 ✅ 可以进入发布。" } else { "知识库一致性 / 媒体投稿标准 / GEO 可信度——任何一道不通过都不能发布；点进文章执行审核。" }, "", "");
        s("a.nav[href$=\"/accounts\"]", mark(c.accounts, "⑦ 授权账号"), if c.accounts { "账号已就绪。" } else { "登记发布渠道账号（平台/名称/类型/额度），发布需要账号。" }, "", "");
        s("a.nav[href$=\"/publish\"]", mark(c.published, "⑧ 发布与回填"), if c.published { "已有正式链接。真实渠道手动发布后记得「手动发布回填」真实 URL。" } else { "生成发布包（七字段）→ 确认发布；渠道没有 API 时手动发布后回填真实链接。" }, "", "");
        s("a.nav[href$=\"/monitor\"]", mark(c.monitors, "⑨ 上榜监测（核心价值）"), if c.monitors { "监测已建立：用同一个问题在第 3/7/14 天复测看趋势。" } else { "用同一个问题监测 AI：品牌出现了吗？引用我方链接了吗？创建后立即执行首轮。" }, "", "");
        s("a.nav[href$=\"/sources\"]", mark(c.source_assets, "⑩ 信源资产"), if c.source_assets { "信源库已建立，注意维护四状态与下一步动作。" } else { "把监测引用来源归入四状态：已引用 / 潜在 / 可投放 / 观察。" }, "", "");
        s("a.nav[href$=\"/reports\"]", mark(c.reports, "⑪ 诊断报告"), if c.reports { "报告已生成，用于复盘与客户沟通。" } else { "品牌诊断 / 一页纸诊断 / 优化前后对比 / 逆向分析——复盘和商务拜访直接可用。" }, "", "");
    } else {
        s("a.nav[href=\"/projects\"]", "提示：还没有 GEO 项目".into(), "先完成 ② 创建项目和 ③ 知识库，右侧菜单会自动展开后续功能。", "/projects", "去创建项目");
    }
    s(
        "a.nav[href=\"/settings/keys\"]",
        mark(c.open_keys, "⑫ Open Key（让 AI 帮你操作）"),
        if c.open_keys { "密钥已创建。在 AI 工具里执行 geo auth login 即可让 AI 驱动平台。" } else { "在 Codex / Claude Code 里用一句话让 AI 干活的前提：创建密钥并在本机录入（geo auth login）。写操作永远先给你确认摘要。" },
        "/settings/keys",
        "去创建密钥",
    );
    format!("[{}]", steps.join(","))
}

struct Mission {
    title: &'static str,
    desc: &'static str,
    href: String,
    done: bool,
    current: bool,
}

fn build_missions(c: &TourCounts) -> (Vec<Mission>, bool) {
    let mut missions = vec![
        Mission { title: "创建公司", desc: "1 分钟：填名称/行业/简介", href: "/companies".into(), done: c.companies, current: false },
        Mission { title: "创建 GEO 项目", desc: "填品牌名、产品名、主营业务与卖点——决定内容质量", href: "/projects".into(), done: c.projects, current: false },
    ];
    if !c.project_id.is_empty() {
        let p = &c.project_id;
        missions.push(Mission { title: "整理知识库", desc: "粘贴原始资料 → 自动生成品牌知识库六模块", href: format!("/projects/{}/kb?tour=kb", p), done: c.kb_docs, current: false });
        missions.push(Mission { title: "生成问题池", desc: "一键 50 问 → 标准 40 问（探索30/评估5/行动5）", href: format!("/projects/{}/questions?tour=questions", p), done: c.questions, current: false });
        missions.push(Mission { title: "创作并审核第一篇内容", desc: "生成品牌文章 → 三道审核全部通过", href: format!("/projects/{}/content?tour=content", p), done: c.audited, current: false });
        missions.push(Mission { title: "发布并监测", desc: "发布包确认 → 正式链接 → 上榜监测看 AI 是否引用你", href: format!("/projects/{}/publish?tour=publish", p), done: c.published && c.monitors, current: false });
        missions.push(Mission { title: "沉淀与复盘", desc: "信源资产四状态 + 品牌诊断报告", href: format!("/projects/{}/sources?tour=sources", p), done: c.source_assets && c.reports, current: false });
    } else {
        missions.push(Mission { title: "提示：创建项目后展开后续 5 步", desc: "知识库/问题池/内容/发布/监测都挂在项目下", href: "/projects".into(), done: false, current: false });
    }
    let all_done = missions.iter().all(|m| m.done);
    if let Some(first) = missions.iter_mut().find(|m| !m.done) {
        first.current = true;
    }
    (missions, all_done)
}

fn missions_html(m: &[Mission], all_done: bool) -> String {
    if all_done {
        return "<div class=\"notice ns-banner\">\u{1f389} 快速上手已完成——进入持续运营循环：每轮只做一个优化动作，第 3/7/14 天用同一问题复测。<a class=\"btn small\" href=\"/dashboard\" style=\"margin-left:8px\">去工作台</a></div>".into();
    }
    let items: Vec<String> = m
        .iter()
        .enumerate()
        .map(|(i, x)| {
            let state = if x.done { "done" } else if x.current { "current" } else { "todo" };
            let no = if x.done { "\u{2713}".to_string() } else { (i + 1).to_string() };
            let btn = if x.current {
                format!("<a class=\"btn small\" href=\"{}\">开始：{} \u{2192}</a>", esc(&x.href), esc(x.title))
            } else if x.done {
                format!("<a class=\"btn small ghost\" href=\"{}\">查看</a>", esc(&x.href))
            } else {
                String::new()
            };
            format!(
                "<div class=\"ms-item {}\"><span class=\"ms-no\">{}</span><span class=\"ms-body\"><b>{}</b><span class=\"kv\">{}</span></span>{}</div>",
                state, no, esc(x.title), esc(x.desc), btn
            )
        })
        .collect();
    let done_count = m.iter().filter(|x| x.done).count();
    format!(
        "<div class=\"card missions-card\"><div style=\"display:flex;justify-content:space-between;align-items:center\"><h2 style=\"margin:0\">\u{1f680} 快速上手：{}/{} 完成</h2><span class=\"kv\">跟着做，最快 {} 分钟跑通 GEO 最小闭环（每完成一步自动打勾）</span></div>{}</div>",
        done_count,
        m.len(),
        if done_count >= 2 { "10" } else { "15" },
        items.join("")
    )
}

// 页面微引导（?tour=<name>）：与 Node PAGE_TOURS 一致的静态 JSON
pub const PAGE_TOURS_JSON: &str = r#"{"companies":[{"sel":"input[name=\"name\"]","title":"① 填公司名称","desc":"公司决定项目和数据的归属。行业与简介可选填。"},{"sel":"form[action=\"/companies/create\"] button","title":"② 点「添加」","desc":"创建后回来，任务清单会自动打勾 ✓，然后进入第 2 步：创建 GEO 项目。"}],"projects":[{"sel":"select[name=\"companyId\"]","title":"① 选择所属公司","desc":"刚创建的公司在这里选。"},{"sel":"input[name=\"brandName\"]","title":"② 品牌名（重点）","desc":"AI 监测和内容全靠它识别你的品牌，务必与对外名称完全一致。"},{"sel":"input[name=\"business\"]","title":"③ 主营业务与目标人群","desc":"例：3-8 岁儿童客厅体感运动。越具体，50 问和内容越精准。"},{"sel":"input[name=\"sellingPoints\"]","title":"④ 核心差异化卖点","desc":"例：无需穿戴设备 / 家长端实时生成体测报告。"},{"sel":"form[action=\"/projects/create\"] button","title":"⑤ 点「添加」","desc":"创建后自动进入项目页，后续任务在左侧项目菜单里。"}],"kb":[{"sel":"textarea[name=\"raw\"]","title":"① 粘贴原始资料","desc":"把公司/产品的介绍、价格、案例、资质整段贴进来——有什么贴什么，缺的会标「待补充」，绝不编造。"},{"sel":"form[action$=\"/kb/organize\"] button","title":"② 点「开始整理」","desc":"系统按标准六模块（定位/产品/客户/差异/案例/背书）自动整理 + 生成 QA 索引和口径冲突清单。"},{"sel":"table thead","title":"③ 六模块清单","desc":"整理结果出现在这里。绿色「可用」即可支撑内容创作；「待补充」项找业务补资料。"}],"questions":[{"sel":"form[action$=\"questions/generate\"]","title":"① 点「生成 50 问」","desc":"按消费者决策路径生成 50 个真实口语化问题（综合/场景/人群/痛点/功能/决策六组，全部不带品牌名）。"},{"sel":"form[action$=\"questions/generate\"] ~ form, form[action$=\"questions/generate\"]","title":"② 再点「精简为标准 40 问」","desc":"筛选为探索 30 / 评估 5 / 行动 5 的标准结构，输出可直接复制的表格。"},{"sel":"table thead","title":"③ 问题池就绪","desc":"用优先级列把主攻问题标为 P0。下一步：内容创作。"}],"content":[{"sel":"select[name=\"questionId\"]","title":"① 选目标问题","desc":"建议先用品牌认知问题（带品牌名的那类）。可先点上方「创作前输入检查」看资料是否齐。"},{"sel":"select[name=\"type\"]","title":"② 选内容类型","desc":"AI 答案卡（抖音图文三形态）/ 品牌优化文章 / 产品推荐文章。第一篇建议选「品牌优化文章」。"},{"sel":"form[action$=\"/content/create\"] button","title":"③ 点「生成内容 + 封面」","desc":"生成后自动跳到文章详情页——记得执行三道审核，全部通过才能发布。"}],"publish":[{"sel":"select[name=\"articleId\"]","title":"① 选文章（需已过审）","desc":"只有三道审核全过的文章会出现在这里。"},{"sel":"select[name=\"accountId\"]","title":"② 选账号与平台","desc":"没有账号？先到「授权账号」添加。"},{"sel":"form[action$=\"/publish/create\"] button","title":"③ 生成发布包预览","desc":"七字段发布包确认后进入发布。渠道没有 API 时：手动发布后用「手动发布回填」登记真实链接。"}],"sources":[{"sel":"form[action$=\"/sources/collect\"] button","title":"① 一键沉淀信源","desc":"把监测引用来源自动归类：我方被引用 → 已引用信源；竞品/第三方 → 观察信源。"},{"sel":"table thead","title":"② 信源四状态","desc":"已引用 / 潜在 / 可投放 / 观察——逐条维护「下一步动作」，这就是你的 GEO 资产库。"}],"monitor":[{"sel":"select[name=\"questionIds\"]","title":"① 选问题（可多选）","desc":"固定问题原文！复测必须用同一个问题。"},{"sel":"select[name=\"platforms\"]","title":"② 选 AI 平台","desc":"豆包 / DeepSeek / 元宝 / 通义。配了 Key 的平台走真实联网问答。"},{"sel":"form[action$=\"/monitor/create\"] button","title":"③ 创建并执行首轮","desc":"第 0 天立即出结果：品牌出现？引用我方链接了吗？周期任务自动建 3/7/14 天复测点。"}]}"#;

fn project_nav(pid: &str, active: &str) -> String {
    let items: [(&str, &str, String); 14] = [
        ("overview", "项目概览", format!("/projects/{}", pid)),
        ("kb", "知识库", format!("/projects/{}/kb", pid)),
        ("questions", "问题拓展 / 搜索问题库", format!("/projects/{}/questions", pid)),
        ("content", "内容创作", format!("/projects/{}/content", pid)),
        ("articles", "文章管理", format!("/projects/{}/articles", pid)),
        ("materials", "资源中心", format!("/projects/{}/materials", pid)),
        ("accounts", "授权账号", format!("/projects/{}/accounts", pid)),
        ("publish", "内容发布 / 自媒体发布", format!("/projects/{}/publish", pid)),
        ("paid", "付费媒体", format!("/projects/{}/paid", pid)),
        ("monitor", "上榜监测", format!("/projects/{}/monitor", pid)),
        ("sites", "收录站点", format!("/projects/{}/sites", pid)),
        ("wom", "口碑监测", format!("/projects/{}/wom", pid)),
        ("sources", "信源资产", format!("/projects/{}/sources", pid)),
        ("reports", "诊断报告 / 监测报告", format!("/projects/{}/reports", pid)),
    ];
    let mut out = String::from("<div class=\"group\">本项目</div>");
    for (key, name, href) in items {
        out.push_str(&format!(
            "<a class=\"nav{}\" href=\"{}\">{}</a>",
            if active == key { " active" } else { "" },
            esc(&href),
            esc(name)
        ));
    }
    out
}

// layout：u 为当前用户（None 用于登录页等公开页——Node 版语义：无用户则不渲染 shell）
pub fn layout(u: Option<&User>, title: &str, active: &str, proj_id: &str, query_p: &str, body: &str) -> String {
    let head = format!(
        "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{} · GEO 平台</title>\n<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2222%22 fill=%22%234f46e5%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2252%22 text-anchor=%22middle%22 fill=%22white%22 font-family=%22sans-serif%22%3EG%3C/text%3E%3C/svg%3E\">\n<link rel=\"stylesheet\" href=\"/style.css\">\n</head><body>",
        esc(title)
    );

    let user = match u {
        Some(x) => x,
        None => {
            return format!(
                "{}</body></html>",
                head
            ) + "<main class=\"main\">" + body + "</main></body></html>";
        }
    };

    let projects = user_projects(&user.id);
    let proj_options: String = projects
        .iter()
        .map(|(id, name)| format!("<option value=\"{}\"{}>{}</option>", esc(id), if id == proj_id { " selected" } else { "" }, esc(name)))
        .collect();
    let p_nav = if !proj_id.is_empty() { project_nav(proj_id, active) } else { String::new() };

    let counts = gather_counts(&user.id, if query_p.is_empty() { proj_id } else { query_p });
    let tour_steps = build_tour_steps(&counts);
    let (missions, all_done) = build_missions(&counts);
    let missions_card = if active == "dashboard" { missions_html(&missions, all_done) } else { String::new() };

    let welcome = r#"<div id="geo-welcome" class="modal-mask" style="display:none">
  <div class="modal">
    <h2>👋 欢迎使用 GEO 营销平台</h2>
    <p class="kv">这是你的生成式引擎优化（GEO）运营系统：让 AI 在用户提问时准确认识你、推荐你、引用你。</p>
    <ol class="tour">
      <li><b>存事实：</b>公司 → GEO 项目 → 品牌知识库（六模块）。AI 只能用库里已确认的事实写作，绝不编造。</li>
      <li><b>选问题：</b>一键生成 50 个消费者真实会问 AI 的问题，精简为标准 40 问。</li>
      <li><b>做内容：</b>AI 答案卡 / 品牌优化文章 / 产品推荐文章，过三道审核后发布。</li>
      <li><b>看结果：</b>上榜监测告诉你「AI 引用了你没有」，沉淀信源资产，逐轮优化。</li>
    </ol>
    <p class="kv">💡 两种玩法：在网页上按 <b>新手引导横幅</b> 一步步点；或在 Codex / Claude Code 里对 AI 说
    「<b>我是新学员，帮我选择合适模式并跑一个 GEO 项目</b>」让 AI 帮你操作（写操作都会先给你确认摘要）。</p>
    <div style="margin-top:14px;text-align:right">
      <a href="javascript:void(0)" class="kv" style="margin-right:12px" onclick="geoWelcomeClose()">跳过</a>
      <a class="btn" href="/companies?tour=companies" onclick="geoWelcomeClose()">🚀 开始快速上手（6 步跑通最小闭环）</a>
      <a class="btn ghost" href="javascript:void(0)" onclick="geoWelcomeClose();setTimeout(function(){geoTour.start()},250)">先看功能地图</a>
    </div>
  </div>
</div>"#;

    let fab = "<a class=\"geo-fab\" href=\"javascript:void(0)\" title=\"功能地图：带你认全 13 个入口\" onclick=\"geoTour.finish(false);geoTour.start()\">\u{1f5fa}\u{fe0f} 功能地图</a>";

    format!(
        r#"{head}
<div class="shell">
<aside class="sidebar">
  <div class="logo">GEO 营销平台</div>
  <div class="proj">当前项目
    <select onchange="if(this.value)location='/projects/'+this.value">
      <option value="">选择项目…</option>{proj_options}
    </select>
  </div>
  <a class="nav {act_dashboard}" href="/dashboard">十步工作台</a>
  <a class="nav {act_auto}" href="/auto-geo" style="color:var(--brand);font-weight:600">🚀 一键 GEO</a>
  <div class="group">基础建设</div>
  <a class="nav {act_companies}" href="/companies">公司管理</a>
  <a class="nav {act_projects}" href="/projects">GEO 项目</a>
  {p_nav}
  <div class="group">系统</div>
  <a class="nav {act_changepwd}" href="/change-password">修改密码</a>
  <a class="nav {act_settings}" href="/settings/keys">系统设置</a>
  <a class="nav {act_team}" href="/team">团队成员</a>
  <div class="foot">
    {email}<br>
    <a href="/logout" style="color:#7c86a0">退出登录</a><br><br>
    <span class="mono">v1.6 · Rust 版</span>
  </div>
</aside>
<main class="main">
      {missions_card}
      {body}
      {welcome}
      {fab}
    </main>
    <script>window.GEO_TOUR_STEPS = {tour_steps};window.GEO_PAGE_TOURS = {page_tours};</script><script src="/tour.js"></script>
    <script>
      function dismissStep(){{
        try{{ const b=document.getElementById('ns-banner'); const k='geo_ns_done_'+b.dataset.href; localStorage.setItem(k,'1'); b.remove(); }}catch(e){{}}
      }}
      (function(){{
        const b=document.getElementById('ns-banner');
        if(b && localStorage.getItem('geo_ns_done_'+b.dataset.href)==='1'){{ b.remove(); }}
        try{{
          if(!localStorage.getItem('geo_welcome_v1')){{
            document.getElementById('geo-welcome').style.display='flex';
          }}
        }}catch(e){{}}
        function closeW(){{ document.getElementById('geo-welcome').style.display='none'; localStorage.setItem('geo_welcome_v1','1'); }}
        window.geoWelcomeClose=closeW;
      }})();
    </script>
</div>

    <!-- 全站异步加载层 -->
    <div id="geo-loading" style="position:fixed;inset:0;z-index:999;background:rgba(15,20,35,.65);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;flex-direction:column">
      <div style="background:#fff;border-radius:16px;padding:36px 48px;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.2);max-width:400px">
        <div class="geo-spinner" style="width:48px;height:48px;margin:0 auto 16px;border:4px solid var(--brand-soft);border-top-color:var(--brand);border-radius:50%;animation:geo-spin .8s linear infinite"></div>
        <div id="geo-loading-text" style="font-size:15px;font-weight:600;color:var(--ink);margin-bottom:6px">处理中…</div>
        <div id="geo-loading-sub" style="font-size:13px;color:var(--muted)">请稍候，页面将自动跳转</div>
      </div>
    </div>
    <style>
      @keyframes geo-spin {{ to {{ transform: rotate(360deg); }} }}
      #geo-loading.show {{ display: flex !important; }}
      #geo-loading .geo-spinner {{ animation: geo-spin .8s linear infinite; }}
      body.geo-loading * {{ pointer-events: none !important; }}
      body.geo-loading #geo-loading {{ pointer-events: auto !important; }}
    </style>
    <script>
    (function() {{
      var STATUS_MAP = [
        {{ pattern: /kb\/organize/, text: 'AI 正在整理知识库六模块…', sub: '整理中，需要几秒钟' }},
        {{ pattern: /questions\/generate/, text: 'AI 正在生成问题…', sub: '生成中，需要几秒钟' }},
        {{ pattern: /content\/create/, text: 'AI 正在创作内容…', sub: '写作中，需要几秒钟' }},
        {{ pattern: /articles.*audit/, text: '正在执行三道审核…', sub: '知识库一致性 / 媒体标准 / GEO 可信度' }},
        {{ pattern: /monitor\/create/, text: '正在创建上榜监测…', sub: 'AI 正在回答监测问题' }},
        {{ pattern: /monitor.*runnext|monitor.*runNext/, text: '正在执行复测…', sub: 'AI 正在回答监测问题' }},
        {{ pattern: /publish\/create/, text: '正在生成发布包…', sub: '整理七字段发布确认清单' }},
        {{ pattern: /publish.*confirm/, text: '正在确认发布…', sub: '任务已提交' }},
        {{ pattern: /auto-geo\/run/, text: '🚀 一键 GEO 执行中…', sub: '正在创建全部资产' }},
        {{ pattern: /reports\/create/, text: '正在生成报告…', sub: '基于监测数据分析中' }},
        {{ pattern: /sources\/collect/, text: '正在沉淀信源资产…', sub: '从监测结果归类四状态' }},
        {{ pattern: /team\/invite/, text: '正在邀请成员…', sub: '' }},
        {{ pattern: /licenses\/generate/, text: '正在生成卡密…', sub: '' }},
        {{ pattern: /settings\/config\/save/, text: '正在保存系统配置…', sub: '' }},
        {{ pattern: /login/, text: '正在登录…', sub: '' }},
        {{ pattern: /register/, text: '正在创建账号…', sub: '' }},
      ];
      var shown = false;
      function showLoading(text, sub) {{
        if (shown) return;
        shown = true;
        var el = document.getElementById('geo-loading');
        if (!el) return;
        document.getElementById('geo-loading-text').textContent = text || '处理中…';
        document.getElementById('geo-loading-sub').textContent = sub || '请稍候';
        el.classList.add('show');
        document.body.classList.add('geo-loading');
        document.querySelectorAll('button[type="submit"], button:not([type])').forEach(function(b) {{ b.disabled = true; }});
      }}
      function hideLoading() {{
        shown = false;
        var el = document.getElementById('geo-loading');
        if (el) el.classList.remove('show');
        document.body.classList.remove('geo-loading');
        document.querySelectorAll('button[disabled]').forEach(function(b) {{ b.disabled = false; }});
      }}
      document.addEventListener('submit', function(e) {{
        var form = e.target;
        if (form.tagName !== 'FORM') return;
        var action = form.getAttribute('action') || '';
        var entry = STATUS_MAP.find(function(s) {{ return s.pattern.test(action); }});
        if (entry) {{ showLoading(entry.text, entry.sub); }}
        else if (action && action !== '#') {{ showLoading('处理中…', '请稍候'); }}
      }}, true);
      window.addEventListener('pageshow', function() {{ hideLoading(); }});
    }})();
    </script>

</body></html>"#,
        head = head,
        proj_options = proj_options,
        act_dashboard = if active == "dashboard" { "active" } else { "" },
        act_auto = if active == "auto-geo" { "active" } else { "" },
        act_companies = if active == "companies" { "active" } else { "" },
        act_projects = if active == "projects" { "active" } else { "" },
        p_nav = p_nav,
        act_changepwd = if active == "changepwd" { "active" } else { "" },
        act_settings = if ["keys", "config", "audit", "licenses"].contains(&active) { "active" } else { "" },
        act_team = if active == "team" { "active" } else { "" },
        email = esc(&user.email),
        missions_card = missions_card,
        body = body,
        welcome = welcome,
        fab = fab,
        tour_steps = tour_steps,
        page_tours = PAGE_TOURS_JSON,
    )
}

// ============ 登录 / 注册 / 改密 / 登出 / 条款 ============
// 登录 / 注册共用分屏品牌版式（与 Node 版 platform/src/web/routes.js 逐字节同源）
pub fn auth_shell(h2: &str, intro: &str, err_html: &str, form_inner: &str, foot: &str) -> String {
    format!(
        r#"<style>main.main{{max-width:100%;padding:0}}</style>
<div class="auth-wrap">
  <div class="auth-brand">
    <div class="auth-logo">G</div>
    <h1>GEO 营销平台</h1>
    <p class="auth-tag">让 AI 在用户提问时，准确认识你、推荐你、引用你。</p>
    <ul class="auth-points">
      <li><b>存事实</b>知识库六模块沉淀品牌事实，AI 只用已确认的事实写作，绝不编造</li>
      <li><b>做内容</b>答案卡 / 品牌文章 / 产品文章，三道审核后按平台规范发布</li>
      <li><b>看结果</b>上榜监测告诉你「AI 引用了你没有」，沉淀信源，逐轮优化</li>
    </ul>
    <div class="auth-foot">GEO Platform v1.6 ｜ 用户协议 · 隐私政策</div>
  </div>
  <div class="auth-panel">
    <form method="post" class="auth-card" action="/login">
      <h2>{h2}</h2>
      <p class="kv" style="margin:0 0 10px">{intro}</p>
      {err_html}
      {form_inner}
      <p class="kv" style="margin-top:14px">{foot}</p>
    </form>
  </div>
</div>"#,
        h2 = esc(h2),
        intro = intro,
        err_html = err_html,
        form_inner = form_inner,
        foot = foot,
    )
}

pub async fn login_page(axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>) -> Response {
    let err_html = match q.get("error") {
        Some(e) => format!("<div class=\"auth-error\">{}</div>", esc(e)),
        None => String::new(),
    };
    let form_inner = r#"
        <label class="f">邮箱</label><input type="email" name="email" required value="demo@geo.local" autocomplete="username">
        <label class="f">密码</label>
        <div class="pwd-row">
          <input type="password" name="password" id="geo-pwd" required placeholder="请输入密码" autocomplete="current-password" autofocus>
          <button type="button" class="pwd-eye" onclick="var p=document.getElementById('geo-pwd');p.type=p.type==='password'?'text':'password';this.textContent=p.type==='password'?'显示':'隐藏'">显示</button>
        </div>
        <div style="margin-top:16px"><button class="btn" style="width:100%">登录</button></div>"#;
    let body = auth_shell(
        "登录",
        "Skills 负责让 AI 帮你执行，平台负责保存项目、执行发布、监测结果和沉淀数据。",
        &err_html,
        form_inner,
        "没有账号？<a href=\"/register\">注册</a> · 演示账号已预填<br><a href=\"/terms\" target=\"_blank\">用户协议</a> · <a href=\"/privacy\" target=\"_blank\">隐私政策</a>",
    );
    pub_page("登录", &body)
}

const LOGIN_MAX_FAILS: i64 = 5;

pub async fn login_submit(headers: HeaderMap, fb: Fb) -> Response {
    let email = fb.get("email");
    let password = fb.get("password");
    let ip = client_ip(&headers);
    let row = db::with_db(|c| {
        c.query_row(
            "SELECT id, passwordHash, salt, mustChangePassword, failedAttempts, lockedUntil FROM users WHERE email=?",
            [&email],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i32>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .ok()
    });
    let (uid, hash, salt, must_change, fails, locked) = match row {
        Some(x) => x,
        None => {
            audit_log(None, &email, "login.failed.unknown_user", "", &ip);
            return redirect("/login?error=%E9%82%AE%E7%AE%B1%E6%88%96%E5%AF%86%E7%A0%81%E9%94%99%E8%AF%AF");
        }
    };
    if let Some(lu) = &locked {
        let remaining = chrono::DateTime::parse_from_rfc3339(lu)
            .ok()
            .map(|t| t.with_timezone(&chrono::Utc).signed_duration_since(chrono::Utc::now()).num_minutes());
        if remaining.unwrap_or(-1) > 0 {
            audit_log(Some(&uid), &email, "login.locked", "", &ip);
            let msg = format!("账号已临时锁定（连续失败 {} 次），请约 {} 分钟后再试", LOGIN_MAX_FAILS, remaining.unwrap_or(1) + 1);
            return redirect_q("/login", &[("error", &msg)]);
        }
    }
    if !auth::verify_password(&password, &salt, &hash) {
        let new_fails = fails + 1;
        // 连续失败 5 次 → 锁定 15 分钟（与 Node 版一致）
        let lock_until = if new_fails >= LOGIN_MAX_FAILS { Some(auth::add_minutes_iso(15)) } else { None };
        db::with_db(|c| {
            c.execute(
                "UPDATE users SET failedAttempts=?, lockedUntil=? WHERE id=?",
                rusqlite::params![if lock_until.is_some() { 0 } else { new_fails }, lock_until, uid],
            )
            .ok();
        });
        audit_log(Some(&uid), &email, if lock_until.is_some() { "login.locked.out" } else { "login.failed" }, &format!("第 {} 次失败", new_fails), &ip);
        let msg = if new_fails >= LOGIN_MAX_FAILS {
            format!("邮箱或密码错误；已连续失败 {} 次，账号临时锁定 15 分钟", LOGIN_MAX_FAILS)
        } else {
            let left = LOGIN_MAX_FAILS - new_fails;
            format!("邮箱或密码错误（再失败 {} 次将临时锁定 15 分钟）", left)
        };
        return redirect_q("/login", &[("error", &msg)]);
    }
    db::with_db(|c| c.execute("UPDATE users SET failedAttempts=0, lockedUntil=NULL WHERE id=?", [&uid]).ok());
    audit_log(Some(&uid), &email, "login.success", "", &ip);
    let cookie = new_session_cookie(&uid);
    if must_change == 1 {
        return redirect_cookie("/change-password", &cookie);
    }
    redirect_cookie("/dashboard", &cookie)
}

pub async fn register_page(axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>) -> Response {
    if std::env::var("DISABLE_REGISTER").as_deref() == Ok("1") {
        return redirect("/login?error=%E6%B3%A8%E5%86%8C%E5%B7%B2%E5%85%B3%E9%97%AD");
    }
    let err_html = match q.get("error") {
        Some(e) => format!("<div class=\"auth-error\">{}</div>", esc(e)),
        None => String::new(),
    };
    let form_inner = r#"
        <label class="f">邮箱</label><input type="email" name="email" required autocomplete="username" autofocus>
        <label class="f">密码（至少 8 位，须含字母和数字）</label>
        <div class="pwd-row">
          <input type="password" name="password" id="geo-pwd" required minlength="8" autocomplete="new-password">
          <button type="button" class="pwd-eye" onclick="var p=document.getElementById('geo-pwd');p.type=p.type==='password'?'text':'password';this.textContent=p.type==='password'?'显示':'隐藏'">显示</button>
        </div>
        <label class="f" style="font-weight:400"><input type="checkbox" name="agree" value="1" required style="width:auto"> 我已阅读并同意 <a href="/terms" target="_blank">《用户协议》</a> 与 <a href="/privacy" target="_blank">《隐私政策》</a></label>
        <div style="margin-top:14px"><button class="btn" style="width:100%">创建账号</button></div>"#;
    let body = auth_shell(
        "注册 GEO 平台",
        "注册后即可创建公司、知识库与 GEO 项目，开始你的第一次 GEO 优化闭环。",
        &err_html,
        form_inner,
        "已有账号？<a href=\"/login\">直接登录</a>",
    );
    pub_page("注册", &body)
}

pub async fn register_submit(headers: HeaderMap, fb: Fb) -> Response {
    if std::env::var("DISABLE_REGISTER").as_deref() == Ok("1") {
        return redirect("/login?error=%E6%B3%A8%E5%86%8C%E5%B7%B2%E5%85%B3%E9%97%AD");
    }
    let email = fb.get("email");
    let password = fb.get("password");
    let ip = client_ip(&headers);
    if fb.get("agree") != "1" {
        return redirect("/register?error=%E8%AF%B7%E5%8B%BE%E9%80%89%E5%90%8C%E6%84%8F%E5%8D%8F%E8%AE%AE");
    }
    if email.is_empty() || password.is_empty() {
        return redirect("/register?error=%E8%AF%B7%E5%A1%AB%E5%86%99%E9%82%AE%E7%AE%B1%E5%92%8C%E5%AF%86%E7%A0%81");
    }
    if let Some(msg) = auth::password_policy_error(&password) {
        return redirect_q("/register", &[("error", msg)]);
    }
    let exists = db::with_db(|c| c.query_row("SELECT id FROM users WHERE email=?", [&email], |r| r.get::<_, String>(0)).is_ok());
    if exists {
        return redirect("/register?error=%E8%AF%A5%E9%82%AE%E7%AE%B1%E5%B7%B2%E6%B3%A8%E5%86%8C");
    }
    let uid = auth::gen_uuid();
    let salt = auth::new_salt();
    let hash = auth::hash_password(&password, &salt);
    // 与 Node 版对齐：注册只建账号不建组织（组织由首次使用/被邀请时建立，
    // 否则被邀请为 viewer 的成员 primaryRole 恒为 owner，只读守卫永远不触发）
    db::with_db(|c| {
        c.execute(
            "INSERT INTO users (id, email, passwordHash, salt, role, createdAt) VALUES (?,?,?,?,?,?)",
            rusqlite::params![uid, email, hash, salt, "member", auth::now_iso()],
        )
        .ok();
    });
    audit_log(Some(&uid), &email, "register", "", &ip);
    let cookie = new_session_cookie(&uid);
    redirect_cookie("/dashboard", &cookie)
}

pub async fn change_password_page(headers: HeaderMap) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let forced = u.must_change == 1;
    let full = card(
        if forced { "安全要求：请先修改初始密码" } else { "修改密码" },
        &format!(
            r#"<div style="max-width:420px">
      <form method="post" action="/change-password">
        <label class="f">当前密码</label><input type="password" name="current" required>
        <label class="f">新密码（至少 8 位，须同时包含字母和数字）</label><input type="password" name="password" required minlength="8">
        <label class="f">确认新密码</label><input type="password" name="confirm" required>
        <div style="margin-top:12px"><button class="btn">修改并{}</button>
        {}</div>
      </form>
    </div>"#,
            if forced { "进入平台" } else { "保存" },
            if forced { String::new() } else { "<a class=\"btn ghost\" href=\"/dashboard\">返回</a>".to_string() }
        ),
    );
    html(layout(Some(&u), "修改密码", "changepwd", "", "", &full))
}

pub async fn change_password_submit(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row(
            "SELECT passwordHash, salt FROM users WHERE id=?",
            [&u.id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok()
    });
    let (hash, salt) = match row {
        Some(x) => x,
        None => return redirect("/change-password?error=%E7%94%A8%E6%88%B7%E4%B8%8D%E5%AD%98%E5%9C%A8"),
    };
    if !auth::verify_password(&fb.get("current"), &salt, &hash) {
        return redirect("/change-password?error=%E5%BD%93%E5%89%8D%E5%AF%86%E7%A0%81%E4%B8%8D%E6%AD%A3%E7%A1%AE");
    }
    if fb.get("password") != fb.get("confirm") {
        return redirect("/change-password?error=%E4%B8%A4%E6%AC%A1%E8%BE%93%E5%85%A5%E7%9A%84%E6%96%B0%E5%AF%86%E7%A0%81%E4%B8%8D%E4%B8%80%E8%87%B4");
    }
    if let Some(msg) = auth::password_policy_error(&fb.get("password")) {
        return redirect_q("/change-password", &[("error", msg)]);
    }
    let new_salt = auth::new_salt();
    let new_hash = auth::hash_password(&fb.get("password"), &new_salt);
    let sid = cookie_sid(&headers);
    db::with_db(|c| {
        c.execute(
            "UPDATE users SET passwordHash=?, salt=?, mustChangePassword=0, failedAttempts=0, lockedUntil=NULL WHERE id=?",
            rusqlite::params![new_hash, new_salt, u.id],
        )
        .ok();
        c.execute("DELETE FROM sessions WHERE userId=? AND id<>?", rusqlite::params![u.id, sid]).ok();
    });
    audit_log(Some(&u.id), &u.email, "password.change", "", &client_ip(&headers));
    let cookie = new_session_cookie(&u.id);
    redirect_cookie("/dashboard", &cookie)
}

pub async fn logout(headers: HeaderMap) -> Response {
    let sid = cookie_sid(&headers);
    logout_resp(&sid)
}

// ============ 条款页 ============
fn terms_page(title: &str, body_md: &str) -> Response {
    let doc = format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{} · GEO 平台</title><link rel="stylesheet" href="/style.css"></head><body><main class="main" style="max-width:860px;margin:0 auto"><div class="card"><h1 style="font-size:20px">{}</h1><div class="md-box md" style="max-height:none">{}</div><p class="kv"><a href="/login">返回登录</a></p></div></main></body></html>"#,
        esc(title),
        esc(title),
        esc(body_md)
    );
    html(doc)
}

pub async fn terms() -> Response {
    terms_page(
        "用户协议（模板版）",
        "一、服务说明\n1. 本平台为生成式引擎优化（GEO）运营工具，提供知识库管理、AI 辅助内容生成、内容审核、发布任务管理、AI 平台监测与数据分析等功能。\n2. 平台可能调用第三方大模型服务（内容生成）与联网检索服务（监测）完成相关功能，具体可用性以平台实际配置为准。\n\n二、账号与使用责任\n1. 您应对账号与密码安全负责，不得出借、转让账号。\n2. 您通过平台对外发布的内容，由您承担最终审核责任。平台提供的三道审核为辅助检查，不构成对内容真实性、合法性的担保。\n3. AI 生成内容可能存在错误或幻觉。您确认：所有对外发布的事实、数据、资质均应经人工核验。\n\n三、数据权利\n1. 您在平台中录入的知识库、问题、文章等业务数据的所有权归您所有。\n2. 为提供服务的目的，平台将在服务期间存储和处理上述数据；您可随时导出或要求删除。\n\n四、付费与服务变更\n1. 付费服务的价格、周期与配额以双方确认的订单/套餐为准。\n2. 平台如需变更重大服务条款，将提前 15 天公告。\n\n五、免责与责任限制\n1. 因不可抗力、第三方服务变更或故障导致的服务中断，平台不承担由此产生的间接损失。\n2. 平台对「AI 是否收录/引用」等结果不作承诺，相关数据仅作运营参考。\n\n六、协议终止\n您可随时停止使用并要求数据导出；若您严重违反本协议（包括违法使用），平台可中止服务。",
    )
}

pub async fn privacy() -> Response {
    terms_page(
        "隐私政策（模板版）",
        "一、我们收集的信息\n1. 账号信息：邮箱、密码（加密存储）。\n2. 业务数据：您主动录入的公司、品牌、产品、知识库、问题、文章与发布/监测记录。\n3. 运行日志：登录记录、操作审计日志，用于安全审计。\n\n二、信息的使用\n1. 仅用于向您提供平台功能与安全保障。\n2. 内容生成/监测可能需将您的问题与知识库内容传输给您配置的第三方模型服务商以完成调用。\n\n三、信息的存储\n1. 业务数据存储于服务端数据库；密码以不可逆加密（scrypt）存储，接口密钥仅保存哈希。\n2. 操作审计日志默认保留 90 天。\n\n四、您的权利\n1. 随时导出、更正或要求删除您的业务数据与账号。\n2. 账号注销后，业务数据将在 30 天内删除，法律法规要求留存的除外。\n\n五、未成年人\n本平台面向企业用户，不面向未成年人提供服务。\n\n六、联系我们\n如对本政策有疑问，请通过平台页面上的联系方式与我们取得联系。",
    )
}

// 根路径：已登录 → dashboard，否则 → login
pub async fn root(headers: HeaderMap) -> Response {
    if current_user(&headers).is_some() {
        redirect("/dashboard")
    } else {
        redirect("/login")
    }
}

// ============ 十步工作台 ============
pub async fn dashboard(headers: HeaderMap, axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let projects = user_projects(&u.id);
    let proj_id = q
        .get("p")
        .cloned()
        .filter(|s| !s.is_empty())
        .or_else(|| projects.first().map(|x| x.0.clone()))
        .unwrap_or_default();
    let mut steps_html = empty("先创建公司和 GEO 项目，工作台将按十步引导完整流程");
    if !proj_id.is_empty() {
        let proj = db::with_db(|c| {
            c.query_row("SELECT name, companyId FROM projects WHERE id=?", [&proj_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .ok()
        });
        if let Some((_, company_id)) = proj {
            let owned = db::with_db(|c| {
                c.query_row(
                    "SELECT 1 FROM companies co JOIN orgMembers om ON om.orgId=co.orgId AND om.userId=? WHERE co.id=?",
                    [&u.id, &company_id],
                    |r| r.get::<_, i32>(0),
                )
                .is_ok()
            });
            if owned {
                let count = |sql: &str| -> i64 { db::with_db(|c| c.query_row(sql, [&proj_id], |r| r.get::<_, i64>(0)).unwrap_or(0)) };
                let kb = count("SELECT COUNT(*) FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)");
                let qs = count("SELECT COUNT(*) FROM questions WHERE projectId=?");
                let arts = count("SELECT COUNT(*) FROM articles WHERE projectId=?");
                let accs = count("SELECT COUNT(*) FROM publishAccounts WHERE projectId=?");
                let pubs = count("SELECT COUNT(*) FROM publishTasks WHERE projectId=? AND status=3");
                let pubs_all = count("SELECT COUNT(*) FROM publishTasks WHERE projectId=?");
                let mons = count("SELECT COUNT(*) FROM monitorTasks WHERE projectId=? AND status=3");
                let steps: [(String, &str, bool, String); 10] = [
                    ("1".into(), "添加公司", true, "/companies".into()),
                    ("2".into(), "添加 GEO 项目", true, format!("/projects/{}", proj_id)),
                    ("3".into(), "添加知识库", kb > 0, format!("/projects/{}/kb", proj_id)),
                    ("4".into(), "生成搜索问题", qs > 0, format!("/projects/{}/questions", proj_id)),
                    ("5".into(), "创建提示词 / 内容创作", qs > 0, format!("/projects/{}/content", proj_id)),
                    ("6".into(), "生成文章", arts > 0, format!("/projects/{}/articles", proj_id)),
                    ("7".into(), "授权账号", accs > 0, format!("/projects/{}/accounts", proj_id)),
                    ("8".into(), "创建发布", pubs > 0 || pubs_all > 0, format!("/projects/{}/publish", proj_id)),
                    ("9".into(), "客户端发布（mock 自动完成）", pubs > 0, format!("/projects/{}/publish", proj_id)),
                    ("10".into(), "收录查询", mons > 0, format!("/projects/{}/monitor", proj_id)),
                ];
                steps_html = format!(
                    "<div class=\"steps\">{}</div>",
                    steps
                        .iter()
                        .map(|(no, name, done, href)| format!(
                            "<a class=\"step{}\" href=\"{}\" style=\"text-decoration:none;color:inherit\"><div class=\"no\">第 {} 步</div><div class=\"name\">{}</div><div class=\"st\">{}</div></a>",
                            if *done { " done" } else { "" },
                            esc(href),
                            esc(no),
                            esc(name),
                            if *done { badge("已完成") } else { badge("待完成") }
                        ))
                        .collect::<Vec<_>>()
                        .join("")
                );
            }
        }
    }
    let division = r#"<table>
      <tr><th>对象</th><th>主要负责什么</th><th>学员能看到的结果</th></tr>
      <tr><td><b>GEO 平台</b></td><td>保存公司、项目、知识库、问题、文章、发布任务、上榜监测、复盘和报告</td><td>项目数据可追踪，发布和监测状态可回查</td></tr>
      <tr><td><b>GEO Skills</b></td><td>把自然语言目标转成品牌、知识库、内容、审核、发布、监测和分析动作</td><td>不用记复杂操作，通过一句话完成一组工作</td></tr>
      <tr><td><b>学员</b></td><td>提供真实资料，确认事实、发布范围、预算和外部写操作</td><td>对结果负责，不把未经核验的内容直接发布</td></tr>
    </table>"#;
    let body = crate::ui::page_head(
        "十步工作台",
        "添加公司 → 添加 GEO 项目 → 添加知识库 → 生成搜索问题 → 创建提示词 → 生成文章 → 授权账号 → 创建发布 → 客户端发布 → 收录查询",
        "",
    ) + &card("", &steps_html)
        + &card("平台与 Skills 的分工", division);
    html(layout(Some(&u), "十步工作台", "dashboard", &proj_id, &proj_id, &body))
}

/// viewer 只读守卫：只读成员禁止全部写操作（POST），仅放行登出（对齐 Node 版 server.js 角色守卫）。
/// 以中间件单点实现，挂在路由层外圈；未登录的公开 POST（登录/注册）不受影响。
pub async fn write_guard(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    if req.method() == axum::http::Method::POST {
        let path = req.uri().path();
        let open_posts = ["/login", "/register", "/logout", "/healthz"];
        if !open_posts.contains(&path) {
            if let Some(u) = current_user(req.headers()) {
                let role: String = db::with_db(|c| {
                    c.query_row(
                        "SELECT om.role FROM orgMembers om WHERE om.userId=? ORDER BY om.createdAt LIMIT 1",
                        [&u.id],
                        |r| r.get(0),
                    )
                    .unwrap_or_default()
                });
                if role == "viewer" {
                    return html403("你的账号为「只读」角色，无写入权限。请联系团队管理员调整角色。");
                }
            }
        }
    }
    next.run(req).await
}
