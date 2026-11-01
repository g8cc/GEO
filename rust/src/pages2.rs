use axum::response::Html;
use crate::db;
use crate::web::layout;
use crate::pages::{esc, card, table};

// ===== 系统设置 → Open Key =====
pub async fn settings_keys() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT keyPrefix, name, revokedAt FROM openKeys ORDER BY createdAt DESC LIMIT 50").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let prefix: String = row.get(0).unwrap_or_default();
            let name: String = row.get(1).unwrap_or_default();
            let revoked: Option<String> = row.get(2).ok().flatten();
            let status = if revoked.is_some() { "已吊销" } else { "有效" };
            Ok(vec![esc(&name), format!("{}…", prefix), status.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["名称", "前缀", "状态"], rows);
        card("API 密钥（Open Key）", &format!("<p>接口密钥只写入本地配置，不要发到群里或公开仓库。</p>{}", table))
    });
    Html(layout("API 密钥", &body))
}

// ===== 系统配置（服务集成）=====
pub async fn settings_config() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT key, value FROM settings ORDER BY key").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let key: String = row.get(0).unwrap_or_default();
            let val: String = row.get(1).unwrap_or_default();
            let display = if key.contains("KEY") || key.contains("SECRET") {
                if val.len() > 8 { format!("{}••••••{}", &val[..3], &val[val.len()-4..]) } else { "••••••".to_string() }
            } else { val };
            Ok(vec![esc(&key), esc(&display)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["配置项", "值"], rows);
        card("服务集成配置", &format!("<p>LLM / 监测四平台 / 图像 / 存储 / 发布模式。保存后立即生效。</p>{}", table))
    });
    Html(layout("服务集成", &body))
}

// ===== 卡密管理 =====
pub async fn licenses() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT key, planCode, status FROM licenseKeys ORDER BY createdAt DESC LIMIT 50").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let key: String = row.get(0).unwrap_or_default();
            let plan: String = row.get(1).unwrap_or_default();
            let status: String = row.get(2).unwrap_or_default();
            Ok(vec![esc(&key), esc(&plan), esc(&status)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["卡密", "套餐", "状态"], rows);
        card("卡密管理", &table)
    });
    Html(layout("卡密管理", &body))
}

// ===== 操作审计 =====
pub async fn audit_log() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT action, email, createdAt FROM auditLog ORDER BY createdAt DESC LIMIT 100").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let action: String = row.get(0).unwrap_or_default();
            let email: String = row.get(1).unwrap_or_default();
            let ts: String = row.get(2).unwrap_or_default();
            Ok(vec![esc(&ts[..20.min(ts.len())]), esc(&email), esc(&action)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["时间", "账号", "操作"], rows);
        card("操作审计日志", &table)
    });
    Html(layout("操作审计", &body))
}

// ===== 团队成员 =====
pub async fn team() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare(
            "SELECT u.email, om.role FROM orgMembers om JOIN users u ON om.userId=u.id ORDER BY om.createdAt"
        ).unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let email: String = row.get(0).unwrap_or_default();
            let role: String = row.get(1).unwrap_or_default();
            Ok(vec![esc(&email), esc(&role)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["邮箱", "角色"], rows);
        card("团队成员", &table)
    });
    Html(layout("团队成员", &body))
}

// ===== 一键 GEO =====
pub async fn auto_geo_page() -> Html<String> {
    let body = card("🚀 一键 GEO", r#"<p>粘贴你的项目文档（README/产品介绍等），AI 自动完成：知识库六模块 → 50 问 → 品牌文章 → 三道审核 → 上榜监测。</p>
<p>请使用 Node.js 版本或 CLI（<code>geo scan</code>）执行一键 GEO。</p>
<p><a href="/projects">→ 查看已有项目</a></p>"#);
    Html(layout("一键 GEO", &body))
}
