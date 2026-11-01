use axum::{response::Html, extract::{Path, Query}};
use std::collections::HashMap;
use crate::db;
use crate::auth;
use crate::web::layout;

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn card(title: &str, body: &str) -> String {
    format!("<div class='card'><h2>{}</h2>{}</div>", esc(title), body)
}

pub fn table(headers: &[&str], rows: Vec<Vec<String>>) -> String {
    if rows.is_empty() { return "<div class='empty'>暂无数据</div>".to_string(); }
    let th: Vec<String> = headers.iter().map(|h| format!("<th>{}</th>", esc(h))).collect();
    let trs: Vec<String> = rows.iter().map(|row| {
        let tds: Vec<String> = row.iter().map(|td| format!("<td>{}</td>", td)).collect();
        format!("<tr>{}</tr>", tds.join(""))
    }).collect();
    format!("<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>", th.join(""), trs.join(""))
}

fn get_projects(conn: &rusqlite::Connection, user_id: &str) -> Vec<(String, String, String, String)> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.brandName, p.business FROM projects p JOIN companies c ON p.companyId=c.id JOIN orgMembers om ON om.orgId=c.orgId AND om.userId=? ORDER BY p.createdAt DESC"
    ).unwrap_or_else(|_| panic!("query"));
    let rows = stmt.query_map([user_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2).unwrap_or_default(), row.get::<_, String>(3).unwrap_or_default()))
    }).unwrap_or_else(|_| panic!("map"));
    rows.filter_map(|r| r.ok()).collect()
}

// ===== 公司管理 =====
pub async fn companies() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT id, name, industry FROM companies ORDER BY createdAt DESC").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            Ok(vec![row.get(0).unwrap_or_default(), row.get(1).unwrap_or_default(), row.get(2).unwrap_or_default()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["名称", "行业"], rows);
        card("公司管理", &format!("<p><a href='/projects'>→ GEO 项目</a></p>{}", table))
    });
    Html(layout("公司管理", &body))
}

// ===== 项目列表 =====
pub async fn projects() -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT id, name, brandName, business FROM projects ORDER BY createdAt DESC").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
            let id: String = row.get(0).unwrap_or_default();
            let name: String = row.get(1).unwrap_or_default();
            let brand: String = row.get(2).unwrap_or_default();
            let biz: String = row.get(3).unwrap_or_default();
            Ok(vec![format!("<a href='/projects/{}'>{}</a>", esc(&id), esc(&name)), esc(&brand), esc(&biz)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["项目名", "品牌", "业务"], rows);
        card("GEO 项目", &table)
    });
    Html(layout("GEO 项目", &body))
}

// ===== 项目概览 =====
pub async fn project_detail(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let name: String = c.query_row("SELECT name FROM projects WHERE id=?", [&pid], |r| r.get(0)).unwrap_or_default();
        let kb = c.query_row("SELECT COUNT(*) FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)", [&pid], |r| r.get::<_, i32>(0)).unwrap_or(0);
        let qs = c.query_row("SELECT COUNT(*) FROM questions WHERE projectId=?", [&pid], |r| r.get::<_, i32>(0)).unwrap_or(0);
        let arts = c.query_row("SELECT COUNT(*) FROM articles WHERE projectId=?", [&pid], |r| r.get::<_, i32>(0)).unwrap_or(0);
        let mons = c.query_row("SELECT COUNT(*) FROM monitorTasks WHERE projectId=?", [&pid], |r| r.get::<_, i32>(0)).unwrap_or(0);
        format!(
            "<div class='card'><h2>{}</h2><table><tr><td>知识库文档</td><td>问题</td><td>文章</td><td>监测任务</td></tr><tr><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td></tr></table></div>",
            esc(&name), kb, qs, arts, mons
        )
    });
    Html(layout("项目概览", &body))
}

// ===== 知识库 =====
pub async fn kb(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare(
            "SELECT d.title, d.module, d.content, d.pending FROM kbDocuments d JOIN knowledgeBases kb ON d.kbId=kb.id WHERE kb.projectId=? AND kb.type=1 ORDER BY d.module"
        ).unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let title: String = row.get(0).unwrap_or_default();
            let module: i32 = row.get(1).unwrap_or(0);
            let content: String = row.get(2).unwrap_or_default();
            let pending: String = row.get(3).unwrap_or_default();
            let status = if pending.is_empty() { "<span style='color:green'>✓</span>" } else { "<span style='color:orange'>⏳</span>" };
            let short = if content.len() > 100 { let cut = content.char_indices().nth(100).map(|(i,_)| i).unwrap_or(content.len()); format!("{}\u{2026}", &content[..cut]) } else { content.clone() };
            Ok(vec![format!("{}", module), esc(&title), esc(&short), status.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["模块", "标题", "内容", "状态"], rows);
        card("品牌知识库（六模块）", &table)
    });
    Html(layout("知识库", &body))
}

// ===== 问题库 =====
pub async fn questions(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT text, category, priority, status FROM questions WHERE projectId=? ORDER BY priority, createdAt LIMIT 50").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let text: String = row.get(0).unwrap_or_default();
            let cat: i32 = row.get(1).unwrap_or(0);
            let pri: i32 = row.get(2).unwrap_or(0);
            let status: i32 = row.get(3).unwrap_or(0);
            Ok(vec![esc(&text), format!("{}", cat), format!("P{}", pri), format!("{}", status)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["问题", "类型", "优先级", "状态"], rows);
        card("问题池", &table)
    });
    Html(layout("问题库", &body))
}

// ===== 文章管理 =====
pub async fn articles(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT id, title, status FROM articles WHERE projectId=? ORDER BY createdAt DESC").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let title: String = row.get(1).unwrap_or_default();
            let status: i32 = row.get(2).unwrap_or(0);
            let status_text = ["已生成", "已上传", "已创建发布任务", "已正式发布"][status as usize % 4];
            Ok(vec![esc(&title), status_text.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["标题", "状态"], rows);
        card("文章管理", &table)
    });
    Html(layout("文章管理", &body))
}

// ===== 上榜监测 =====
pub async fn monitor(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT id, status FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let id: String = row.get(0).unwrap_or_default();
            let status: i32 = row.get(1).unwrap_or(0);
            let status_text = ["排队", "运行中", "完成", "失败"][status as usize % 4];
            Ok(vec![format!("<a href='/monitor/{}'>{}</a>", esc(&id), id[..8].to_string()), status_text.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["任务", "状态"], rows);
        card("上榜监测", &table)
    });
    Html(layout("上榜监测", &body))
}

// ===== 监测结果 =====
pub async fn monitor_detail(Path(tid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT answerText, brandMentioned, hitStatus, dataSource FROM monitorResults WHERE taskId=? ORDER BY ranAt").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&tid], |row| {
            let ans: String = row.get(0).unwrap_or_default();
            let mentioned: i32 = row.get(1).unwrap_or(0);
            let hit: i32 = row.get(2).unwrap_or(0);
            let src: String = row.get(3).unwrap_or_default();
            let hit_text = ["待复测", "未命中", "弱命中", "精准命中"][hit as usize % 4];
            let short = if ans.len() > 200 { let cut = ans.char_indices().nth(200).map(|(i,_)| i).unwrap_or(ans.len()); format!("{}\u{2026}", &ans[..cut]) } else { ans.clone() };
            let brand_text = if mentioned == 1 { "✅" } else { "❌" };
            Ok(vec![esc(&short), brand_text.to_string(), hit_text.to_string(), esc(&src)])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["AI 回答", "品牌", "命中状态", "数据来源"], rows);
        card("监测结果", &table)
    });
    Html(layout("监测结果", &body))
}

// ===== 信源资产 =====
pub async fn sources(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT articleTitle, url, status FROM sourceAssets WHERE projectId=? ORDER BY updatedAt DESC LIMIT 50").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let title: String = row.get(0).unwrap_or_default();
            let url: String = row.get(1).unwrap_or_default();
            let status: i32 = row.get(2).unwrap_or(0);
            let status_text = ["已引用", "潜在", "可投放", "观察"][status as usize % 4];
            Ok(vec![esc(&title), esc(&url), status_text.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["标题", "URL", "状态"], rows);
        card("信源资产", &table)
    });
    Html(layout("信源资产", &body))
}

// ===== 报告 =====
pub async fn reports(Path(pid): Path<String>) -> Html<String> {
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT title, type FROM reports WHERE projectId=? ORDER BY createdAt DESC").unwrap();
        let rows: Vec<Vec<String>> = stmt.query_map([&pid], |row| {
            let title: String = row.get(0).unwrap_or_default();
            let rtype: i32 = row.get(1).unwrap_or(0);
            let type_text = ["品牌诊断", "产品诊断", "对比", "逆向", "一页纸", "口碑"][rtype as usize % 6];
            Ok(vec![esc(&title), type_text.to_string()])
        }).unwrap().filter_map(|r| r.ok()).collect();
        let table = table(&["报告", "类型"], rows);
        card("诊断报告", &table)
    });
    Html(layout("诊断报告", &body))
}
