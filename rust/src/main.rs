mod db;
mod auth;
mod api;
mod web;
mod pages;
mod pages2;
mod ops;

use axum::{routing::{get, post}, Router};
use std::net::SocketAddr;
use tower_http::compression::CompressionLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let port = std::env::var("PORT").unwrap_or("3439".into());
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse().unwrap();
    db::init().await;

    let app = Router::new()
        .route("/", get(api::root))
        .route("/healthz", get(api::healthz))
        // Read endpoints (POST with query params)
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
        .route("/login", get(web::login_page))
        .route("/login", post(web::login_submit))
        .route("/dashboard", get(web::dashboard))
        .route("/terms", get(web::terms))
        .route("/privacy", get(web::privacy))
        .route("/companies", get(pages::companies))
        .route("/projects", get(pages::projects))
        .route("/projects/{pid}", get(pages::project_detail))
        .route("/projects/{pid}/kb", get(pages::kb))
        .route("/projects/{pid}/questions", get(pages::questions))
        .route("/projects/{pid}/articles", get(pages::articles))
        .route("/projects/{pid}/monitor", get(pages::monitor))
        .route("/monitor/{tid}", get(pages::monitor_detail))
        .route("/projects/{pid}/sources", get(pages::sources))
        .route("/projects/{pid}/reports", get(pages::reports))
        .route("/api/open/v1/plan/companies.create", post(ops::create_company))
        .route("/api/open/v1/plan/projects.create", post(ops::create_project))
        .route("/api/open/v1/plan/questions.create", post(ops::create_question))
        .route("/api/open/v1/plan/knowledge.uploadDoc", post(ops::upload_kb_doc))
        .route("/api/open/v1/plan/articles.create", post(ops::create_article))
        .route("/api/open/v1/plan/articles.audit", post(ops::audit_article))
        .route("/api/open/v1/plan/monitorTasks.create", post(ops::create_monitor))
        .route("/api/open/v1/plan/licenses.generate", post(ops::generate_license))
        .layer(CompressionLayer::new());

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!(port = port, "GEO Platform (Rust) started");
    axum::serve(listener, app).await.unwrap();
}
