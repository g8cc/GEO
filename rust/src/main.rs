mod db;
mod auth;
mod api;
mod web;
mod pages;
mod pages2;
mod pages3;
mod static_files;
mod ops;
mod mock;
mod ui;
mod llm;
mod image;

use axum::{routing::{get, post}, Router};
use std::net::SocketAddr;
use tower_http::compression::CompressionLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let port = std::env::var("PORT").unwrap_or("3439".into());
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse().unwrap();
    db::init().await;

    // 演示种子（空库时写入 demo@geo.local / demo1234；SEED_DEMO=0 关闭）
    if std::env::var("SEED_DEMO").as_deref() != Ok("0") {
        db::with_db(mock::seed_demo);
    }

    let app = Router::new()
        .route("/", get(web::root))
        .route("/healthz", get(api::healthz))
        // Open API（read + plan）
        .route("/api/open/v1/call", post(api::capabilities))
        .route("/api/open/v1/call/projects.list", post(api::projects_list))
        .route("/api/open/v1/call/questions.list", post(api::questions_list))
        .route("/api/open/v1/call/articles.list", post(api::articles_list))
        .route("/api/open/v1/call/monitorTasks.list", post(api::monitor_tasks_list))
        .route("/api/open/v1/call/monitorResults.list", post(api::monitor_results_list))
        .route("/api/open/v1/call/sources.list", post(api::sources_list))
        .route("/api/open/v1/call/reports.list", post(api::reports_list))
        .route("/api/open/v1/call/materials.list", post(api::materials_list))
        .route("/api/open/v1/call/accounts.list", post(api::accounts_list))
        .route("/api/open/v1/call/knowledge.list", post(api::knowledge_list))
        .route("/api/open/v1/plan/companies.create", post(ops::create_company))
        .route("/api/open/v1/plan/projects.create", post(ops::create_project))
        .route("/api/open/v1/plan/questions.create", post(ops::create_question))
        .route("/api/open/v1/plan/knowledge.uploadDoc", post(ops::upload_kb_doc))
        .route("/api/open/v1/plan/articles.create", post(ops::create_article))
        .route("/api/open/v1/plan/articles.audit", post(ops::audit_article))
        .route("/api/open/v1/plan/monitorTasks.create", post(ops::create_monitor))
        .route("/api/open/v1/plan/licenses.generate", post(ops::generate_license))
        // 静态资源
        .route("/style.css", get(static_files::style_css))
        .route("/tour.js", get(static_files::tour_js))
        .route("/uploads/{name}", get(pages3::upload_file))
        // 认证
        .route("/login", get(web::login_page).post(web::login_submit))
        .route("/register", get(web::register_page).post(web::register_submit))
        .route("/change-password", get(web::change_password_page).post(web::change_password_submit))
        .route("/logout", get(web::logout))
        .route("/terms", get(web::terms))
        .route("/privacy", get(web::privacy))
        // 工作台
        .route("/dashboard", get(web::dashboard))
        // 基础建设
        .route("/companies", get(pages::companies).post(pages::companies_create))
        .route("/companies/create", post(pages::companies_create))
        .route("/projects", get(pages::projects))
        .route("/projects/create", post(pages::projects_create))
        .route("/projects/{pid}", get(pages::project_detail).post(pages::project_update))
        .route("/projects/{pid}/update", post(pages::project_update))
        // 知识库
        .route("/projects/{pid}/kb", get(pages::kb))
        .route("/projects/{pid}/kb/upload", post(pages::kb_upload))
        .route("/projects/{pid}/kb/update", post(pages::kb_update))
        .route("/projects/{pid}/kb/organize", post(pages::kb_organize))
        // 问题库
        .route("/projects/{pid}/questions", get(pages::questions))
        .route("/projects/{pid}/questions/add", post(pages::questions_add))
        .route("/projects/{pid}/questions/import", post(pages::questions_import))
        .route("/projects/{pid}/questions/generate", post(pages::questions_generate))
        .route("/projects/{pid}/questions/update", post(pages::questions_update))
        // 内容
        .route("/projects/{pid}/content", get(pages2::content))
        .route("/projects/{pid}/content/create", post(pages2::content_create))
        .route("/projects/{pid}/articles", get(pages2::articles))
        .route("/articles/{aid}", get(pages2::article_detail))
        .route("/articles/{aid}/audit", post(pages2::article_audit))
        .route("/projects/{pid}/materials", get(pages2::materials))
        // 账号 / 发布
        .route("/projects/{pid}/accounts", get(pages2::accounts))
        .route("/projects/{pid}/accounts/create", post(pages2::accounts_create))
        .route("/projects/{pid}/publish", get(pages2::publish))
        .route("/projects/{pid}/publish/create", post(pages2::publish_create))
        .route("/publish/{tid}", get(pages2::publish_detail))
        .route("/publish/{tid}/confirm", post(pages2::publish_confirm))
        .route("/publish/{tid}/refresh", post(pages2::publish_refresh))
        .route("/publish/{tid}/retry", post(pages2::publish_retry))
        .route("/publish/mark", post(pages2::publish_mark))
        .route("/projects/{pid}/paid", get(pages2::paid))
        // 监测
        .route("/projects/{pid}/monitor", get(pages2::monitor))
        .route("/projects/{pid}/monitor/create", post(pages2::monitor_create))
        .route("/monitor/{tid}", get(pages2::monitor_detail))
        .route("/monitor/{tid}/runnext", post(pages2::monitor_runnext))
        .route("/projects/{pid}/sites", get(pages2::sites))
        // 口碑 / 信源 / 报告
        .route("/projects/{pid}/wom", get(pages3::wom))
        .route("/projects/{pid}/wom/create", post(pages3::wom_create))
        .route("/projects/{pid}/sources", get(pages3::sources))
        .route("/projects/{pid}/sources/collect", post(pages3::sources_collect))
        .route("/projects/{pid}/sources/update", post(pages3::sources_update))
        .route("/projects/{pid}/reports", get(pages3::reports))
        .route("/projects/{pid}/reports/create", post(pages3::reports_create))
        .route("/reports/{rid}", get(pages3::report_detail))
        .route("/reports/{rid}/export", get(pages3::report_export))
        // 系统设置
        .route("/settings/keys", get(pages3::settings_keys))
        .route("/settings/keys/create", post(pages3::settings_keys_create))
        .route("/settings/keys/revoke", post(pages3::settings_keys_revoke))
        .route("/settings/config", get(pages3::settings_config))
        .route("/settings/config/save", post(pages3::settings_config_save))
        .route("/settings/licenses", get(pages3::licenses))
        .route("/settings/licenses/generate", post(pages3::licenses_generate))
        .route("/settings/audit", get(pages3::audit_page))
        // 团队
        .route("/team", get(pages3::team))
        .route("/team/invite", post(pages3::team_invite))
        .route("/team/role", post(pages3::team_role))
        .route("/team/remove", post(pages3::team_remove))
        .route("/team/redeem", post(pages3::team_redeem))
        .route("/team/quota", post(pages3::team_quota))
        .route("/team/notify", post(pages3::team_notify))
        // 一键 GEO
        .route("/auto-geo", get(pages3::auto_geo_page))
        .route("/auto-geo/run", post(pages3::auto_geo_run))
        .layer(axum::middleware::from_fn(web::write_guard))
        .layer(CompressionLayer::new());

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!(port = port, "GEO Platform (Rust) started");
    axum::serve(listener, app).await.unwrap();
}
