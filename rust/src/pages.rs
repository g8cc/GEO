// Goal-W2 页面：公司管理 / GEO 项目 / 项目概览 / 知识库 / 问题库（含全部表单）
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::response::Response;
use std::collections::HashMap;

use crate::auth;
use crate::db;
use crate::mock;
use crate::ui::{badge, card, empty_cta, enum_options, esc, fmt_time, label, label_badge, page_head, sel, table_raw, QUESTION_CATEGORY, QUESTION_PRIORITY, QUESTION_STAGE, QUESTION_STATUS};
use crate::web::{redirect, require_project, require_user, Fb};

// ============ 公司管理 ============
pub async fn companies(headers: HeaderMap) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT id, name, industry, intro, createdAt FROM companies WHERE ownerUserId=? ORDER BY createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&u.id], |r| {
                let (id, name, industry, intro, created): (String, String, String, String, String) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    r.get::<_, String>(4)?,
                );
                Ok(format!(
                    "<tr><td><b>{}</b></td><td>{}</td><td class=\"wrap\">{}</td><td>{}</td><td><a class=\"btn small ghost\" href=\"/projects?company={}\">查看项目</a></td></tr>",
                    esc(&name),
                    esc(&industry),
                    esc(&intro),
                    fmt_time(&created),
                    esc(&id)
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        page_head("公司管理", "品牌管理的基础：公司 → GEO 项目 → 品牌/产品知识库", "")
            + &card(
                "添加公司",
                r#"<form method="post" action="/companies/create" class="row">
        <div><label class="f">公司名称 *</label><input type="text" name="name" required></div>
        <div><label class="f">行业</label><input type="text" name="industry"></div>
        <div style="flex:2"><label class="f">简介</label><input type="text" name="intro"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>"#,
            )
            + &card("我的公司", &table_raw(&["名称", "行业", "简介", "创建时间", ""], &rows.join(""), ""))
    });
    crate::web::user_page(&u, "公司管理", "companies", "", "", &body)
}

pub async fn companies_create(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let name = fb.get("name");
    if !name.is_empty() {
        db::with_db(|c| {
            // 组织：复用用户已有主组织
            let org_id: String = c
                .query_row("SELECT orgId FROM orgMembers WHERE userId=? ORDER BY createdAt LIMIT 1", [&u.id], |r| r.get(0))
                .unwrap_or_default();
            let org_id = if org_id.is_empty() {
                let oid = auth::gen_uuid();
                c.execute(
                    "INSERT INTO orgs (id, name, ownerUserId, quotaMonitorMonthly, createdAt) VALUES (?,?,?,0,?)",
                    rusqlite::params![oid, format!("{} 的团队", u.email), u.id, auth::now_iso()],
                )
                .ok();
                c.execute(
                    "INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
                    rusqlite::params![auth::gen_uuid(), oid, u.id, "owner", auth::now_iso()],
                )
                .ok();
                oid
            } else {
                org_id
            };
            c.execute(
                "INSERT INTO companies (id, ownerUserId, orgId, name, industry, intro, createdAt) VALUES (?,?,?,?,?,?,?)",
                rusqlite::params![auth::gen_uuid(), u.id, org_id, name, fb.get("industry"), fb.get("intro"), auth::now_iso()],
            )
            .ok();
        });
        crate::web::audit_log(Some(&u.id), &u.email, "company.create", &name, &crate::web::client_ip(&headers));
    }
    redirect("/companies")
}

// ============ GEO 项目列表 ============
pub async fn projects(headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        // 公司下拉
        let mut stmt = c.prepare("SELECT id, name FROM companies WHERE ownerUserId=? ORDER BY createdAt DESC").unwrap();
        let companies: Vec<(String, String)> = stmt
            .query_map([&u.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        // 项目列表（限本组织可见）
        let mut stmt = c
            .prepare(
                "SELECT p.id, p.name, p.brandName, p.productName, p.business, p.createdAt, co.name FROM projects p JOIN companies co ON p.companyId=co.id JOIN orgMembers om ON om.orgId=co.orgId AND om.userId=? WHERE (?='' OR co.id=?) ORDER BY p.createdAt DESC",
            )
            .unwrap();
        let company_filter = q.get("company").cloned().unwrap_or_default();
        let rows: Vec<String> = stmt
            .query_map(rusqlite::params![u.id, company_filter, company_filter], |r| {
                let (id, name, brand, product, business, created, company): (String, String, String, String, String, String, String) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                );
                Ok(format!(
                    "<tr><td><a href=\"/projects/{}\"><b>{}</b></a><div class=\"kv\">{}</div></td><td>{} / {}</td><td class=\"wrap\">{}</td><td>{}</td><td><a class=\"btn small\" href=\"/projects/{}\">进入</a></td></tr>",
                    esc(&id),
                    esc(&name),
                    esc(&company),
                    esc(&brand),
                    if product.is_empty() { "—".to_string() } else { esc(&product) },
                    esc(&business),
                    fmt_time(&created),
                    esc(&id)
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let company_opts: Vec<(String, String)> = companies.iter().map(|(i, n)| (i.clone(), n.clone())).collect();
        let create_form = if companies.is_empty() {
            "<div class=\"notice warn\">请先<a href=\"/companies\">添加公司</a></div>".to_string()
        } else {
            format!(
                r#"<form method="post" action="/projects/create" class="row">
        <div><label class="f">所属公司 *</label>{}</div>
        <div><label class="f">项目名称 *</label><input type="text" name="name" required placeholder="如：跃动童年-GEO优化"></div>
        <div><label class="f">品牌名</label><input type="text" name="brandName"></div>
        <div><label class="f">产品名</label><input type="text" name="productName"></div>
        <div><label class="f">地域</label><input type="text" name="region"></div>
        <div style="flex:2"><label class="f">主营业务与目标人群</label><input type="text" name="business" placeholder="如：3-8岁儿童客厅体感运动"></div>
        <div style="flex:2"><label class="f">核心差异化卖点</label><input type="text" name="sellingPoints"></div>
        <div><label class="f">核心品类搜索词（逗号分隔）</label><input type="text" name="keywords"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>"#,
                sel("companyId", &company_opts, "", "", true)
            )
        };
        page_head("GEO 项目", "公司与产品决定后续知识库、文章、发布和监测数据归属于哪个项目", "")
            + &card("添加 GEO 项目", &create_form)
            + &card("项目列表", &table_raw(&["项目", "品牌 / 产品", "业务", "创建时间", ""], &rows.join(""), ""))
    });
    crate::web::user_page(&u, "GEO 项目", "projects", "", "", &body)
}

pub async fn projects_create(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let company_id = fb.get("companyId");
    let name = fb.get("name");
    if company_id.is_empty() || name.is_empty() {
        return redirect("/projects");
    }
    let owned = db::with_db(|c| {
        c.query_row("SELECT 1 FROM companies WHERE id=? AND ownerUserId=?", [&company_id, &u.id], |r| r.get::<_, i32>(0)).is_ok()
    });
    if !owned {
        return crate::web::html404();
    }
    let pid = auth::gen_uuid();
    db::with_db(|c| {
        c.execute(
            "INSERT INTO projects (id, companyId, name, brandName, productName, region, business, sellingPoints, keywords, defaultPlatforms, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![pid, company_id, name, fb.get("brandName"), fb.get("productName"), fb.get("region"), fb.get("business"), fb.get("sellingPoints"), fb.get("keywords"), "[1,2,3,4]", auth::now_iso()],
        )
        .ok();
        mock::ensure_kbs(c, &pid);
    });
    crate::web::audit_log(Some(&u.id), &u.email, "project.create", &name, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}", pid))
}

// ============ 项目概览 ============
pub async fn project_detail(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let p = mock::get_project(c, &pid);
        let p = match p {
            Some(p) => p,
            None => return String::new(),
        };
        let count = |sql: &str| -> i64 { c.query_row(sql, [&pid], |r| r.get::<_, i64>(0)).unwrap_or(0) };
        let kb_docs = count("SELECT COUNT(*) FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)");
        let questions = count("SELECT COUNT(*) FROM questions WHERE projectId=?");
        let articles = count("SELECT COUNT(*) FROM articles WHERE projectId=?");
        let published = count("SELECT COUNT(*) FROM articles WHERE projectId=? AND status=3");
        let monitors = count("SELECT COUNT(*) FROM monitorTasks WHERE projectId=?");
        let exact_hits = count("SELECT COUNT(*) FROM monitorResults WHERE projectId=? AND exactUrlHit=1");
        let assets = count("SELECT COUNT(*) FROM sourceAssets WHERE projectId=?");

        let stats = format!(
            "<table><tr><th>知识库文档</th><th>问题</th><th>文章</th><th>已正式发布</th><th>监测任务</th><th>精确收录(exact_url_hit)</th><th>信源资产</th></tr><tr><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td><td><b>{}</b></td></tr></table>",
            kb_docs, questions, articles, published, monitors, exact_hits, assets
        );
        let info = format!(
            r#"<div class="kv">
      <p><b>品牌名：</b>{}　<b>产品名：</b>{}　<b>地域：</b>{}</p>
      <p><b>主营业务：</b>{}</p>
      <p><b>核心差异化卖点：</b>{}</p>
      <p><b>核心品类搜索词：</b>{}</p></div>
      <form method="post" action="/projects/{}/update" class="row" style="margin-top:10px">
        <div><label class="f">品牌名</label><input type="text" name="brandName" value="{}"></div>
        <div><label class="f">产品名</label><input type="text" name="productName" value="{}"></div>
        <div><label class="f">地域</label><input type="text" name="region" value="{}"></div>
        <div><label class="f">主营业务与目标人群</label><input type="text" name="business" value="{}"></div>
        <div><label class="f">核心差异化卖点</label><input type="text" name="sellingPoints" value="{}"></div>
        <div><label class="f">核心品类搜索词</label><input type="text" name="keywords" value="{}"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">保存</button></div>
      </form>"#,
            esc(&p.brand_name),
            if p.product_name.is_empty() { "—".to_string() } else { esc(&p.product_name) },
            if p.region.is_empty() { "—".to_string() } else { esc(&p.region) },
            if p.business.is_empty() { "—".to_string() } else { esc(&p.business) },
            if p.selling_points.is_empty() { "—".to_string() } else { esc(&p.selling_points) },
            if p.keywords.is_empty() { "—".to_string() } else { esc(&p.keywords) },
            esc(&pid),
            esc(&p.brand_name),
            esc(&p.product_name),
            esc(&p.region),
            esc(&p.business),
            esc(&p.selling_points),
            esc(&p.keywords),
        );
        page_head(
            &format!("项目：{}", p.name),
            &format!("{} · {}", esc(&p.brand_name), if p.business.is_empty() { "—".to_string() } else { esc(&p.business) }),
            &format!("<a class=\"btn\" href=\"/dashboard?p={}\">十步工作台</a>", esc(&pid)),
        ) + &card("数据总览", &stats)
            + &card("项目信息（公司与产品初始化）", &info)
    });
    crate::web::user_page(&u, "项目概览", "overview", &pid, "", &body)
}

pub async fn project_update(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    db::with_db(|c| {
        c.execute(
            "UPDATE projects SET brandName=?, productName=?, region=?, business=?, sellingPoints=?, keywords=? WHERE id=?",
            rusqlite::params![fb.get("brandName"), fb.get("productName"), fb.get("region"), fb.get("business"), fb.get("sellingPoints"), fb.get("keywords"), pid],
        )
        .ok();
    });
    crate::web::audit_log(Some(&u.id), &u.email, "project.update", &pid, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}", pid))
}

// ============ 知识库 ============
pub async fn kb(headers: HeaderMap, Path(pid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ktype: i64 = q.get("type").and_then(|s| s.parse().ok()).unwrap_or(1);
    let body = db::with_db(|c| {
        let _p = match mock::get_project(c, &pid) {
            Some(p) => p,
            None => return String::new(),
        };
        mock::ensure_kbs(c, &pid);
        let kb_id = mock::get_kb_id(c, &pid, ktype).unwrap_or_default();
        let (qa_index, conflict_list): (String, String) = c
            .query_row("SELECT COALESCE(qaIndex,''), COALESCE(conflictList,'') FROM knowledgeBases WHERE id=?", [&kb_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap_or_default();

        let mut stmt = c
            .prepare("SELECT id, module, title, content, pending, updatedAt FROM kbDocuments WHERE kbId=? ORDER BY module")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&kb_id], |r| {
                let (id, module, title, content, pending, updated): (String, i64, String, String, String, String) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    r.get::<_, String>(5)?,
                );
                let status = if pending.is_empty() {
                    "<span class=\"badge b-ok\">可用</span>".to_string()
                } else {
                    format!("{}<div class=\"kv\">{}</div>", badge("待补充"), esc(&pending))
                };
                let short = crate::ui::trunc(&content, 160);
                Ok(format!(
                    "<tr><td>{}</td><td><b>{}</b></td><td class=\"wrap md\">{}</td><td>{}</td><td>{}</td><td>\
                    <details><summary class=\"btn small ghost\" style=\"cursor:pointer\">编辑</summary>\
                      <form method=\"post\" action=\"/projects/{pid}/kb/update\" style=\"margin-top:8px\">\
                        <input type=\"hidden\" name=\"docId\" value=\"{did}\"><input type=\"hidden\" name=\"type\" value=\"{ktype}\">\
                        <label class=\"f\">标题</label><input type=\"text\" name=\"title\" value=\"{title}\">\
                        <label class=\"f\">内容</label><textarea name=\"content\">{content}</textarea>\
                        <label class=\"f\">待补充说明</label><input type=\"text\" name=\"pending\" value=\"{pending}\">\
                        <div style=\"margin-top:8px\"><button class=\"btn small\">保存文档</button></div>\
                      </form>\
                    </details></td></tr>",
                    esc(&label(crate::ui::KB_MODULE, module)),
                    esc(&title),
                    esc(&short),
                    status,
                    fmt_time(&updated),
                    pid = esc(&pid),
                    did = esc(&id),
                    ktype = ktype,
                    title = esc(&title),
                    content = esc(&content),
                    pending = esc(&pending),
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();

        let tabs = format!(
            r#"<div class="row" style="margin-bottom:10px">
        <a class="btn ghost" href="/projects/{}/kb?type=1">{}品牌知识库</a>
        <a class="btn ghost" href="/projects/{}/kb?type=2">{}产品知识库</a>
      </div>"#,
            esc(&pid),
            if ktype == 1 { "▶ " } else { "" },
            esc(&pid),
            if ktype == 2 { "▶ " } else { "" },
        );
        let conflict_html = if ktype == 1 && !conflict_list.is_empty() {
            format!("<div class=\"notice warn\"><b>口径冲突清单：</b><br>{}</div>", esc(&conflict_list))
        } else {
            String::new()
        };
        let qa_html = if ktype == 1 && !qa_index.is_empty() {
            let pretty: String = serde_json::from_str::<serde_json::Value>(&qa_index)
                .map(|v| serde_json::to_string_pretty(&v).unwrap_or(qa_index.clone()))
                .unwrap_or_else(|_| qa_index.clone());
            format!(
                "<details style=\"margin-bottom:10px\"><summary style=\"cursor:pointer\">品牌高频 Q&amp;A 问答索引（答案必须能回溯到六大模块）</summary><pre class=\"md-box md\">{}</pre></details>",
                esc(&pretty)
            )
        } else {
            String::new()
        };

        let module_opts: Vec<(String, String)> = crate::ui::KB_MODULE
            .iter()
            .enumerate()
            .filter(|(i, _)| *i > 0)
            .map(|(i, t)| (i.to_string(), t.to_string()))
            .collect();

        page_head(
            "知识库",
            "品牌事实、产品事实、案例、优势、边界和更新时间。整理铁律：没有资料支持的内容必须标记待补，不能编造。",
            "",
        ) + &card("", &(tabs + &conflict_html + &qa_html + &table_raw(&["模块", "标题", "内容", "状态", "更新时间", ""], &rows.join(""), &empty_cta(
            "知识库还是空的——AI 写作只能使用这里已确认的事实，先从「知识库整理」开始",
            "javascript:void(0)",
            "↓ 往下看知识库整理",
        ))))
            + &card(
                "上传单篇文档",
                &format!(
                    r#"<form method="post" action="/projects/{pid}/kb/upload">
        <input type="hidden" name="type" value="{ktype}">
        <div class="row">
          <div><label class="f">模块</label>{}</div>
          <div><label class="f">标题 *</label><input type="text" name="title" required></div>
        </div>
        <label class="f">内容 *</label><textarea name="content" required placeholder="每行一条事实；保留来源、时间和原始链接"></textarea>
        <label class="f">待补充说明</label><input type="text" name="pending" placeholder="资料不完整之处统一标注">
        <div style="margin-top:10px"><button class="btn">上传文档</button></div>
      </form>"#,
                    sel("module", &module_opts, "2", "", false)
                ),
            )
            + &card(
                "知识库整理（六模块标准化 + QA 索引 + 口径冲突清单）",
                &format!(
                    r#"<div class="notice">粘贴公司/产品原始资料，按《品牌知识库标准化整理》提示词生成 6 个标准模块；严禁编造，缺失标「待补充」，冲突列清单。</div>
      <form method="post" action="/projects/{pid}/kb/organize">
        <input type="hidden" name="type" value="{ktype}">
        <label class="f">原始资料</label>
        <textarea name="raw" class="code" style="min-height:140px" required placeholder="公司与产品材料：定位、价格、案例、资质……"></textarea>
        <div style="margin-top:10px"><button class="btn">开始整理</button></div>
      </form>"#,
                ),
            )
    });
    crate::web::user_page(&u, "知识库", "kb", &pid, "", &body)
}

pub async fn kb_upload(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ktype = fb.i("type");
    db::with_db(|c| {
        let kb_id = mock::get_kb_id(c, &pid, ktype).unwrap_or_default();
        if !kb_id.is_empty() && !fb.get("title").is_empty() {
            c.execute(
                "INSERT INTO kbDocuments (id, kbId, module, title, content, evidence, pending, source, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
                rusqlite::params![auth::gen_uuid(), kb_id, fb.opt_i("module").unwrap_or(2), fb.get("title"), fb.get("content"), "[]", fb.get("pending"), "Web 手动上传", auth::now_iso()],
            )
            .ok();
        }
    });
    crate::web::audit_log(Some(&u.id), &u.email, "kb.uploadDoc", &pid, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/kb?type={}", pid, ktype))
}

pub async fn kb_update(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    db::with_db(|c| {
        c.execute(
            "UPDATE kbDocuments SET title=?, content=?, pending=?, updatedAt=? WHERE id=? AND kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)",
            rusqlite::params![fb.get("title"), fb.get("content"), fb.get("pending"), auth::now_iso(), fb.get("docId"), pid],
        )
        .ok();
    });
    crate::web::audit_log(Some(&u.id), &u.email, "kb.updateDoc", &pid, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/kb?type={}", pid, fb.i("type")))
}

pub async fn kb_organize(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ktype = fb.i("type");
    db::with_db(|c| {
        let brand = mock::get_project(c, &pid).map(|p| p.brand_name).unwrap_or_default();
        mock::organize_knowledge(c, &pid, ktype, &brand, &fb.get("raw"));
    });
    crate::web::audit_log(Some(&u.id), &u.email, "kb.organize", &pid, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/kb?type={}", pid, ktype))
}

// ============ 问题库 ============
pub async fn questions(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT id, text, source, version, withBrand, category, intentDimension, stage, priority, status FROM questions WHERE projectId=? ORDER BY priority, createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&pid], |r| {
                let (id, text, source, version, with_brand, category, intent, stage, priority, status): (
                    String,
                    String,
                    String,
                    i64,
                    i64,
                    i64,
                    String,
                    i64,
                    i64,
                    i64,
                ) = (
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                );
                let pri_opts: Vec<(String, String)> = QUESTION_PRIORITY.iter().enumerate().map(|(i, t)| (i.to_string(), t.to_string())).collect();
                let st_opts: Vec<(String, String)> = QUESTION_STATUS.iter().enumerate().skip(1).map(|(i, t)| (i.to_string(), t.to_string())).collect();
                Ok(format!(
                    "<tr><td class=\"wrap\"><b>{text}</b><div class=\"kv mono\">{source} · v{version} · {brand}</div></td>\
                    <td>{cat}<div class=\"kv\">{intent}</div></td><td>{stage_b}</td><td>{pri_b}</td><td>{status_b}</td>\
                    <td><form method=\"post\" action=\"/projects/{pid}/questions/update\" class=\"row\" style=\"gap:6px\">\
                      <input type=\"hidden\" name=\"questionId\" value=\"{qid}\">\
                      <div style=\"min-width:90px\">{pri_sel}</div>\
                      <div style=\"min-width:90px\">{st_sel}</div>\
                      <div style=\"flex:0\"><button class=\"btn small\">更新</button></div>\
                    </form></td></tr>",
                    text = esc(&text),
                    source = esc(&source),
                    version = version,
                    brand = if with_brand == 1 { "带品牌名" } else { "不带品牌名" },
                    cat = label_badge(QUESTION_CATEGORY, category),
                    intent = esc(&intent),
                    stage_b = label_badge(QUESTION_STAGE, stage),
                    pri_b = label_badge(QUESTION_PRIORITY, priority),
                    status_b = label_badge(QUESTION_STATUS, status),
                    pid = esc(&pid),
                    qid = esc(&id),
                    pri_sel = sel("priority", &pri_opts, &priority.to_string(), "", false),
                    st_sel = sel("status", &st_opts, &status.to_string(), "", false),
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let total: i64 = c.query_row("SELECT COUNT(*) FROM questions WHERE projectId=?", [&pid], |r| r.get(0)).unwrap_or(0);

        let cat_opts = enum_options(QUESTION_CATEGORY);
        let pri_opts: Vec<(String, String)> = QUESTION_PRIORITY.iter().enumerate().map(|(i, t)| (i.to_string(), t.to_string())).collect();

        page_head(
            "问题拓展 / 搜索问题库",
            "问题集、问题类型、优先级和问题状态。监测复测必须固定问题原文，不要每次更换问题。",
            "",
        ) + &card(
            "生成问题（按方法论）",
            r#"<div class="row">
        <form method="post" action="__GENERATE50__" class="inline">
          <input type="hidden" name="mode" value="50">
          <button class="btn">生成 50 问</button>
        </form>
        <form method="post" action="__GENERATE40__" class="inline">
          <input type="hidden" name="mode" value="40">
          <button class="btn ghost">精简为标准 40 问（探索30/评估5/行动5）</button>
        </form>
      </div>
      <div class="kv" style="margin-top:8px">50 问：综合5 / 场景9 / 人群9 / 痛点9 / 功能9 / 决策9；每条含「哪家好/推荐/怎么选/排行」，严禁品牌名，10-25 字。</div>"#,
        )
        .replace("__GENERATE50__", &format!("/projects/{}/questions/generate", esc(&pid)))
        .replace("__GENERATE40__", &format!("/projects/{}/questions/generate", esc(&pid)))
            + &card(
                "添加 / 批量导入问题",
                &format!(
                    r#"<form method="post" action="/projects/{pid}/questions/add" class="row">
        <div style="flex:2"><label class="f">单个问题</label><input type="text" name="text"></div>
        <div><label class="f">类型</label>{cat}</div>
        <div><label class="f">优先级</label>{pri}</div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>
      <form method="post" action="/projects/{pid}/questions/import" style="margin-top:8px">
        <label class="f">批量导入（每行一条）</label>
        <textarea name="lines" class="code" placeholder="问题1&#10;问题2"></textarea>
        <div style="margin-top:8px"><button class="btn ghost">批量导入</button></div>
      </form>"#,
                    pid = esc(&pid),
                    cat = sel("category", &cat_opts, "2", "", false),
                    pri = sel("priority", &pri_opts, "2", "", false),
                ),
            )
            + &card(
                &format!("问题库（{}）", total),
                &table_raw(
                    &["问题", "类型", "阶段", "优先级", "状态", "调整"],
                    &rows.join(""),
                    &empty_cta(
                        "问题库是空的——点上面的「生成 50 问」，系统按消费者决策路径自动建题",
                        "javascript:void(0)",
                        "↑ 往上看生成按钮",
                    ),
                ),
            )
    });
    crate::web::user_page(&u, "问题拓展", "questions", &pid, "", &body)
}

pub async fn questions_add(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let text = fb.get("text");
    if !text.is_empty() {
        db::with_db(|c| {
            let brand = mock::get_project(c, &pid).map(|p| p.brand_name).unwrap_or_default();
            let with_brand = if !brand.is_empty() && text.contains(&brand) { 1 } else { 0 };
            c.execute(
                "INSERT INTO questions (id, projectId, text, category, stage, priority, status, withBrand, source, createdAt) VALUES (?,?,?,?,?,?,1,?,?,?)",
                rusqlite::params![auth::gen_uuid(), pid, text, fb.opt_i("category").unwrap_or(1), 1, fb.opt_i("priority").unwrap_or(2), with_brand, "人工", auth::now_iso()],
            )
            .ok();
        });
        crate::web::audit_log(Some(&u.id), &u.email, "question.create", &text, &crate::web::client_ip(&headers));
    }
    redirect(&format!("/projects/{}/questions", pid))
}

pub async fn questions_import(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    db::with_db(|c| {
        let brand = mock::get_project(c, &pid).map(|p| p.brand_name).unwrap_or_default();
        for line in fb.get("lines").lines() {
            let text = line.trim();
            if text.is_empty() {
                continue;
            }
            let with_brand = if !brand.is_empty() && text.contains(&brand) { 1 } else { 0 };
            let dup = c.query_row("SELECT id FROM questions WHERE projectId=? AND text=?", rusqlite::params![pid, text], |r| r.get::<_, String>(0)).is_ok();
            if dup {
                continue;
            }
            c.execute(
                "INSERT INTO questions (id, projectId, text, category, stage, priority, status, withBrand, source, createdAt) VALUES (?,?,?,?,?,?,1,?,?,?)",
                rusqlite::params![auth::gen_uuid(), pid, text, 1, 1, 2, with_brand, "批量导入", auth::now_iso()],
            )
            .ok();
        }
    });
    crate::web::audit_log(Some(&u.id), &u.email, "question.batchCreate", &pid, &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/questions", pid))
}

pub async fn questions_generate(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let mode = fb.get("mode");
    db::with_db(|c| {
        if mode == "40" {
            mock::simplify_to_40(c, &pid);
        } else {
            mock::generate_questions_50(c, &pid);
        }
    });
    crate::web::audit_log(Some(&u.id), &u.email, "question.generate", &format!("{} ({})", pid, mode), &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/questions", pid))
}

pub async fn questions_update(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    db::with_db(|c| {
        c.execute(
            "UPDATE questions SET priority=?, status=? WHERE id=? AND projectId=?",
            rusqlite::params![fb.opt_i("priority").unwrap_or(2), fb.opt_i("status").unwrap_or(1), fb.get("questionId"), pid],
        )
        .ok();
    });
    crate::web::audit_log(Some(&u.id), &u.email, "question.update", &fb.get("questionId"), &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/questions", pid))
}
