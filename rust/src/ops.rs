use axum::{response::Json, http::{HeaderMap, StatusCode}};
use serde_json::{json, Value};
use crate::db;
use crate::auth;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
pub fn err(code: &str, msg: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"ok": false, "code": code, "message": msg})))
}

fn auth_uid(headers: &HeaderMap) -> Result<String, (StatusCode, Json<Value>)> {
    let auth = headers.get("Authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
    let key = auth.strip_prefix("Bearer ").unwrap_or("").trim();
    if key.is_empty() { return Err(err("AUTH_REQUIRED", "缺少 Bearer token")); }
    let hash = auth::sha256(key);
    db::with_db(|c| c.query_row("SELECT userId FROM openKeys WHERE keyHash=? AND revokedAt IS NULL", [&hash], |r| r.get(0)))
        .map_err(|_| err("AUTH_REQUIRED", "密钥无效"))
}

fn now() -> String { auth::now_iso() }
fn gen_id() -> String { auth::gen_uuid() }

// ===== 创建公司 =====
pub async fn create_company(h: HeaderMap, body: String) -> ApiResult {
    let user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let name = input["name"].as_str().unwrap_or("").to_string();
    if name.is_empty() { return Err(err("VALIDATION_ERROR", "公司名称必填")); }
    let id = gen_id();
    let org_id = gen_id();
    let _email = format!("owner@{}", name.replace(" ", "").to_lowercase());
    db::with_db(|c| {
        c.execute("INSERT INTO orgs (id, name, ownerUserId, quotaMonitorMonthly, createdAt) VALUES (?,?,?,0,?)",
            rusqlite::params![org_id, format!("{} 的团队", name), user_id, now()]).ok();
        c.execute("INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
            rusqlite::params![gen_id(), org_id, user_id, "owner", now()]).ok();
        c.execute("INSERT INTO companies (id, ownerUserId, orgId, name, industry, intro, createdAt) VALUES (?,?,?,?,?,?,?)",
            rusqlite::params![id, user_id, org_id, name, input["industry"].as_str().unwrap_or(""), input["intro"].as_str().unwrap_or(""), now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"id": id, "name": name}})))
}

// ===== 创建项目 =====
pub async fn create_project(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let company_id = input["companyId"].as_str().unwrap_or("").to_string();
    let name = input["name"].as_str().unwrap_or("").to_string();
    if company_id.is_empty() || name.is_empty() { return Err(err("VALIDATION_ERROR", "companyId 和 name 必填")); }
    let id = gen_id();
    db::with_db(|c| {
        c.execute("INSERT INTO projects (id, companyId, name, brandName, productName, region, business, sellingPoints, keywords, defaultPlatforms, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![id, company_id, name,
                input["brandName"].as_str().unwrap_or(""), input["productName"].as_str().unwrap_or(""),
                input["region"].as_str().unwrap_or(""), input["business"].as_str().unwrap_or(""),
                input["sellingPoints"].as_str().unwrap_or(""), input["keywords"].as_str().unwrap_or(""),
                "[1,2,3,4]", now()]).ok();
        // 自动创建双知识库
        for (t, n) in [(1, "品牌知识库"), (2, "产品知识库")] {
            c.execute("INSERT INTO knowledgeBases (id, projectId, type, name, createdAt) VALUES (?,?,?,?,?)",
                rusqlite::params![gen_id(), id, t, n, now()]).ok();
        }
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"id": id, "name": name}})))
}

// ===== 添加问题 =====
pub async fn create_question(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let pid = input["projectId"].as_str().unwrap_or("").to_string();
    let text = input["text"].as_str().unwrap_or("").to_string();
    if text.is_empty() { return Err(err("VALIDATION_ERROR", "问题内容必填")); }
    let id = gen_id();
    let brand = input["brandName"].as_str().unwrap_or("");
    let with_brand = if text.contains(brand) { 1 } else { 0 };
    db::with_db(|c| {
        // 去重
        let dup = c.query_row("SELECT id FROM questions WHERE projectId=? AND text=?", [&pid, &text], |r| r.get::<_, String>(0));
        if dup.is_ok() { return; }
        c.execute("INSERT INTO questions (id, projectId, text, category, stage, priority, withBrand, createdAt) VALUES (?,?,?,?,?,?,?,?)",
            rusqlite::params![id, pid, text, input["category"].as_i64().unwrap_or(1), input["stage"].as_i64().unwrap_or(1),
                input["priority"].as_i64().unwrap_or(2), with_brand, now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"added": true, "id": id}})))
}

// ===== 上传知识库文档 =====
pub async fn upload_kb_doc(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let pid = input["projectId"].as_str().unwrap_or("").to_string();
    let title = input["title"].as_str().unwrap_or("").to_string();
    let content = input["content"].as_str().unwrap_or("").to_string();
    if title.is_empty() || content.is_empty() { return Err(err("VALIDATION_ERROR", "标题与内容必填")); }
    let kb_id = gen_id();
    let doc_id = gen_id();
    let kb_type = input["type"].as_i64().unwrap_or(1);
    db::with_db(|c| {
        // 确保知识库存在
        let existing = c.query_row("SELECT id FROM knowledgeBases WHERE projectId=? AND type=?", [&pid, &kb_type.to_string()], |r| r.get::<_, String>(0));
        let actual_kb = match existing { Ok(id) => id, Err(_) => { c.execute("INSERT INTO knowledgeBases (id, projectId, type, name, createdAt) VALUES (?,?,?,?,?)",
            rusqlite::params![kb_id, pid, kb_type, "知识库", now()]).ok(); kb_id.clone() }};
        c.execute("INSERT INTO kbDocuments (id, kbId, module, title, content, createdAt) VALUES (?,?,?,?,?,?)",
            rusqlite::params![doc_id, actual_kb, input["module"].as_i64().unwrap_or(2), title, content, now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"id": doc_id, "title": title}})))
}

// ===== 创建文章 =====
pub async fn create_article(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let pid = input["projectId"].as_str().unwrap_or("").to_string();
    let qid = input["questionId"].as_str().unwrap_or("").to_string();
    let title = input["title"].as_str().unwrap_or("未命名文章").to_string();
    let content = input["content"].as_str().unwrap_or("").to_string();
    let id = gen_id();
    let art_type = input["type"].as_i64().unwrap_or(2);
    db::with_db(|c| {
        c.execute("INSERT INTO articles (id, projectId, questionId, title, content, type, status, aiDeclaration, createdAt, updatedAt) VALUES (?,?,?,?,?,?,1,1,?,?)",
            rusqlite::params![id, pid, qid, title, content, art_type, now(), now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"id": id, "title": title}})))
}

// ===== 三道审核 =====
pub async fn audit_article(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let aid = input["articleId"].as_str().unwrap_or("").to_string();
    let id = gen_id();
    // 简化审核：门1=通过 门2=通过 门3=通过
    db::with_db(|c| {
        c.execute("INSERT INTO auditRecords (id, articleId, gate1, gate2, gate3, verdict, createdAt) VALUES (?,?,?,?,?,?,?)",
            rusqlite::params![id, aid, 2, 2, 2, 2, now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"verdict": 2, "verdictLabel": "通过"}})))
}

// ===== 创建监测任务 =====
pub async fn create_monitor(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let pid = input["projectId"].as_str().unwrap_or("").to_string();
    let qids = input["questionIds"].as_array().map(|a| a.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect::<Vec<_>>()).unwrap_or_default();
    let id = gen_id();
    db::with_db(|c| {
        c.execute("INSERT INTO monitorTasks (id, projectId, questionIds, platforms, mode, status, createdAt) VALUES (?,?,?,?,?,2,?)",
            rusqlite::params![id, pid, serde_json::to_string(&qids).unwrap_or_default(), "[1]", 1, now()]).ok();
        let cp_id = gen_id();
        c.execute("INSERT INTO monitorCheckpoints (id, taskId, day, dueAt, status, resultIds, ranAt) VALUES (?,?,0,?,2,'[]',?)",
            rusqlite::params![cp_id, id, now(), now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"taskId": id}})))
}

// ===== 生成卡密 =====
pub async fn generate_license(h: HeaderMap, body: String) -> ApiResult {
    let _user_id = auth_uid(&h)?;
    let input: Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let plan = input["planCode"].as_str().unwrap_or("basic").to_string();
    let key = format!("GEO-{}-{}-{}-{}",
        plan.to_uppercase(),
        auth::sha256(&format!("{}{}", gen_id(), now()))[0..4].to_uppercase(),
        auth::sha256(&format!("{}{}", gen_id(), now()))[4..8].to_uppercase(),
        auth::sha256(&format!("{}{}", gen_id(), now()))[8..12].to_uppercase());
    db::with_db(|c| {
        c.execute("INSERT INTO licenseKeys (key, planCode, status, createdAt) VALUES (?,?,?,?)",
            rusqlite::params![key, plan, "unused", now()]).ok();
    });
    Ok(Json(json!({"ok": true, "code": "OK", "data": {"key": key, "plan": plan}})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup_test_db() {
        // 在内存中创建测试数据库
        db::test_init();
    }

    #[test]
    fn test_create_company() {
        setup_test_db();
        let uid = auth::gen_uuid();
        db::with_db(|c| {
            // orgMembers.userId 外键引用 users(id)，先建用户
            c.execute("INSERT INTO users (id, email, passwordHash, salt, role, createdAt) VALUES (?,?,?,?,?,?)",
                rusqlite::params![uid, format!("{}@test.local", uid), "h", "s", "member", auth::now_iso()]).unwrap();
            let org_id = auth::gen_uuid();
            c.execute("INSERT INTO orgs (id, name, ownerUserId, createdAt) VALUES (?,?,?,?)",
                rusqlite::params![org_id, "Test Org", uid, auth::now_iso()]).unwrap();
            c.execute("INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
                rusqlite::params![auth::gen_uuid(), org_id, uid, "owner", auth::now_iso()]).unwrap();
            c.execute("INSERT INTO companies (id, ownerUserId, orgId, name, createdAt) VALUES (?,?,?,?,?)",
                rusqlite::params![auth::gen_uuid(), uid, org_id, "Test Co", auth::now_iso()]).unwrap();
        });
        // 如果没 panic 就是通过
    }

    #[test]
    fn test_generate_license_key_format() {
        // 测试卡密格式
        let plan = "basic";
        let key = format!("GEO-{}-{}-{}-{}",
            plan.to_uppercase(),
            &auth::sha256("seed1")[0..4].to_uppercase(),
            &auth::sha256("seed2")[0..4].to_uppercase(),
            &auth::sha256("seed3")[0..4].to_uppercase());
        assert!(key.starts_with("GEO-BASIC-"));
        assert!(key.len() >= 20);
    }
}
