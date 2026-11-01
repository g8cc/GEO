use axum::{response::Json, http::{HeaderMap, StatusCode}};
use serde_json::{json, Value};
use crate::db;
use crate::auth;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

pub fn ok(data: Value) -> Json<Value> { Json(json!({"ok": true, "code": "OK", "data": data})) }
pub fn err(code: &str, msg: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"ok": false, "code": code, "message": msg})))
}

pub fn auth_key(headers: &HeaderMap) -> Result<String, (StatusCode, Json<Value>)> {
    let auth = headers.get("Authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
    let key = auth.strip_prefix("Bearer ").unwrap_or("").trim();
    if key.is_empty() { return Err(err("AUTH_REQUIRED", "缺少 Bearer token")); }
    let hash = auth::sha256(key);
    let uid = db::with_db(|c| {
        c.query_row("SELECT userId FROM openKeys WHERE keyHash=? AND revokedAt IS NULL", [&hash], |r| r.get::<_, String>(0))
    });
    uid.map_err(|_| err("AUTH_REQUIRED", "密钥无效"))
}

fn query_list(sql: &str, pid: &str, cols: &[&str]) -> Vec<Value> {
    db::with_db(|c| {
        let mut stmt = match c.prepare(sql) { Ok(s) => s, Err(_) => return vec![] };
        let rows = match stmt.query_map([pid], |row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in cols.iter().enumerate() {
                let v: Option<String> = row.get(i).ok().flatten();
                obj.insert(col.to_string(), json!(v));
            }
            Ok(Value::Object(obj))
        }) { Ok(r) => r, Err(_) => return vec![] };
        rows.filter_map(|r| r.ok()).collect()
    })
}

// ===== handlers =====
pub async fn healthz() -> Json<Value> { Json(json!({"ok": true})) }
pub async fn capabilities() -> Json<Value> {
    let caps = ["projects.list","projects.create","projects.update","questions.list","questions.create",
        "questions.batchCreate","questions.generate","questions.update","knowledge.list","knowledge.uploadDoc",
        "knowledge.organize","articles.list","articles.get","articles.create","articles.update","articles.delete",
        "articles.audit","preflight.check","materials.list","materials.upload","accounts.list",
        "publishTasks.create","publishTasks.confirm","publishTasks.list","publishTasks.get","publishTasks.markPublished",
        "monitorTasks.create","monitorTasks.list","monitorTasks.get","monitorTasks.runNext",
        "monitorResults.list","monitorResults.reverse","sources.list","sources.collect","sources.upsert",
        "reports.create","reports.list","reports.get","reputation.create","auto-geo.run"];
    ok(json!({"capabilities": caps.iter().map(|c| json!({"name": c, "mode": "read"})).collect::<Vec<_>>(), "version": "1.6.0"}))
}

pub async fn projects_list(h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let rows = query_list(
        "SELECT p.id as id, p.name as name, p.brandName as brandName FROM projects p JOIN companies c ON p.companyId=c.id JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=(SELECT userId FROM openKeys WHERE keyHash=(SELECT keyHash FROM openKeys LIMIT 1)) ORDER BY p.createdAt DESC",
        "", &["id","name","brandName"]);
    Ok(ok(json!(rows)))
}

pub async fn questions_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, text as text, category as category, priority as priority, status as status FROM questions WHERE projectId=? ORDER BY priority, createdAt", &pid, &["id","text","category","priority","status"]);
    Ok(ok(json!(rows)))
}

pub async fn articles_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, title as title, type as type, status as status FROM articles WHERE projectId=? ORDER BY createdAt DESC", &pid, &["id","title","type","status"]);
    Ok(ok(json!(rows)))
}

pub async fn monitor_tasks_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, status as status, mode as mode FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC", &pid, &["id","status","mode"]);
    Ok(ok(json!(rows)))
}

pub async fn monitor_results_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, answerText as answerText, brandMentioned as brandMentioned, hitStatus as hitStatus, dataSource as dataSource FROM monitorResults WHERE projectId=? ORDER BY ranAt DESC", &pid, &["id","answerText","brandMentioned","hitStatus","dataSource"]);
    Ok(ok(json!(rows)))
}

pub async fn sources_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, articleTitle as articleTitle, url as url, status as status FROM sourceAssets WHERE projectId=? ORDER BY updatedAt DESC", &pid, &["id","articleTitle","url","status"]);
    Ok(ok(json!(rows)))
}

pub async fn reports_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, title as title, type as type FROM reports WHERE projectId=? ORDER BY createdAt DESC", &pid, &["id","title","type"]);
    Ok(ok(json!(rows)))
}

pub async fn materials_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, name as name, url as url FROM materials WHERE projectId=? ORDER BY createdAt DESC", &pid, &["id","name","url"]);
    Ok(ok(json!(rows)))
}

pub async fn accounts_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT id as id, accountName as accountName, platform as platform, quota as quota FROM publishAccounts WHERE projectId=?", &pid, &["id","accountName","platform","quota"]);
    Ok(ok(json!(rows)))
}

pub async fn knowledge_list(axum::extract::Query(p): axum::extract::Query<std::collections::HashMap<String,String>>, h: HeaderMap) -> ApiResult {
    let _ = auth_key(&h)?;
    let pid = p.get("projectId").cloned().unwrap_or_default();
    let rows = query_list("SELECT d.id as id, d.title as title, d.module as module, d.content as content FROM kbDocuments d JOIN knowledgeBases kb ON d.kbId=kb.id WHERE kb.projectId=? ORDER BY d.module", &pid, &["id","title","module","content"]);
    Ok(ok(json!(rows)))
}
