use axum::{response::Html, extract::Form};
use serde::Deserialize;
use crate::auth;
use crate::db;

pub fn layout(title: &str, body: &str) -> String {
    format!(r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · GEO 平台</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="main" style="max-width:860px;margin:0 auto">{body}</main></body></html>"#)
}

// ===== 登录页 =====
pub async fn login_page() -> Html<String> {
    let body = r#"<div class="card" style="max-width:400px;margin:10vh auto"><h1>GEO 营销平台</h1>
<p>Skills 负责让 AI 帮你执行，GEO 平台负责保存项目、执行发布、监测结果和沉淀数据。</p>
<form method="post" action="/login">
<label>邮箱</label><input type="email" name="email" required><br>
<label>密码</label><input type="password" name="password" required><br>
<button type="submit">登录</button>
</form>
<p><a href="/register">注册</a> · <a href="/terms">用户协议</a> · <a href="/privacy">隐私政策</a></p></div>"#;
    Html(layout("登录", body))
}

#[derive(Deserialize)]
pub struct LoginForm {
    pub email: String,
    pub password: String,
}

pub async fn login_submit(Form(form): Form<LoginForm>) -> axum::response::Redirect {
    let (email, password) = (form.email.trim(), form.password);
    let (uid, stored_hash, salt, must_change) = db::with_db(|c| {
        c.query_row("SELECT id, passwordHash, salt, mustChangePassword FROM users WHERE email=?", [email],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i32>(3)?)))
    }).unwrap_or((String::new(), String::new(), String::new(), 0));
    if uid.is_empty() || !auth::verify_password(&password, &salt, stored_hash.as_str()) {
        return axum::response::Redirect::to("/login?error=邮箱或密码错误");
    }
    // 创建会话
    let sid = auth::gen_uuid();
    db::with_db(|c| {
        c.execute("INSERT INTO sessions (id, userId, expiresAt, createdAt) VALUES (?,?,?,?)",
            rusqlite::params![sid, uid, "2027-12-31T23:59:59Z", auth::now_iso()]).ok();
    });
    if must_change == 1 {
        axum::response::Redirect::to("/change-password")
    } else {
        axum::response::Redirect::to("/dashboard")
    }
}

// ===== 工作台 =====
pub async fn dashboard() -> Html<String> {
    let body = r#"<h1>十步工作台</h1>
<p>GEO Platform (Rust) — API 服务运行中</p>
<p>Web UI 完整版请使用 Node.js 版本，或等待 Rust 版功能对等。</p>
<p><a href="/healthz">健康检查</a> · <a href="/login">登录</a></p>"#;
    Html(layout("工作台", body))
}

// ===== 条款 =====
pub async fn terms() -> Html<String> {
    Html(layout("用户协议", "<h1>用户协议（模板版）</h1><p>正式商用前请经法务审阅。</p>"))
}
pub async fn privacy() -> Html<String> {
    Html(layout("隐私政策", "<h1>隐私政策（模板版）</h1><p>正式商用前请经法务审阅。</p>"))
}
