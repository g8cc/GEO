// Goal-W3 页面：内容创作 / 文章管理 / 文章详情 / 资源中心 / 授权账号 / 内容发布 / 上榜监测 / 收录站点 / 付费媒体
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::response::Response;
use std::collections::HashMap;

use crate::auth;
use crate::db;
use crate::mock;
use crate::ui::{badge, card, empty, empty_cta, enum_options, esc, fmt_time, label, label_badge, page_head, safe_url, sel, table_raw, ACCOUNT_AUTH_STATUS, ACCOUNT_TYPE, ARTICLE_STATUS, ARTICLE_TYPE, AUDIT_GATE, AUDIT_VERDICT, AI_PLATFORM, HIT_STATUS, MATERIAL_TYPE, MONITOR_MODE, MONITOR_TASK_STATUS, PUBLISH_PLATFORM, PUBLISH_TASK_STATUS, RECOMMEND_LEVEL};
use crate::web::{redirect, redirect_q, require_project, require_user, Fb};

// ============ 内容创作 ============
pub async fn content(headers: HeaderMap, Path(pid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let preflight_qid = q.get("preflight").cloned().unwrap_or_default();
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT id, text FROM questions WHERE projectId=? ORDER BY priority, createdAt DESC")
            .unwrap();
        let questions: Vec<(String, String)> = stmt
            .query_map([&pid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let q_opts: Vec<(String, String)> = questions.iter().map(|(i, t)| (i.clone(), t.clone())).collect();

        let mut preflight_html = String::new();
        if !preflight_qid.is_empty() {
            let items = mock::preflight(c, &pid, &preflight_qid);
            let rows: Vec<String> = items
                .iter()
                .map(|(item, status, detail)| {
                    let b = match status.as_str() {
                        "已具备" => badge("通过"),
                        "不可使用" => badge("不通过"),
                        _ => badge("待复测"),
                    };
                    format!(
                        "<tr><td class=\"wrap\">{}</td><td>{} <span class=\"kv\">{}</span></td><td class=\"wrap kv\">{}</td></tr>",
                        esc(item),
                        b,
                        esc(status),
                        esc(detail)
                    )
                })
                .collect();
            preflight_html = card(
                "创作前输入检查（已具备 / 待补充 / 不可使用）",
                &table_raw(&["检查项", "结果", "说明"], &rows.join(""), ""),
            );
        }

        let main_card = if questions.is_empty() {
            card("选择问题与内容类型", "<div class=\"notice warn\">请先在「问题拓展」建立问题库</div>")
        } else {
            card(
                "选择问题与内容类型",
                &format!(
                    r#"<form method="get" action="/projects/{pid}/content">
        <div class="row">
          <div style="flex:2"><label class="f">目标问题 *</label>{preflight_sel}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">创作前输入检查</button></div>
        </div>
      </form>
      <form method="post" action="/projects/{pid}/content/create" style="margin-top:14px">
        <div class="row">
          <div style="flex:2"><label class="f">目标问题 *</label>{qid_sel}</div>
          <div><label class="f">内容类型 *</label>{type_sel}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn">生成内容 + 封面</button></div>
        </div>
        <label class="f" style="font-weight:400;margin-top:10px"><input type="checkbox" name="aiDeclaration" value="1" checked style="width:auto"> 按《人工智能生成合成内容标识办法》在发布包中携带 AI 生成声明（推荐保持勾选）</label>
        <div class="kv" style="margin-top:8px">生成后进入「文章管理」完成三道审核，再创建发布任务。答案卡图片需按平台要求手动发布到抖音图文。</div>
      </form>"#,
                    pid = esc(&pid),
                    preflight_sel = sel("preflight", &q_opts, &preflight_qid, "— 选择问题 —", false),
                    qid_sel = sel("questionId", &q_opts, "", "— 选择问题 —", true),
                    type_sel = sel("type", &[(1.to_string(), "AI 答案卡".into()), (2.to_string(), "品牌优化文章".into()), (3.to_string(), "产品推荐文章".into())], "2", "", false),
                ),
            )
        };
        page_head(
            "内容创作",
            "三类内容资产：AI 答案卡（结论先行）/ 品牌优化文章（身份、能力、案例、证据、边界）/ 产品推荐文章（场景、条件、差异、限制、行动入口）",
            "",
        ) + &main_card + &preflight_html
    });
    crate::web::user_page(&u, "内容创作", "content", &pid, "", &body)
}

pub async fn content_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let qid = fb.get("questionId");
    if qid.is_empty() {
        return redirect_q(&format!("/projects/{}/content", pid), &[("e", "请先选择一个目标问题")]);
    }
    let ctype = fb.opt_i("type").unwrap_or(2);
    let result = db::with_db(|c| mock::create_content(c, &pid, &qid, ctype));
    match result {
        Ok((aid, _title)) => {
            crate::web::audit_log(Some(&u.id), &u.email, "content.create", &aid, &crate::web::client_ip(&headers));
            redirect(&format!("/articles/{}", aid))
        }
        Err(e) => redirect_q(&format!("/projects/{}/content", pid), &[("e", &e)]),
    }
}

// ============ 文章管理 ============
pub async fn articles(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT id, title, type, status, createdAt FROM articles WHERE projectId=? ORDER BY createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&pid], |r| {
                let (id, title, atype, status, created): (String, String, i64, i64, String) =
                    (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
                Ok(format!(
                    "<tr><td class=\"wrap\"><a href=\"/articles/{}\"><b>{}</b></a></td><td>{}</td><td>{}</td><td>{}</td><td><a class=\"btn small\" href=\"/articles/{}\">查看</a></td></tr>",
                    esc(&id),
                    esc(&title),
                    label_badge(ARTICLE_TYPE, atype),
                    label_badge(ARTICLE_STATUS, status),
                    fmt_time(&created),
                    esc(&id)
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        page_head("文章管理", "状态机：已生成 → 已上传 → 已创建发布任务 → 已正式发布。文章 ID ≠ 已发布。", "")
            + &card("文章列表", &table_raw(&["标题", "类型", "状态", "创建时间", ""], &rows.join(""), ""))
    });
    crate::web::user_page(&u, "文章管理", "articles", &pid, "", &body)
}

// ============ 文章详情（三道审核 + 发布记录） ============
pub async fn article_detail(headers: HeaderMap, Path(aid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row(
            "SELECT id, projectId, title, content, type, status, coverMaterialId, meta, createdAt FROM articles WHERE id=?",
            [&aid],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    r.get::<_, String>(8)?,
                ))
            },
        )
        .ok()
    });
    let (aid, pid, title, content, atype, status, cover_id, meta_raw, created) = match row {
        Some(x) => x,
        None => return crate::web::html404(),
    };
    if !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }

    let body = db::with_db(|c| {
        let meta: serde_json::Value = serde_json::from_str(&meta_raw).unwrap_or(serde_json::json!({}));
        let cover_url: Option<String> = cover_id.and_then(|cid| c.query_row("SELECT url FROM materials WHERE id=?", [cid], |r| r.get(0)).ok());
        // 审核记录
        let mut stmt = c
            .prepare("SELECT createdAt, gate1, gate1Issues, gate2, gate2Issues, gate3, gate3Issues, verdict, auditor FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC")
            .unwrap();
        let audit_rows: Vec<String> = stmt
            .query_map([&aid], |r| {
                let (ts, g1, i1, g2, i2, g3, i3, verdict, auditor): (String, i64, String, i64, String, i64, String, i64, String) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                );
                Ok(format!(
                    "<tr><td>{ts}</td><td>{g1b}<div class=\"kv wrap\">{i1}</div></td><td>{g2b}<div class=\"kv wrap\">{i2}</div></td><td>{g3b}<div class=\"kv wrap\">{i3}</div></td><td>{vb}</td><td class=\"kv\">{aud}</td></tr>",
                    ts = fmt_time(&ts),
                    g1b = label_badge(AUDIT_GATE, g1),
                    i1 = esc(&i1),
                    g2b = label_badge(AUDIT_GATE, g2),
                    i2 = esc(&i2),
                    g3b = label_badge(AUDIT_GATE, g3),
                    i3 = esc(&i3),
                    vb = label_badge(AUDIT_VERDICT, verdict),
                    aud = esc(&auditor),
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        // 发布任务
        let mut stmt = c
            .prepare("SELECT createdAt, platform, status, publishedUrl, failReason FROM publishTasks WHERE articleId=? ORDER BY createdAt DESC")
            .unwrap();
        let pub_rows: Vec<String> = stmt
            .query_map([&aid], |r| {
                let (ts, plat, st, url, fail): (String, i64, i64, Option<String>, Option<String>) =
                    (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
                Ok(format!(
                    "<tr><td>{ts}</td><td>{plat_b}</td><td>{st_b}{fail}</td><td>{url}</td></tr>",
                    ts = fmt_time(&ts),
                    plat_b = label_badge(PUBLISH_PLATFORM, plat),
                    st_b = label_badge(PUBLISH_TASK_STATUS, st),
                    fail = fail.map(|f| format!("<div class=\"kv\">{}", esc(&f))).unwrap_or_default(),
                    url = url.map(|u2| format!("<a href=\"{}\" class=\"mono\">{}</a>", safe_url(&u2), esc(&u2))).unwrap_or_else(|| "—".to_string()),
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();

        let r3note = {
            let latest_verdict: Option<i64> = c.query_row("SELECT verdict FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC LIMIT 1", [&aid], |r| r.get(0)).ok();
            match latest_verdict {
                Some(2) => "<div class=\"notice\">✅ 三道审核全部通过，可进入发布流程。</div>".to_string(),
                Some(_) => "<div class=\"notice warn\">⚠️ 审核未全通过：事实缺口 → 回知识库补证；相关性不足 → 重写问题和答案结构；媒体标准不合格 → 按目标平台重新编辑。</div>".to_string(),
                None => String::new(),
            }
        };

        page_head(
            &title,
            &format!("{} · {}", label(ARTICLE_TYPE, atype), badge(label(ARTICLE_STATUS, status).as_str())),
            &format!("<a class=\"btn ghost\" href=\"/projects/{}/articles\">返回列表</a>", esc(&pid)),
        )
            + &cover_url
                .map(|u2| card("封面配图", &format!("<img src=\"{}\" style=\"max-width:420px;border-radius:10px;border:1px solid var(--line)\">", safe_url(&u2))))
                .unwrap_or_default()
            + &card(
                "正文",
                &format!(
                    "<div class=\"md-box md\">{}</div>{}",
                    esc(&content),
                    meta["question"].as_str().map(|q| format!("<div class=\"kv\" style=\"margin-top:8px\">目标问题：{}</div>", esc(q))).unwrap_or_default()
                ),
            )
            + &card(
                "三道审核（知识库一致性 / 媒体投稿标准 / GEO 相关性与可信度）",
                &(table_raw(
                    &["时间", "第一关 知识库一致性", "第二关 媒体投稿标准", "第三关 GEO 相关性与可信度", "总体", "审核人"],
                    &audit_rows.join(""),
                    &empty("尚未审核"),
                ) + &r3note
                    + &format!(
                        "<form method=\"post\" action=\"/articles/{}/audit\" style=\"margin-top:10px\"><button class=\"btn\">执行三道审核</button><span class=\"kv\">　任何一道不通过，都不应直接进入重点投放；事实缺口先回知识库补证。</span></form>",
                        esc(&aid)
                    )),
            )
            + &card(
                "发布记录",
                &table_raw(&["时间", "平台", "状态", "正式链接"], &pub_rows.join(""), &empty("尚未创建发布任务")),
            )
            + &format!("<div class=\"kv\" style=\"margin-bottom:14px\">创建时间：{}</div>", fmt_time(&created))
    });
    crate::web::user_page(&u, "文章详情", "articles", &pid, "", &body)
}

pub async fn article_audit(headers: HeaderMap, Path(aid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM articles WHERE id=?", [&aid], |r| r.get(0)).unwrap_or_default());
    if pid.is_empty() || !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    let verdict = db::with_db(|c| mock::audit_article(c, &aid, "Web 手动审核").map(|a| a.verdict)).unwrap_or(-1);
    crate::web::audit_log(Some(&u.id), &u.email, "articles.audit", &format!("{} verdict={}", aid, verdict), &crate::web::client_ip(&headers));
    redirect(&format!("/articles/{}", aid))
}

// ============ 资源中心 ============
pub async fn materials(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT name, type, url, createdAt FROM materials WHERE projectId=? ORDER BY createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&pid], |r| {
                let (name, mtype, url, created): (String, i64, String, String) = (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?);
                let preview = if mtype == 1 {
                    format!("<img src=\"{}\" style=\"height:56px;border-radius:6px;border:1px solid var(--line)\">", safe_url(&url))
                } else {
                    format!("<a href=\"{}\">{}</a>", safe_url(&url), esc(&url))
                };
                Ok(format!(
                    "<tr><td class=\"wrap\">{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                    esc(&name),
                    label_badge(MATERIAL_TYPE, mtype),
                    preview,
                    fmt_time(&created)
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        page_head("资源中心", "图片、视频与答案卡图组素材", "")
            + &card(
                "素材列表",
                &table_raw(
                    &["名称", "类型", "预览", "时间"],
                    &rows.join(""),
                    &empty_cta("素材库为空——文章封面会自动存入这里；也可上传图片/视频", "javascript:void(0)", "↑ 文章创作后自动生成"),
                ),
            )
    });
    crate::web::user_page(&u, "资源中心", "materials", &pid, "", &body)
}

// ============ 授权账号 ============
pub async fn accounts(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT platform, accountName, accountType, authStatus, quota FROM publishAccounts WHERE projectId=? ORDER BY createdAt")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&pid], |r| {
                let (plat, name, atype, auth_status, quota): (i64, String, i64, i64, i64) =
                    (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
                Ok(format!(
                    "<tr><td>{}</td><td><b>{}</b></td><td>{}</td><td>{}</td><td>{}</td></tr>",
                    label_badge(PUBLISH_PLATFORM, plat),
                    esc(&name),
                    label_badge(ACCOUNT_TYPE, atype),
                    label_badge(ACCOUNT_AUTH_STATUS, auth_status),
                    quota
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let plat_opts = enum_options(PUBLISH_PLATFORM);
        let atype_opts = enum_options(ACCOUNT_TYPE);
        page_head(
            "授权账号",
            "发布账号与账号类型（mock 授权）。相同平台上企业号、媒体机构号、专家号和普通用户号，可信度、内容责任和可控性都可能不同。",
            "",
        ) + &card(
            "添加授权账号（mock）",
            &format!(
                r#"<form method="post" action="/projects/{pid}/accounts/create" class="row">
        <div><label class="f">平台 *</label>{plat}</div>
        <div style="flex:2"><label class="f">账号名称 *</label><input type="text" name="accountName" required></div>
        <div><label class="f">账号类型</label>{atype}</div>
        <div><label class="f">额度</label><input type="number" name="quota" value="10"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>"#,
                pid = esc(&pid),
                plat = sel("platform", &plat_opts, "1", "", false),
                atype = sel("accountType", &atype_opts, "2", "", false),
            ),
        )
            + &card(
                "账号列表",
                &table_raw(
                    &["平台", "账号", "账号类型", "授权状态", "剩余额度"],
                    &rows.join(""),
                    &empty_cta("还没有授权账号——添加一个（mock 授权），发布需要账号和额度", "javascript:void(0)", "↑ 往上看添加表单"),
                ),
            )
    });
    crate::web::user_page(&u, "授权账号", "accounts", &pid, "", &body)
}

pub async fn accounts_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let name = fb.get("accountName");
    if !name.is_empty() {
        db::with_db(|c| {
            c.execute(
                "INSERT INTO publishAccounts (id, projectId, platform, accountName, accountType, authStatus, quota, createdAt) VALUES (?,?,?,?,?,?,?,?)",
                rusqlite::params![auth::gen_uuid(), pid, fb.opt_i("platform").unwrap_or(1), name, fb.opt_i("accountType").unwrap_or(2), 1, fb.opt_i("quota").unwrap_or(10), auth::now_iso()],
            )
            .ok();
        });
        crate::web::audit_log(Some(&u.id), &u.email, "accounts.create", &name, &crate::web::client_ip(&headers));
    }
    redirect(&format!("/projects/{}/accounts", pid))
}

// ============ 内容发布 ============
pub async fn publish(headers: HeaderMap, Path(pid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        mock::catch_up_publish(c); // mock 结算：发布中超 4 秒自动完成
        let mut stmt = c
            .prepare("SELECT id, title FROM articles WHERE projectId=? AND status>=1 ORDER BY createdAt DESC")
            .unwrap();
        let articles: Vec<(String, String)> = stmt.query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|x| x.ok()).collect();
        let mut stmt = c
            .prepare("SELECT id, accountName FROM publishAccounts WHERE projectId=? AND authStatus=1")
            .unwrap();
        let accounts: Vec<(String, String)> = stmt.query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|x| x.ok()).collect();
        let mut stmt = c
            .prepare("SELECT id, createdAt, platform, status, publishedUrl, failReason FROM publishTasks WHERE projectId=? ORDER BY createdAt DESC")
            .unwrap();
        #[allow(clippy::type_complexity)]
        let tasks: Vec<(String, String, i64, i64, Option<String>, Option<String>)> = stmt
            .query_map([&pid], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();

        let art_opts: Vec<(String, String)> = articles.iter().map(|(i, t)| (i.clone(), t.clone())).collect();
        let acc_opts: Vec<(String, String)> = accounts.iter().map(|(i, t)| (i.clone(), t.clone())).collect();
        let plat_opts = enum_options(PUBLISH_PLATFORM);

        let create_form = if articles.is_empty() || accounts.is_empty() {
            "<div class=\"notice warn\">需要至少一篇「已上传」文章和一个已授权账号。AI 答案卡图片需按平台要求手动发布到抖音图文。</div>".to_string()
        } else {
            format!(
                r#"<form method="post" action="/projects/{pid}/publish/create">
        <div class="row">
          <div style="flex:2"><label class="f">文章（需先通过三道审核）*</label>{art}</div>
          <div><label class="f">目标平台 *</label>{plat}</div>
          <div><label class="f">发布账号 *</label>{acc}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn">生成发布包预览</button></div>
        </div>
      </form>"#,
                pid = esc(&pid),
                art = sel("articleId", &art_opts, "", "— 选择文章 —", true),
                plat = sel("platform", &plat_opts, "1", "", false),
                acc = sel("accountId", &acc_opts, "", "— 选择账号 —", true),
            )
        };

        // 手动回填下拉
        let task_opts: Vec<(String, String)> = tasks
            .iter()
            .map(|(id, created, plat, status, url, _fail)| {
                let desc = format!(
                    "{} · {} · {}",
                    crate::ui::trunc(&fmt_time(created), 30).replace('\u{2026}', ""),
                    label(PUBLISH_PLATFORM, *plat),
                    if *status == 3 && url.is_some() { "已回填".to_string() } else { label(PUBLISH_TASK_STATUS, *status) }
                );
                (id.clone(), desc)
            })
            .collect();
        let mark_form = if tasks.is_empty() {
            "<div class=\"empty\">先创建发布任务</div>".to_string()
        } else {
            format!(
                r#"<div class="notice">渠道无公开 API 时（知乎、搜狐、小红书图文等）：按发布包内容到平台后台<strong>手动发布</strong>，然后把真实正式链接回填到这里——回填后参与真实监测的 exact_url_hit 判定。</div>
      <form method="post" action="/publish/mark" class="row">
        <div style="flex:2"><label class="f">发布任务</label>{tasks}</div>
        <div style="flex:2"><label class="f">真实正式 URL *</label><input type="text" name="publishedUrl" placeholder="https://www.zhihu.com/answer/…" required></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">回填并标记已发布</button></div>
      </form>"#,
                tasks = sel("taskId", &task_opts, "", "— 选择任务 —", false),
            )
        };

        let task_rows: Vec<String> = tasks
            .iter()
            .map(|(id, created, plat, status, url, fail)| {
                let ops = match status {
                    1 => format!("<form method=\"post\" action=\"/publish/{}/confirm\" class=\"inline\"><button class=\"btn small\">确认发布</button></form>", esc(id)),
                    2 => format!("<form method=\"post\" action=\"/publish/{}/refresh\" class=\"inline\"><button class=\"btn small ghost\">回查状态</button></form>", esc(id)),
                    4 => format!("<form method=\"post\" action=\"/publish/{}/retry\" class=\"inline\"><button class=\"btn small ghost\">重新发布</button></form>", esc(id)),
                    _ => String::new(),
                };
                format!(
                    "<tr><td>{ts}</td><td>{plat_b}</td><td>{st_b}</td><td>{url}</td><td>{ops}</td></tr>",
                    ts = fmt_time(created),
                    plat_b = label_badge(PUBLISH_PLATFORM, *plat),
                    st_b = label_badge(PUBLISH_TASK_STATUS, *status),
                    url = url
                        .as_ref()
                        .map(|u2| format!("<a href=\"{}\" class=\"mono\">{}</a>", safe_url(u2), esc(u2)))
                        .or_else(|| fail.as_ref().map(|f| format!("<span style=\"color:var(--bad)\">{}</span>", esc(f))))
                        .unwrap_or_else(|| "—".to_string()),
                    ops = ops,
                )
            })
            .collect();

        let mode_notice = if std::env::var("PUBLISH_MODE").as_deref() == Ok("mock") {
            "<div class=\"notice warn\">当前为演示模式（PUBLISH_MODE=mock）：发布会在几秒后模拟完成。生产请移除该变量。</div>"
        } else {
            "<div class=\"notice\">当前为真实发布流程：确认后任务进入「发布中」——渠道有 API 时由 Webhook 自动回传链接，否则请到渠道后台手动发布后使用下方「手动发布回填」。Rust 版内置 4 秒 mock 结算（回查状态触发）。</div>"
        };
        let err_html = q.get("e").map(|e| format!("<div class=\"notice warn\">{}</div>", esc(e))).unwrap_or_default();

        page_head("内容发布 / 自媒体发布", "预览 → 创建发布任务 → 人工确认 → 正式发布 → 回查 publishedUrl。发布任务是异步的。", "")
            + mode_notice
            + &err_html
            + &card("创建发布任务", &create_form)
            + &card("手动发布回填（真实渠道）", &mark_form)
            + &card(
                "发布任务",
                &table_raw(
                    &["创建时间", "平台", "状态", "正式链接 / 失败原因", "操作"],
                    &task_rows.join(""),
                    &empty_cta(
                        "还没有发布任务——先完成三道审核，然后到上方创建发布任务；渠道没有 API 时可发布后手动回填链接",
                        &format!("/projects/{}/content", esc(&pid)),
                        "去内容创作",
                    ),
                ),
            )
    });
    crate::web::user_page(&u, "内容发布", "publish", &pid, "", &body)
}

pub async fn publish_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let result = db::with_db(|c| mock::create_publish_task(c, &pid, &fb.get("articleId"), fb.opt_i("platform").unwrap_or(1), &fb.get("accountId")));
    match result {
        Ok(tid) => {
            crate::web::audit_log(Some(&u.id), &u.email, "publishTasks.create", &tid, &crate::web::client_ip(&headers));
            redirect(&format!("/publish/{}", tid))
        }
        Err(e) => redirect(&format!(
            "/projects/{}/publish?e={}",
            pid,
            e
        )),
    }
}

// ============ 发布确认清单 ============
pub async fn publish_detail(headers: HeaderMap, Path(tid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row("SELECT projectId, platform, packageJson FROM publishTasks WHERE id=?", [&tid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        })
        .ok()
    });
    let (pid, _platform, pkg_raw) = match row {
        Some(x) => x,
        None => return crate::web::html404(),
    };
    if !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    let pkg: serde_json::Value = serde_json::from_str(&pkg_raw).unwrap_or(serde_json::json!({}));
    let content = pkg["content"].as_str().unwrap_or("");
    let media: Vec<serde_json::Value> = pkg["media"].as_array().cloned().unwrap_or_default();
    let media_html = if media.is_empty() {
        "—".to_string()
    } else {
        media
            .iter()
            .map(|m| format!("<img src=\"{}\" style=\"height:60px;border-radius:6px\"> {}", safe_url(m["file"].as_str().unwrap_or("")), esc(m["note"].as_str().unwrap_or(""))))
            .collect::<Vec<_>>()
            .join("　")
    };
    let account = &pkg["account"];
    let err_html = q.get("e").map(|e| format!("<div class=\"notice warn\">{}</div>", esc(e))).unwrap_or_default();
    let body = page_head("发布确认清单（发布包）", "发布前先让我确认：文章、封面、账号、额度和发布范围", "")
        + &err_html
        + &card(
            "发布包（文档 3.6 七字段）",
            &format!(
                r#"<table>
      <tr><th>字段</th><th>内容</th></tr>
      <tr><td>1. 平台</td><td>{plat}</td></tr>
      <tr><td>2. 标题</td><td><b>{title}</b></td></tr>
      <tr><td>3. 正文</td><td><details><summary>展开正文（{clen} 字）</summary><div class="md-box md" style="margin-top:8px">{content}</div></details></td></tr>
      <tr><td>4. 图片/视频</td><td>{media}</td></tr>
      <tr><td>5. 账号</td><td>{acc_name}（{acc_type}）</td></tr>
      <tr><td>6. 链接</td><td class="kv">{ev} · {cta}</td></tr>
      <tr><td>7. 回填字段</td><td class="mono">{backfill}</td></tr>
    </table>
    <form method="post" action="/publish/{tid}/confirm" style="margin-top:14px">
      <label class="f"><input type="checkbox" required style="width:auto"> 我已核对：账号、平台、文章版本和正式链接承接方式</label>
      <div style="margin-top:8px"><button class="btn">确认并创建发布</button>
      <a class="btn ghost" href="/projects/{pid}/publish">返回</a></div>
    </form>"#,
                plat = badge(pkg["platformLabel"].as_str().unwrap_or("")),
                title = esc(pkg["title"].as_str().unwrap_or("")),
                clen = content.chars().count(),
                content = esc(content),
                media = media_html,
                acc_name = esc(account["name"].as_str().unwrap_or("未指定")),
                acc_type = esc(account["type"].as_str().unwrap_or("")),
                ev = esc(pkg["links"]["evidence"].as_str().unwrap_or("")),
                cta = esc(pkg["links"]["cta"].as_str().unwrap_or("")),
                backfill = esc(&pkg["backfill"].to_string()),
                tid = esc(&tid),
                pid = esc(&pid),
            ),
        );
    crate::web::user_page(&u, "发布确认", "publish", &pid, "", &body)
}

pub async fn publish_confirm(headers: HeaderMap, Path(tid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default());
    if pid.is_empty() || !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    let result = db::with_db(|c| mock::confirm_publish_task(c, &tid));
    match result {
        Ok(()) => {
            crate::web::audit_log(Some(&u.id), &u.email, "publish.confirm", &tid, &crate::web::client_ip(&headers));
            redirect(&format!("/projects/{}/publish", pid))
        }
        Err(e) => redirect_q(&format!("/publish/{}", tid), &[("e", &e)]),
    }
}

pub async fn publish_refresh(headers: HeaderMap, Path(tid): Path<String>) -> Response {
    if let Err(r) = require_user(&headers) {
        return r;
    }
    db::with_db(mock::catch_up_publish);
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default());
    redirect(&format!("/projects/{}/publish", pid))
}

pub async fn publish_retry(headers: HeaderMap, Path(tid): Path<String>) -> Response {
    if let Err(r) = require_user(&headers) {
        return r;
    }
    db::with_db(|c| {
        let status: i64 = c.query_row("SELECT status FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or(0);
        if status == 4 {
            c.execute("UPDATE publishTasks SET status=2, failReason=NULL WHERE id=?", [&tid]).ok();
        }
        mock::catch_up_publish(c);
    });
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default());
    redirect(&format!("/projects/{}/publish", pid))
}

pub async fn publish_mark(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let tid = fb.get("taskId");
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default());
    if pid.is_empty() || !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    match db::with_db(|c| mock::mark_published(c, &tid, &fb.get("publishedUrl"))) {
        Ok(()) => {
            crate::web::audit_log(Some(&u.id), &u.email, "publish.markPublished", &tid, &crate::web::client_ip(&headers));
            redirect(&format!("/projects/{}/publish", pid))
        }
        Err(e) => redirect_q(&format!("/projects/{}/publish", pid), &[("e", &e)]),
    }
}

// ============ 上榜监测 ============
pub async fn monitor(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        mock::run_due_checkpoints(c, &pid); // 到期复测
        let mut stmt = c.prepare("SELECT id, text FROM questions WHERE projectId=? ORDER BY priority, createdAt").unwrap();
        let questions: Vec<(String, String)> = stmt.query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|x| x.ok()).collect();
        let mut stmt = c
            .prepare("SELECT id, createdAt, questionIds, platforms, mode, status FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC")
            .unwrap();
        let tasks: Vec<(String, String, String, String, i64, i64)> = stmt
            .query_map([&pid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();

        let _plat_opts = enum_options(AI_PLATFORM);
        let create_form = if questions.is_empty() {
            "<div class=\"notice warn\">请先建立问题库</div>".to_string()
        } else {
            format!(
                r#"<form method="post" action="/projects/{pid}/monitor/create">
        <div class="row">
          <div style="flex:2"><label class="f">问题（可多选）*</label>
            <select name="questionIds" multiple size="6" required>{qopts}</select>
            <div class="kv">按住 Cmd/Ctrl 多选。品牌认知问题（带品牌名）与产品推荐问题（不带品牌名）可分别建任务。</div>
          </div>
          <div><label class="f">AI 平台（可多选）*</label>
            <select name="platforms" multiple size="6" required>{popts}</select>
          </div>
          <div><label class="f">监测模式</label>{mode}</div>
        </div>
        <div style="margin-top:10px"><button class="btn">创建并立即执行首轮</button></div>
      </form>"#,
                pid = esc(&pid),
                qopts = questions.iter().map(|(i, t)| format!("<option value=\"{}\">{}</option>", esc(i), esc(t))).collect::<Vec<_>>().join(""),
                popts = AI_PLATFORM
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i > 0 && *i <= 4)
                    .map(|(i, t)| format!("<option value=\"{}\"{}>{}</option>", i, if i == 1 { " selected" } else { "" }, esc(t)))
                    .collect::<Vec<_>>()
                    .join(""),
                mode = sel("mode", &[(1.to_string(), "一次性监测（仅一次）".into()), (2.to_string(), "周期复测（3/7/14 天）".into())], "1", "", false),
            )
        };

        let task_rows: Vec<String> = tasks
            .iter()
            .map(|(id, created, qids_raw, plats_raw, mode, status)| {
                let qids: Vec<String> = serde_json::from_str(qids_raw).unwrap_or_default();
                let plats: Vec<i64> = serde_json::from_str(plats_raw).unwrap_or_else(|_| vec![1]);
                let cps: Vec<(i64, i64)> = {
                    let mut s2 = c.prepare("SELECT day, status FROM monitorCheckpoints WHERE taskId=? ORDER BY day").unwrap();
                    s2.query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
                        .unwrap()
                        .filter_map(|x| x.ok())
                        .collect()
                };
                let cp_text = cps.iter().map(|(d, s2)| format!("第{}天:{}", d, if *s2 == 2 { "✓" } else { "…" })).collect::<Vec<_>>().join(" ");
                let has_pending = cps.iter().any(|(_, s2)| *s2 == 1);
                let run_next = if has_pending {
                    format!(
                        "<form method=\"post\" action=\"/monitor/{}/runnext\" class=\"inline\"><button class=\"btn small ghost\">执行下个复测点</button></form>",
                        esc(id)
                    )
                } else {
                    String::new()
                };
                format!(
                    "<tr><td>{ts}<div class=\"kv\">{n} 个问题</div></td><td>{mode_b}</td><td>{plats}</td><td>{st_b}<div class=\"kv\">{cp_text}</div></td><td><a class=\"btn small\" href=\"/monitor/{tid}\">查看结果</a> {run_next}</td></tr>",
                    ts = fmt_time(created),
                    n = qids.len(),
                    mode_b = label_badge(MONITOR_MODE, *mode),
                    plats = plats.iter().map(|p| label_badge(AI_PLATFORM, *p)).collect::<Vec<_>>().join(" "),
                    st_b = label_badge(MONITOR_TASK_STATUS, *status),
                    cp_text = cp_text,
                    tid = esc(id),
                    run_next = run_next,
                )
            })
            .collect();

        page_head("上榜监测", "固定问题版本、AI 平台、提问时间和监测周期；保存 AI 回答全文和引用来源。", "")
            + &card("创建监测任务", &create_form)
            + &card(
                "监测任务",
                &table_raw(
                    &["创建时间", "模式", "平台", "状态", ""],
                    &task_rows.join(""),
                    &empty_cta("还没有监测任务——创建后系统立即执行首轮，并告诉你 AI 是否引用了你", "javascript:void(0)", "↑ 往上看创建表单"),
                ),
            )
    });
    crate::web::user_page(&u, "上榜监测", "monitor", &pid, "", &body)
}

pub async fn monitor_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let mode = fb.opt_i("mode").unwrap_or(1);
    let input = mock::CreateMonitorInput {
        question_ids: fb.all("questionIds"),
        platforms: fb.all("platforms").iter().filter_map(|s| s.parse().ok()).collect(),
        mode,
        schedule_days: if mode == 2 { vec![3, 7, 14] } else { vec![] },
    };
    match db::with_db(|c| mock::create_monitor_task(c, &pid, &input)) {
        Ok(_tid) => {
            crate::web::audit_log(Some(&u.id), &u.email, "monitorTasks.create", &pid, &crate::web::client_ip(&headers));
            redirect(&format!("/projects/{}/monitor", pid))
        }
        Err(e) => redirect_q(&format!("/projects/{}/monitor", pid), &[("e", &e)]),
    }
}

// ============ 监测结果详情 ============
pub async fn monitor_detail(headers: HeaderMap, Path(tid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row("SELECT projectId, questionIds FROM monitorTasks WHERE id=?", [&tid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .ok()
    });
    let (pid, qids_raw) = match row {
        Some(x) => x,
        None => return crate::web::html404(),
    };
    if !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    let body = db::with_db(|c| {
        mock::run_due_checkpoints(c, &pid);
        let qids: Vec<String> = serde_json::from_str(&qids_raw).unwrap_or_default();
        let question_texts: Vec<String> = qids
            .iter()
            .filter_map(|qid| c.query_row("SELECT text FROM questions WHERE id=?", [qid], |r| r.get::<_, String>(0)).ok())
            .collect();
        let mut stmt = c
            .prepare(
                "SELECT ranAt, platform, answerText, brandMentioned, mentionPosition, brandAccurate, recommendLevel, competitors, citations, hitStatus, exactUrlHit, dataSource, nextStep, nextOptimize FROM monitorResults WHERE taskId=? ORDER BY ranAt",
            )
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&tid], |r| {
        #[allow(clippy::type_complexity)]
                let (ran, plat, answer, mentioned, pos, accurate, rlevel, comps_raw, cites_raw, hit, exact, source, next_step, next_opt): (
                    String,
                    i64,
                    String,
                    i64,
                    String,
                    Option<i64>,
                    i64,
                    String,
                    String,
                    i64,
                    i64,
                    String,
                    String,
                    String,
                ) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                    r.get(12)?,
                    r.get(13)?,
                );
                let cites: Vec<serde_json::Value> = serde_json::from_str(&cites_raw).unwrap_or_default();
                let cite_html = if cites.is_empty() {
                    "—".to_string()
                } else {
                    cites
                        .iter()
                        .map(|c| {
                            format!(
                                "{} <a href=\"{}\">{}</a>({})",
                                if c["own"].as_bool() == Some(true) { "\u{1f7e2}" } else { "\u{26aa}" },
                                safe_url(c["url"].as_str().unwrap_or("")),
                                esc(c["title"].as_str().unwrap_or("")),
                                esc(c["domain"].as_str().unwrap_or(""))
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("　")
                };
                let comps: Vec<serde_json::Value> = serde_json::from_str(&comps_raw).unwrap_or_default();
                let comp_html = if comps.is_empty() {
                    String::new()
                } else {
                    format!(
                        "<div class=\"kv\">竞品：{}</div>",
                        comps.iter().filter_map(|c| c["name"].as_str()).map(esc).collect::<Vec<_>>().join("、")
                    )
                };
                let src_badge = if source != "mock" {
                    format!("<div class=\"badge b-info\" style=\"margin-top:4px\">{}</div>", if source == "real-llm" { "LLM 监测" } else { "平台监测" })
                } else {
                    "<div class=\"badge b-gray\" style=\"margin-top:4px\">演示数据</div>".to_string()
                };
                Ok(format!(
                    "<tr><td class=\"wrap\"><div class=\"kv\">{ts} · {plat_b}</div><div class=\"answer\" style=\"margin-top:6px\">{answer}</div><div class=\"cite\">引用来源：{cites}</div></td>\
                    <td>{hit_b}<div class=\"kv\">{pos}</div><div class=\"kv\">推荐级别：{rlevel}</div>{accurate}{comps}</td>\
                    <td>{hs_b}{exact_b}{src_b}</td><td class=\"wrap kv\">{next_step}<br>下一步优化：{next_opt}</td></tr>",
                    ts = fmt_time(&ran),
                    plat_b = label_badge(AI_PLATFORM, plat),
                    answer = esc(&answer),
                    cites = cite_html,
                    hit_b = if mentioned == 1 { badge("已上榜") } else { badge("未命中") },
                    pos = esc(&pos),
                    rlevel = label(RECOMMEND_LEVEL, rlevel),
                    accurate = accurate.map(|a| format!("<div class=\"kv\">描述{}</div>", if a == 1 { "准确".to_string() } else { "<b style=\"color:var(--bad)\">不准确</b>".to_string() })).unwrap_or_default(),
                    comps = comp_html,
                    hs_b = label_badge(HIT_STATUS, hit),
                    exact_b = if exact == 1 { "<div class=\"badge b-ok\" style=\"margin-top:4px\">exact_url_hit</div>".to_string() } else { String::new() },
                    src_b = src_badge,
                    next_step = esc(&next_step),
                    next_opt = esc(&next_opt),
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        page_head(
            "监测结果",
            &question_texts.iter().map(|t| esc(t)).collect::<Vec<_>>().join(" / "),
            &format!("<a class=\"btn ghost\" href=\"/projects/{}/monitor\">返回</a>", esc(&pid)),
        ) + &card(
            &format!("AI 回答与引用记录（{} 条）", rows.len()),
            &table_raw(&["AI 回答全文 + 引用来源", "品牌表现", "监测状态", "下一步"], &rows.join(""), ""),
        )
            + &card(
                "从本任务沉淀信源 / 生成报告",
                &format!(
                    r#"<div class="row">
        <form method="post" action="/projects/{pid}/sources/collect" class="inline">
          <input type="hidden" name="taskId" value="{tid}">
          <button class="btn">沉淀为信源资产</button>
        </form>
        <form method="post" action="/projects/{pid}/reports/create" class="inline">
          <input type="hidden" name="taskIdA" value="{tid}">
          <input type="hidden" name="type" value="1">
          <button class="btn ghost">生成品牌诊断报告</button>
        </form>
        <form method="post" action="/projects/{pid}/reports/create" class="inline">
          <input type="hidden" name="taskIdA" value="{tid}">
          <input type="hidden" name="type" value="2">
          <button class="btn ghost">生成产品推荐诊断报告</button>
        </form>
      </div>"#,
                ),
            )
    });
    crate::web::user_page(&u, "监测结果", "monitor", &pid, "", &body)
}

pub async fn monitor_runnext(headers: HeaderMap, Path(tid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let pid: String = db::with_db(|c| c.query_row("SELECT projectId FROM monitorTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default());
    if pid.is_empty() || !crate::web::project_owned(&u.id, &pid) {
        return crate::web::html404();
    }
    db::with_db(|c| {
        let _ = mock::force_run_next_checkpoint(c, &tid);
    });
    crate::web::audit_log(Some(&u.id), &u.email, "monitorTasks.runNext", &tid, &crate::web::client_ip(&headers));
    redirect(&format!("/monitor/{}", tid))
}

// ============ 收录站点 ============
pub async fn sites(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c.prepare("SELECT citations FROM monitorResults WHERE projectId=?").unwrap();
        let all_cites: Vec<String> = stmt.query_map([&pid], |r| r.get::<_, String>(0)).unwrap().filter_map(|x| x.ok()).collect();
        let mut sites: std::collections::HashMap<String, (usize, usize, Vec<String>)> = std::collections::HashMap::new();
        for raw in &all_cites {
            let cites: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap_or_default();
            for cit in cites {
                let domain = cit["domain"].as_str().unwrap_or("").to_string();
                if domain.is_empty() {
                    continue;
                }
                let e = sites.entry(domain).or_insert((0, 0, vec![]));
                e.0 += 1;
                if cit["own"].as_bool() == Some(true) {
                    e.1 += 1;
                }
                if e.2.len() < 3 {
                    e.2.push(cit["title"].as_str().unwrap_or("").to_string());
                }
            }
        }
        #[allow(clippy::type_complexity)]
        let mut list: Vec<(&String, &(usize, usize, Vec<String>))> = sites.iter().collect();
        list.sort_by_key(|item| std::cmp::Reverse(item.1 .0));
        let rows: Vec<String> = list
            .iter()
            .map(|(domain, (count, own, titles))| {
                format!(
                    "<tr><td class=\"mono\">{}</td><td><b>{}</b></td><td>{}</td><td class=\"wrap kv\">{}</td></tr>",
                    esc(domain),
                    count,
                    if *own > 0 {
                        format!("<span class=\"badge b-ok\">\u{1f7e2} {} 次</span>", own)
                    } else {
                        "<span class=\"badge b-gray\">0</span>".to_string()
                    },
                    esc(&titles.join("；"))
                )
            })
            .collect();
        page_head("收录站点", "AI 实际引用了什么：从监测结果的引用来源聚合（\u{1f7e2} = 我方内容）", "")
            + &card("站点列表", &table_raw(&["站点", "被引用次数", "我方内容", "示例标题"], &rows.join(""), &empty("还没有监测数据")))
    });
    crate::web::user_page(&u, "收录站点", "sites", &pid, "", &body)
}

// ============ 付费媒体（占位） ============
pub async fn paid(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = page_head("付费媒体", "付费媒体投放（方法论文档未展开，占位模块）", "")
        + &card("", "<div class=\"empty\">付费媒体能力按需自助开通；当前版本为占位页。</div>");
    crate::web::user_page(&u, "付费媒体", "paid", &pid, "", &body)
}
