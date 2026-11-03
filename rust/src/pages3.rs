// Goal-W4 页面：口碑监测 / 信源资产 / 报告 / 系统设置（keys/config/licenses/audit）/ 团队 / 一键 GEO
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::response::Response;
use std::collections::HashMap;

use crate::auth;
use crate::db;
use crate::mock;
use crate::ui::{badge, card, empty, empty_cta, enum_options, esc, fmt_time, label, label_badge, page_head, safe_url, sel, table_raw, AI_PLATFORM, MONITOR_MODE, MONITOR_TASK_STATUS, REPORT_TYPE, SOURCE_ASSET_STATUS, SOURCE_CONTROLLABILITY, SOURCE_PAGE_STATUS};
use crate::web::{html403, html404, redirect, redirect_q, require_project, require_user, Fb};

// ============ 口碑监测 ============
pub async fn wom(headers: HeaderMap, Path(pid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    mock::run_due_checkpoints(&pid); // 到期复测（真实平台网调在锁外）
    let body = db::with_db(|c| {
        let tasks: Vec<(String, String, i64, i64, String)> = {
            let mut stmt = c.prepare("SELECT id, createdAt, mode, status, questionIds FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC").unwrap();
            stmt.query_map([&pid], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect()
        };
        // 口碑任务：questionIds 中存在 source='口碑监测' 的问题
        let mut rep_tasks: Vec<(String, String, i64, i64)> = Vec::new();
        for (id, created, mode, status, qids_raw) in &tasks {
            let qids: Vec<String> = serde_json::from_str(qids_raw).unwrap_or_default();
            let is_rep = qids.iter().any(|qid| {
                c.query_row("SELECT source FROM questions WHERE id=?", [qid], |r| r.get::<_, String>(0))
                    .map(|s| s == "口碑监测")
                    .unwrap_or(false)
            });
            if is_rep {
                rep_tasks.push((id.clone(), created.clone(), *mode, *status));
            }
        }
        let latest = rep_tasks.first().cloned();
        let mut summary_html = empty("还没有口碑监测数据——上方一键创建后自动执行首轮");
        if let Some((tid, _, _, _)) = &latest {
            let mut stmt = c
                .prepare("SELECT ranAt, platform, answerText, hitStatus FROM monitorResults WHERE taskId=? ORDER BY ranAt")
                .unwrap();
            let rows: Vec<String> = stmt
                .query_map([tid], |r| {
                    let (ran, plat, text, hit): (String, i64, String, i64) = (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?);
                    let neg = ["投诉", "差评", "维权", "退款", "跑路", "暴雷", "避坑", "骗", "风险", "违规", "翻车", "不推荐", "慎选"];
                    let hits: Vec<&str> = neg.iter().copied().filter(|w| text.contains(w)).collect();
                    Ok(format!(
                        "<tr><td class=\"wrap\"><div class=\"kv\">{ts} · {plat}</div><div class=\"answer\" style=\"margin-top:6px\">{text}</div></td><td>{neg_b}</td><td>{hit_b}</td></tr>",
                        ts = fmt_time(&ran),
                        plat = label_badge(AI_PLATFORM, plat),
                        text = esc(&crate::ui::trunc(&text, 400)),
                        neg_b = if hits.is_empty() {
                            "<span class=\"badge b-ok\">无负面信号</span>".to_string()
                        } else {
                            format!("<span class=\"badge b-bad\">{}</span>", esc(&hits.join("、")))
                        },
                        hit_b = label_badge(crate::ui::HIT_STATUS, hit),
                    ))
                })
                .unwrap()
                .filter_map(|x| x.ok())
                .collect();
            summary_html = table_raw(&["AI 回答（口碑类问题）", "负面信号", "监测状态"], &rows.join(""), "");
        }
        let _plat_opts = enum_options(AI_PLATFORM);
        let rep_rows: Vec<String> = rep_tasks
            .iter()
            .map(|(id, created, mode, status)| {
                format!(
                    "<tr><td>{ts}</td><td>{mode_b}</td><td>{st_b}</td><td><form method=\"post\" action=\"/projects/{pid}/reports/create\" class=\"inline\">\
                    <input type=\"hidden\" name=\"type\" value=\"6\"><input type=\"hidden\" name=\"taskIdA\" value=\"{tid}\">\
                    <button class=\"btn small ghost\">生成口碑摘要报告</button></form></td></tr>",
                    ts = fmt_time(created),
                    mode_b = label_badge(MONITOR_MODE, *mode),
                    st_b = label_badge(MONITOR_TASK_STATUS, *status),
                    pid = esc(&pid),
                    tid = esc(id),
                )
            })
            .collect();
        let err_html = q.get("e").map(|e| format!("<div class=\"notice warn\">{}</div>", esc(e))).unwrap_or_default();
        page_head(
            "口碑监测",
            "用「品牌名 + 差评/投诉/维权/跑路」等口碑问题持续探测全网负面信号（复用真实监测 Provider）",
            "",
        ) + &err_html
            + &card(
                "一键创建口碑监测任务",
                &format!(
                    r#"<form method="post" action="/projects/{pid}/wom/create" class="row">
        <div><label class="f">AI 平台（可多选）*</label>
          <select name="platforms" multiple size="5">{popts}</select>
        </div>
        <div><label class="f">监测模式</label>{mode}</div>
        <div style="flex:0;align-self:flex-end"><button class="btn">创建并执行首轮</button></div>
      </form>
      <div class="kv" style="margin-top:8px">自动生成 8 个口碑探测问题（靠谱吗/投诉/差评/跑路/避坑…，风险判断类），与问题库独立标记。</div>"#,
                    pid = esc(&pid),
                    popts = AI_PLATFORM
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| *i > 0 && *i <= 4)
                        .map(|(i, t)| format!("<option value=\"{}\" selected>{}</option>", i, esc(t)))
                        .collect::<Vec<_>>()
                        .join(""),
                    mode = sel("mode", &[(2.to_string(), "周期复测（3/7/14 天）".into()), (1.to_string(), "一次性监测".into())], "2", "", false),
                ),
            )
            + &if rep_tasks.is_empty() {
                String::new()
            } else {
                card(
                    &format!("口碑任务（{}）", rep_tasks.len()),
                    &table_raw(&["创建时间", "模式", "状态", ""], &rep_rows.join(""), ""),
                )
            }
            + &card("最新一轮口碑结果", &summary_html)
    });
    crate::web::user_page(&u, "口碑监测", "wom", &pid, "", &body)
}

pub async fn wom_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let platforms: Vec<i64> = fb.all("platforms").iter().filter_map(|s| s.parse().ok()).collect();
    let platforms = if platforms.is_empty() { vec![1] } else { platforms };
    let mode = fb.opt_i("mode").unwrap_or(2);
    match db::with_db(|c| mock::create_reputation_monitor_locked(c, &pid, platforms, mode, false)) {
        Ok((_added, _tid, first_cp)) => {
            if let Err(e) = mock::run_checkpoint_full(&first_cp) {
                return redirect_q(&format!("/projects/{}/wom", pid), &[("e", &e)]);
            }
            crate::web::audit_log(Some(&u.id), &u.email, "reputation.create", &pid, &crate::web::client_ip(&headers));
            redirect(&format!("/projects/{}/wom", pid))
        }
        Err(e) => redirect_q(&format!("/projects/{}/wom", pid), &[("e", &e)]),
    }
}

// ============ 信源资产 ============
pub async fn sources(headers: HeaderMap, Path(pid): Path<String>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare(
                "SELECT id, articleTitle, url, question, aiPlatform, evidenceType, publisher, accountType, citedCount, brandPerformance, controllability, pageStatus, status, nextAction FROM sourceAssets WHERE projectId=? ORDER BY updatedAt DESC",
            )
            .unwrap();
        #[allow(clippy::type_complexity)]
        let rows: Vec<(String, String, String, String, i64, i64, i64, i64, i64, String, i64, i64, i64, String)> = stmt
            .query_map([&pid], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        // 四状态统计
        let mut by_status: Vec<(String, usize)> = ["已引用信源", "潜在信源", "可投放信源", "观察信源"].iter().map(|s| (s.to_string(), 0)).collect();
        for r in &rows {
            let s = label(SOURCE_ASSET_STATUS, r.12);
            if let Some(e) = by_status.iter_mut().find(|(k, _)| *k == s) {
                e.1 += 1;
            }
        }
        let stats = by_status
            .iter()
            .map(|(k, v)| format!("<span class=\"badge {}\" style=\"margin-right:8px\">{}: {}</span>", if k == "已引用信源" { "b-ok" } else { "b-gray" }, esc(k), v))
            .collect::<String>();

        let status_opts = enum_options(SOURCE_ASSET_STATUS);
        let ctrl_opts = enum_options(SOURCE_CONTROLLABILITY);
        let page_opts = enum_options(SOURCE_PAGE_STATUS);
        let rows_html: Vec<String> = rows
            .iter()
            .map(|r| {
                format!(
                    "<tr>\
        <td class=\"wrap\"><b>{title}</b><div class=\"mono\"><a href=\"{url}\">{url}</a></div></td>\
        <td class=\"wrap kv\">{question}<div>{plat}</div></td>\
        <td class=\"kv\">{ev} {pub_b}<div>{acc}</div></td>\
        <td><b>{cited}</b><div class=\"kv wrap\">{perf}</div></td>\
        <td class=\"kv\">{ctrl}<div>{page}</div></td>\
        <td>{st}</td>\
        <td class=\"wrap kv\">{next}</td>\
        <td><details><summary class=\"btn small ghost\" style=\"cursor:pointer\">调整</summary>\
          <form method=\"post\" action=\"/projects/{pid}/sources/update\" style=\"margin-top:8px\">\
            <input type=\"hidden\" name=\"id\" value=\"{sid}\">\
            <label class=\"f\">状态</label>{st_sel}\
            <label class=\"f\">可控性</label>{ctrl_sel}\
            <label class=\"f\">页面状态</label>{page_sel}\
            <label class=\"f\">下一步动作</label><input type=\"text\" name=\"nextAction\" value=\"{next}\">\
            <div style=\"margin-top:8px\"><button class=\"btn small\">保存</button></div>\
          </form>\
        </details></td>\
      </tr>",
                    title = esc(&r.1),
                    url = safe_url(&r.2),
                    question = if r.3.is_empty() { "—".to_string() } else { esc(&r.3) },
                    plat = label_badge(AI_PLATFORM, r.4),
                    ev = label_badge(crate::ui::EVIDENCE_TYPE, r.5),
                    pub_b = label_badge(crate::ui::PUBLISHER_TYPE, r.6),
                    acc = label_badge(crate::ui::ACCOUNT_TYPE, r.7),
                    cited = r.8,
                    perf = esc(&r.9),
                    ctrl = label_badge(SOURCE_CONTROLLABILITY, r.10),
                    page = label_badge(SOURCE_PAGE_STATUS, r.11),
                    st = label_badge(SOURCE_ASSET_STATUS, r.12),
                    next = esc(&r.13),
                    pid = esc(&pid),
                    sid = esc(&r.0),
                    st_sel = sel("status", &status_opts, &r.12.to_string(), "", false),
                    ctrl_sel = sel("controllability", &ctrl_opts, &r.10.to_string(), "", false),
                    page_sel = sel("pageStatus", &page_opts, &r.11.to_string(), "", false),
                )
            })
            .collect();
        page_head(
            "信源资产",
            "按问题和 AI 平台分别记录，不能合并成一张媒体名单。三问分类：能证明什么 / 是谁发布的 / 在哪里发布、能不能影响。",
            "",
        ) + &card("四状态统计", &stats)
            + &card(
                "信源资产清单",
                &table_raw(
                    &["文章标题 / URL", "问题 / AI平台", "证据类型 / 发布主体 / 账号类型", "引用次数 / 品牌表现", "可控性 / 页面状态", "状态", "下一步动作", ""],
                    &rows_html.join(""),
                    &empty_cta("信源资产库为空——完成一次上榜监测后点下方「一键沉淀」，或手动登记已知信源", "javascript:void(0)", "↓ 往下看沉淀按钮"),
                ),
            )
            + &card(
                "从监测结果沉淀信源（区分已引用/潜在/可投放/观察）",
                &format!(
                    r#"<form method="post" action="/projects/{pid}/sources/collect" class="row">
        <div style="flex:0"><button class="btn">一键沉淀全部监测结果</button></div>
        <div class="kv" style="align-self:center">我方被引用的 URL → 已引用信源；竞品/第三方 → 观察信源；可后续人工调整。</div>
      </form>"#,
                ),
            )
    });
    crate::web::user_page(&u, "信源资产", "sources", &pid, "", &body)
}

pub async fn sources_collect(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let task_id = fb.get("taskId");
    let n = db::with_db(|c| mock::collect_source_assets(c, &pid, if task_id.is_empty() { None } else { Some(&task_id) }));
    crate::web::audit_log(Some(&u.id), &u.email, "sources.collect", &format!("{} ({} 条)", pid, n), &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/sources", pid))
}

pub async fn sources_update(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    db::with_db(|c| {
        c.execute(
            "UPDATE sourceAssets SET status=?, controllability=?, pageStatus=?, nextAction=?, updatedAt=? WHERE id=? AND projectId=?",
            rusqlite::params![fb.opt_i("status").unwrap_or(2), fb.opt_i("controllability").unwrap_or(2), fb.opt_i("pageStatus").unwrap_or(1), fb.get("nextAction"), auth::now_iso(), fb.get("id"), pid],
        )
        .ok();
    });
    crate::web::audit_log(Some(&u.id), &u.email, "sources.upsert", &fb.get("id"), &crate::web::client_ip(&headers));
    redirect(&format!("/projects/{}/sources", pid))
}

// ============ 诊断报告 ============
pub async fn reports(headers: HeaderMap, Path(pid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT id, createdAt, type, title FROM reports WHERE projectId=? ORDER BY createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&pid], |r| {
                let (id, created, rtype, title): (String, String, i64, String) = (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?);
                Ok(format!(
                    "<tr><td>{}</td><td>{}</td><td class=\"wrap\"><a href=\"/reports/{}\"><b>{}</b></a></td><td><a class=\"btn small\" href=\"/reports/{}\">查看</a></td></tr>",
                    fmt_time(&created),
                    label_badge(REPORT_TYPE, rtype),
                    esc(&id),
                    esc(&title),
                    esc(&id)
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let mut stmt = c.prepare("SELECT id, createdAt FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC").unwrap();
        let tasks: Vec<(String, String)> = stmt.query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|x| x.ok()).collect();
        let mut stmt = c.prepare("SELECT text FROM questions WHERE projectId=? AND withBrand=0 LIMIT 20").unwrap();
        let questions: Vec<String> = stmt.query_map([&pid], |r| r.get(0)).unwrap().filter_map(|x| x.ok()).collect();

        let task_opts: Vec<(String, String)> = tasks
            .iter()
            .map(|(id, created)| (id.clone(), format!("{} ({})", fmt_time(created), id.chars().take(8).collect::<String>())))
            .collect();
        let q_opts: Vec<(String, String)> = questions.iter().map(|t| (t.clone(), t.clone())).collect();
        let plat_opts = enum_options(AI_PLATFORM);

        let err_html = q.get("e").map(|e| format!("<div class=\"notice warn\">{}</div>", esc(e))).unwrap_or_default();
        page_head(
            "诊断报告 / 监测报告",
            "分析品牌表现、平台偏好和引用源差距；关键词频次是逆向分析工具，不是 AI 平台公开的权重。",
            "",
        ) + &err_html
            + &card(
                "生成报告",
                &format!(
                    r#"<div class="row">
        <form method="post" action="/projects/{pid}/reports/create" class="inline">
          <input type="hidden" name="type" value="1"><button class="btn">品牌诊断报告</button>
        </form>
        <form method="post" action="/projects/{pid}/reports/create" class="inline">
          <input type="hidden" name="type" value="2"><button class="btn ghost">产品推荐诊断报告</button>
        </form>
        <form method="post" action="/projects/{pid}/reports/create" class="inline">
          <input type="hidden" name="type" value="5"><button class="btn ghost">AI 现状一页纸诊断</button>
        </form>
      </div>
      <div class="row" style="margin-top:12px">
        <form method="post" action="/projects/{pid}/reports/create" class="row" style="width:100%">
          <input type="hidden" name="type" value="3">
          <div><label class="f">优化前任务</label>{ta}</div>
          <div><label class="f">优化后任务</label>{tb}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">生成优化前后对比</button></div>
        </form>
      </div>
      <div class="row" style="margin-top:12px">
        <form method="post" action="/projects/{pid}/reports/create" class="row" style="width:100%">
          <input type="hidden" name="type" value="4">
          <div style="flex:2"><label class="f">逆向分析问题</label>{qq}</div>
          <div><label class="f">平台</label>{plat}</div>
          <div><label class="f">重复次数</label><input type="number" name="times" value="10"></div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">运行逆向分析（重复提问 N 次）</button></div>
        </form>
      </div>
      <div class="kv" style="margin-top:8px">对比必须保持同一问题、同一 AI 平台、相近监测条件；不同问题或平台的结果不能直接对比。</div>"#,
                    pid = esc(&pid),
                    ta = sel("taskIdA", &task_opts, "", "— 选择 —", false),
                    tb = sel("taskIdB", &task_opts, "", "— 选择 —", false),
                    qq = sel("question", &q_opts, "", "— 选择不带品牌名的问题 —", false),
                    plat = sel("platform", &plat_opts, "1", "", false),
                ),
            )
            + &card(
                "报告列表",
                &table_raw(
                    &["时间", "类型", "标题", ""],
                    &rows.join(""),
                    &empty_cta("还没有报告——生成品牌诊断或一页纸诊断（商务拜访直接可用）", "javascript:void(0)", "↑ 往上看生成入口"),
                ),
            )
    });
    crate::web::user_page(&u, "诊断报告", "reports", &pid, "", &body)
}

pub async fn reports_create(headers: HeaderMap, Path(pid): Path<String>, fb: Fb) -> Response {
    let u = match require_project(&headers, &pid) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let rtype = fb.opt_i("type").unwrap_or(1);
    let result = db::with_db(|c| {
        mock::create_report(
            c,
            &pid,
            rtype,
            &fb.get("taskIdA"),
            &fb.get("taskIdB"),
            &fb.get("question"),
            fb.opt_i("platform").unwrap_or(1),
            fb.opt_i("times").unwrap_or(10),
        )
    });
    match result {
        Ok((rid, _, _)) => {
            crate::web::audit_log(Some(&u.id), &u.email, "reports.create", &format!("{} type={}", rid, rtype), &crate::web::client_ip(&headers));
            redirect(&format!("/reports/{}", rid))
        }
        Err(e) => redirect_q(&format!("/projects/{}/reports", pid), &[("e", &e)]),
    }
}

// ============ 报告详情 / 导出 ============
pub async fn report_detail(headers: HeaderMap, Path(rid): Path<String>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row("SELECT projectId, type, title, content, createdAt FROM reports WHERE id=?", [&rid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })
        .ok()
    });
    let (pid, rtype, title, content, created) = match row {
        Some(x) => x,
        None => return html404(),
    };
    if !crate::web::project_owned(&u.id, &pid) {
        return html404();
    }
    let body = page_head(
        &title,
        &format!("{} · {}", label_badge(REPORT_TYPE, rtype), fmt_time(&created)),
        &format!(
            "<a class=\"btn\" href=\"/reports/{}/export\" target=\"_blank\">白标导出 / PDF</a> <a class=\"btn ghost\" href=\"/reports/{}/export?format=md\">Markdown</a> <a class=\"btn ghost\" href=\"/projects/{}/reports\">返回</a>",
            esc(&rid),
            esc(&rid),
            esc(&pid)
        ),
    ) + &card("", &format!("<div class=\"md-box md\">{}</div>", esc(&content)));
    crate::web::user_page(&u, "报告详情", "reports", &pid, "", &body)
}

pub async fn report_export(headers: HeaderMap, Path(rid): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let row = db::with_db(|c| {
        c.query_row("SELECT r.projectId, r.title, r.content, r.createdAt, COALESCE(p.brandName, p.name) FROM reports r JOIN projects p ON p.id=r.projectId WHERE r.id=?", [&rid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })
        .ok()
    });
    let (pid, title, content, created, brand) = match row {
        Some(x) => x,
        None => return html404(),
    };
    if !crate::web::project_owned(&u.id, &pid) {
        return html404();
    }
    if q.get("format").map(|f| f == "md").unwrap_or(false) {
        let md = format!("# {}\n\n{}\n", title, content);
        return (
            axum::http::StatusCode::OK,
            [
                (axum::http::header::CONTENT_TYPE, "text/markdown; charset=utf-8".to_string()),
                (axum::http::header::CONTENT_DISPOSITION, format!("attachment; filename=\"report-{}.md\"", rid.chars().take(8).collect::<String>())),
            ],
            md,
        )
            .into_response();
    }
    let doc = format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>{title}</title>
  <style>body{{font-family:-apple-system,"PingFang SC",sans-serif;max-width:820px;margin:0 auto;padding:40px;color:#1a2233;line-height:1.7}}
  h1{{font-size:22px;border-bottom:2px solid #4f46e5;padding-bottom:8px}}.meta{{color:#6b7280;font-size:13px;margin-bottom:24px}}
  pre{{white-space:pre-wrap;font-family:inherit;font-size:14px}}.brand{{position:fixed;top:16px;right:24px;font-weight:700;color:#4f46e5}}
  @media print{{.noprint{{display:none}}}}</style></head><body>
  <div class="brand">{brand}</div>
  <h1>{title}</h1>
  <div class="meta">报告日期：{date} ｜ 客户：{brand} ｜ 本报告由 GEO 优化系统生成，数据截至报告日期</div>
  <pre>{content}</pre>
  <p class="noprint" style="margin-top:24px"><button onclick="print()" style="padding:8px 18px;border:0;border-radius:8px;background:#4f46e5;color:#fff;cursor:pointer">打印 / 另存为 PDF</button>
  <a href="/reports/{rid}" style="margin-left:10px;color:#4f46e5">返回</a> ·
  <a href="/reports/{rid}/export?format=md" style="color:#4f46e5">下载 Markdown</a></p>
  </body></html>"#,
        title = esc(&title),
        brand = esc(&brand),
        date = &created[..10.min(created.len())],
        content = esc(&content),
        rid = esc(&rid),
    );
    use axum::response::IntoResponse;
    axum::response::Html(doc).into_response()
}

// ============ 系统设置导航 ============
fn settings_nav(active: &str) -> String {
    let tabs: [(&str, &str, &str); 4] = [
        ("keys", "API 密钥", "给 AI 助手（geo CLI / Skills）发放的平台接口密钥"),
        ("config", "服务集成", "LLM / AI 监测四平台 / 图像生成 / 对象存储 / 发布模式"),
        ("licenses", "卡密管理", "生成套餐卡密，线下收款后交付客户兑换"),
        ("audit", "操作审计", "全部登录与写操作留痕"),
    ];
    format!(
        "<div class=\"notice\" style=\"display:flex;gap:6px;flex-wrap:wrap;align-items:center\"><span class=\"kv\" style=\"margin-right:4px\">系统设置：</span>{}</div>",
        tabs.iter()
            .map(|(k, name, desc)| format!(
                "<a class=\"btn small {}\" href=\"/settings/{}\" title=\"{}\">{}</a>",
                if *k == active { "" } else { "ghost" },
                k,
                esc(desc),
                esc(name)
            ))
            .collect::<String>()
    )
}

#[allow(clippy::result_large_err)]
fn require_admin(headers: &HeaderMap) -> Result<crate::web::User, Response> {
    let u = require_user(headers)?;
    if u.role != "admin" {
        return Err(html403("系统设置仅管理员可见"));
    }
    Ok(u)
}

// ============ 系统设置 → Open Key ============
pub async fn settings_keys(headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT name, keyPrefix, authorizedProjectIds, boundDeviceId, lastUsedAt, revokedAt, id FROM openKeys WHERE userId=? ORDER BY createdAt DESC")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([&u.id], |r| {
                let (name, prefix, proj_ids, device, last_used, revoked, id): (String, String, String, Option<String>, Option<String>, Option<String>, String) = (
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                );
                let n_projects: usize = serde_json::from_str::<Vec<String>>(&proj_ids).map(|v| v.len()).unwrap_or(0);
                let status = if revoked.is_some() { badge("已过期") } else { badge("已授权") };
                let revoke_btn = if revoked.is_some() {
                    String::new()
                } else {
                    format!(
                        "<form method=\"post\" action=\"/settings/keys/revoke\" class=\"inline\" onsubmit=\"return confirm('确认吊销该密钥？使用它的 Skills 将立即失效。')\"><input type=\"hidden\" name=\"keyId\" value=\"{}\"><button class=\"btn small danger\">吊销</button></form>",
                        esc(&id)
                    )
                };
                Ok(format!(
                    "<tr><td>{}</td><td class=\"mono\">{}…</td><td>{}</td><td class=\"kv mono\">{}</td><td class=\"kv\">{}</td><td>{}</td><td>{}</td></tr>",
                    esc(&name),
                    esc(&prefix),
                    n_projects,
                    device.map(|d| crate::ui::trunc(&d, 8)).unwrap_or_else(|| "未绑定".into()),
                    last_used.map(|t| fmt_time(&t)).unwrap_or_else(|| "从未使用".into()),
                    status,
                    revoke_btn
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let mut stmt = c
            .prepare("SELECT p.id, p.name FROM projects p JOIN companies co ON p.companyId=co.id WHERE co.ownerUserId=?")
            .unwrap();
        let projects: Vec<(String, String)> = stmt.query_map([&u.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|x| x.ok()).collect();
        let created_html = q
            .get("created")
            .map(|k| {
                format!(
                    "<div class=\"notice\"><b>密钥只显示这一次，请立即复制：</b><div class=\"keybox\" style=\"margin-top:8px\">{}</div>请通过 <span class=\"mono\">geo auth login</span> 在本机录入，不要在聊天中输出。</div>",
                    esc(k)
                )
            })
            .unwrap_or_default();
        page_head(
            "API 密钥（Open Key）",
            "接口密钥只写入本地配置，不要发到群里、聊天窗口或公开仓库。Skills 完成初始化后，还需确认默认公司和产品。",
            "",
        ) + &settings_nav("keys")
            + &created_html
            + &card(
                "创建接口密钥",
                &format!(
                    r#"<form method="post" action="/settings/keys/create">
        <div class="row">
          <div><label class="f">密钥名称</label><input type="text" name="name" value="AI 助手密钥"></div>
          <div style="flex:2"><label class="f">授权项目（可多选）*</label>
            <select name="projectIds" multiple size="4" required>{opts}</select>
          </div>
          <div style="flex:0;align-self:flex-end"><button class="btn">创建密钥</button></div>
        </div>
      </form>"#,
                    opts = projects.iter().map(|(i, n)| format!("<option value=\"{}\">{}</option>", esc(i), esc(n))).collect::<String>(),
                ),
            )
            + &card(
                "我的密钥",
                &table_raw(&["名称", "前缀", "授权项目数", "绑定设备", "最近使用", "状态", ""], &rows.join(""), &empty("还没有密钥")),
            )
    });
    crate::web::user_page(&u, "Open Key", "keys", "", "", &body)
}

pub async fn settings_keys_create(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ids = fb.all("projectIds");
    if ids.is_empty() {
        return redirect("/settings/keys");
    }
    let key = db::with_db(|c| mock::create_open_key(c, &u.id, &fb.get("name"), &ids));
    crate::web::audit_log(Some(&u.id), &u.email, "openKey.create", &fb.get("name"), &crate::web::client_ip(&headers));
    redirect_q("/settings/keys", &[("created", &key)])
}

pub async fn settings_keys_revoke(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let _ = db::with_db(|c| mock::revoke_open_key(c, &u.id, &fb.get("keyId")));
    crate::web::audit_log(Some(&u.id), &u.email, "openKey.revoke", &fb.get("keyId"), &crate::web::client_ip(&headers));
    redirect("/settings/keys")
}

// ============ 系统设置 → 服务集成 ============
struct ConfigItem {
    group: &'static str,
    key: &'static str,
    label: &'static str,
    kind: &'static str, // text | secret | enum
    options: &'static [(&'static str, &'static str)],
    boot: bool,
    desc: &'static str,
}

const CONFIG_SCHEMA: &[ConfigItem] = &[
    ConfigItem { group: "llm", key: "LLM_BASE_URL", label: "API 地址", kind: "text", options: &[], boot: false, desc: "OpenAI 兼容端点" },
    ConfigItem { group: "llm", key: "LLM_API_KEY", label: "API Key", kind: "secret", options: &[], boot: false, desc: "" },
    ConfigItem { group: "llm", key: "LLM_MODEL", label: "模型", kind: "text", options: &[], boot: false, desc: "deepseek-chat / glm-4.6 / qwen-plus …" },
    ConfigItem { group: "monitor", key: "MONITOR_ARK_KEY", label: "豆包 · API Key", kind: "secret", options: &[], boot: false, desc: "火山方舟" },
    ConfigItem { group: "monitor", key: "MONITOR_DEEPSEEK_KEY", label: "DeepSeek · API Key", kind: "secret", options: &[], boot: false, desc: "" },
    ConfigItem { group: "monitor", key: "MONITOR_HUNYUAN_KEY", label: "元宝（混元）· API Key", kind: "secret", options: &[], boot: false, desc: "" },
    ConfigItem { group: "monitor", key: "MONITOR_DASHSCOPE_KEY", label: "通义千问 · API Key", kind: "secret", options: &[], boot: false, desc: "百炼兼容模式" },
    ConfigItem { group: "monitor", key: "MONITOR_MOCK", label: "演示回退（未配置平台的监测）", kind: "enum", options: &[("1", "允许演示数据（默认）"), ("0", "严格模式：未配置平台显式报错")], boot: false, desc: "生产建议 0" },
    ConfigItem { group: "image", key: "IMAGE_API_KEY", label: "图像 API Key", kind: "secret", options: &[], boot: false, desc: "配置后封面走真实文生图" },
    ConfigItem { group: "storage", key: "S3_ENDPOINT", label: "Endpoint", kind: "text", options: &[], boot: false, desc: "" },
    ConfigItem { group: "storage", key: "S3_BUCKET", label: "Bucket", kind: "text", options: &[], boot: false, desc: "" },
    ConfigItem { group: "storage", key: "S3_SECRET_KEY", label: "Secret Key", kind: "secret", options: &[], boot: false, desc: "" },
    ConfigItem { group: "publish", key: "PUBLISH_MODE", label: "发布模式", kind: "enum", options: &[("manual", "真实流程：确认后人工发布 + 回填（默认）"), ("webhook", "Webhook：推送到自建 RPA/客户端"), ("mock", "演示模式：几秒后模拟完成（仅培训）")], boot: false, desc: "" },
    ConfigItem { group: "security", key: "DISABLE_REGISTER", label: "关闭自助注册", kind: "enum", options: &[("0", "允许注册"), ("1", "关闭（管理员建号，生产建议）")], boot: false, desc: "" },
];

const GROUP_META: &[(&str, &str, &str)] = &[
    ("llm", "内容生成（LLM）", "文章/答案卡/50 问/知识库整理的生成引擎。Rust 版当前为模板引擎，配置项保留供真实 LLM 接入。"),
    ("monitor", "AI 监测（四平台）", "配了 Key 的平台走真实联网问答；未配置平台使用确定性 mock 模拟。"),
    ("image", "图像生成（封面/配图）", "配置后封面走真实文生图；未配置回落内置 SVG 封面。"),
    ("storage", "对象存储（S3 兼容）", "配置后素材与封面上对象存储；未配置存本地服务器 data/uploads。"),
    ("publish", "发布", "manual=真实流程（人工发布后回填）；mock=演示（发布确认后 4 秒自动结算）。"),
    ("security", "安全与访问", "注册开关等。"),
];

fn mask_secret(v: &str) -> String {
    let chars: Vec<char> = v.chars().collect();
    if chars.len() <= 8 {
        "••••••".to_string()
    } else {
        format!("{}••••••{}", chars[..3].iter().collect::<String>(), chars[chars.len() - 4..].iter().collect::<String>())
    }
}

pub async fn settings_config(headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_admin(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let groups: Vec<&str> = {
            let mut seen: Vec<&str> = Vec::new();
            for item in CONFIG_SCHEMA {
                if !seen.contains(&item.group) {
                    seen.push(item.group);
                }
            }
            seen
        };
        let groups_html: String = groups
            .iter()
            .map(|gid| {
                let meta = GROUP_META.iter().find(|(g, _, _)| g == gid).copied().unwrap_or((*gid, *gid, ""));
                let fields: String = CONFIG_SCHEMA
                    .iter()
                    .filter(|i| i.group == *gid)
                    .map(|item| {
                        let cur: String = c
                            .query_row("SELECT value FROM settings WHERE key=?", [item.key], |r| r.get(0))
                            .unwrap_or_default();
                        let field = match item.kind {
                            "enum" => sel(item.key, &item.options.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>(), &cur, "", false),
                            "secret" => {
                                if cur.is_empty() {
                                    format!("<input type=\"password\" name=\"{}\" value=\"\" placeholder=\"未配置\">", esc(item.key))
                                } else {
                                    format!("<input type=\"password\" name=\"{}\" value=\"\" placeholder=\"已配置（{}）· 留空保持不变\">", esc(item.key), esc(&mask_secret(&cur)))
                                }
                            }
                            _ => format!("<input type=\"text\" name=\"{}\" value=\"{}\">", esc(item.key), esc(&cur)),
                        };
                        format!(
                            "<div class=\"row\"><div style=\"flex:2\"><label class=\"f\">{}{}</label>{}</div></div>{}",
                            esc(item.label),
                            if item.boot { " <span class=\"badge b-warn\">重启生效</span>" } else { "" },
                            field,
                            if item.desc.is_empty() { String::new() } else { format!("<div class=\"kv\" style=\"margin:-4px 0 6px\">{}</div>", esc(item.desc)) }
                        )
                    })
                    .collect();
                format!(
                    "<div class=\"card\"><h2>{}</h2><div class=\"kv\" style=\"margin-bottom:10px\">{}</div><form method=\"post\" action=\"/settings/config/save\">{}<div style=\"margin-top:10px\"><button class=\"btn\">保存本组</button></div></form></div>",
                    esc(meta.1),
                    esc(meta.2),
                    fields
                )
            })
            .collect();
        let notice = if let Some(saved) = q.get("saved") {
            format!("<div class=\"notice\">✅ 已保存：{}</div>", esc(saved))
        } else {
            String::new()
        };
        page_head(
            "服务集成（真实化开关）",
            "真实化能力的全部开关与凭证。密钥脱敏显示，仅管理员可见。",
            "",
        ) + &settings_nav("config")
            + &notice
            + &groups_html
    });
    crate::web::user_page(&u, "系统配置", "config", "", "", &body)
}

pub async fn settings_config_save(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_admin(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let mut saved: Vec<String> = Vec::new();
    db::with_db(|c| {
        for item in CONFIG_SCHEMA {
            if let Some(v) = fb.0.iter().find(|(k, _)| k == item.key) {
                let val = v.1.trim();
                // secret：留空保持原值
                if item.kind == "secret" && val.is_empty() {
                    continue;
                }
                c.execute(
                    "INSERT INTO settings (key, value, updatedAt) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt",
                    rusqlite::params![item.key, val, auth::now_iso()],
                )
                .ok();
                saved.push(item.key.to_string());
            }
        }
    });
    crate::web::audit_log(Some(&u.id), &u.email, "settings.save", &saved.join("、"), &crate::web::client_ip(&headers));
    redirect_q("/settings/config", &[("saved", &saved.join("、"))])
}

// ============ 卡密管理 ============
pub async fn licenses(headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_admin(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT key, planCode, status, usedByOrg, note FROM licenseKeys ORDER BY createdAt DESC LIMIT 100")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([], |r| {
                let (key, plan, status, used_by, note): (String, String, String, Option<String>, Option<String>) =
                    (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
                let st = if status == "unused" {
                    "<span class=\"badge b-ok\">未使用</span>".to_string()
                } else if status == "used" {
                    "<span class=\"badge b-gray\">已使用</span>".to_string()
                } else {
                    "<span class=\"badge b-bad\">已作废</span>".to_string()
                };
                let org_name: String = used_by
                    .and_then(|org| c.query_row("SELECT name FROM orgs WHERE id=?", [org], |r| r.get(0)).ok())
                    .unwrap_or_default();
                Ok(format!(
                    "<tr><td class=\"mono\">{}</td><td>{}</td><td>{}</td><td class=\"kv\">{}</td><td class=\"kv\">{}</td></tr>",
                    esc(&key),
                    badge(mock::plan_by_code(&plan).map(|p| p.name).unwrap_or(&plan)),
                    st,
                    if org_name.is_empty() { "—".to_string() } else { esc(&org_name) },
                    esc(note.as_deref().unwrap_or(""))
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let generated_html = q.get("generated").and_then(|g| serde_json::from_str::<Vec<String>>(g).ok()).map(|keys| {
            format!(
                "<div class=\"notice\"><b>新卡密（只显示这一次，请复制交付客户）：</b><div class=\"keybox\" style=\"margin-top:8px\">{}</div></div>",
                keys.iter().map(|k| esc(k)).collect::<Vec<_>>().join("<br>")
            )
        }).unwrap_or_default();
        let plan_opts: Vec<(String, String)> = mock::PLANS
            .iter()
            .map(|p| (p.code.to_string(), format!("{}（{},{} 天，监测 {} 次/月）", p.name, "按套餐定价", p.duration_days, p.monitor_quota_monthly)))
            .collect();
        page_head(
            "卡密管理",
            "生成套餐卡密 → 线下收款后交付客户 → 客户在「团队成员」页兑换开通。无需在线支付接口。",
            "",
        ) + &settings_nav("licenses")
            + &generated_html
            + &card(
                "生成卡密",
                &format!(
                    r#"<form method="post" action="/settings/licenses/generate" class="row">
        <div><label class="f">套餐</label>{}</div>
        <div><label class="f">数量</label><input type="number" name="count" value="1" min="1" max="100"></div>
        <div><label class="f">备注</label><input type="text" name="note" placeholder="如：客户名称"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">生成</button></div>
      </form>"#,
                    sel("planCode", &plan_opts, "basic", "", false)
                ),
            )
            + &card(
                "卡密列表（最近 100）",
                &table_raw(&["卡密", "套餐", "状态", "使用组织", "备注"], &rows.join(""), &empty("还没有卡密")),
            )
    });
    crate::web::user_page(&u, "卡密管理", "licenses", "", "", &body)
}

pub async fn licenses_generate(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_admin(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let result = db::with_db(|c| mock::generate_license_keys(c, &fb.get("planCode"), fb.opt_i("count").unwrap_or(1), &fb.get("note")));
    match result {
        Ok(keys) => {
            crate::web::audit_log(Some(&u.id), &u.email, "licenses.generate", &format!("{} 张", keys.len()), &crate::web::client_ip(&headers));
            redirect_q("/settings/licenses", &[("generated", &serde_json::to_string(&keys).unwrap_or_default())])
        }
        Err(_) => redirect("/settings/licenses"),
    }
}

// ============ 操作审计 ============
pub async fn audit_page(headers: HeaderMap) -> Response {
    let u = match require_admin(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let mut stmt = c
            .prepare("SELECT createdAt, email, action, target, ip FROM auditLog ORDER BY createdAt DESC LIMIT 200")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([], |r| {
                let (ts, email, action, target, ip): (String, Option<String>, String, Option<String>, Option<String>) =
                    (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
                Ok(format!(
                    "<tr><td class=\"kv\">{}</td><td>{}</td><td><b>{}</b></td><td class=\"wrap kv\">{}</td><td class=\"kv mono\">{}</td></tr>",
                    fmt_time(&ts),
                    esc(email.as_deref().unwrap_or("—")),
                    esc(&action),
                    esc(target.as_deref().unwrap_or("")),
                    esc(ip.as_deref().unwrap_or(""))
                ))
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        page_head("操作审计日志", "全部登录与写操作留痕（保留 90 天，由每日运维脚本自动清理）。", "")
            + &settings_nav("audit")
            + &card("最近 200 条", &table_raw(&["时间", "账号", "操作", "目标/内容", "IP"], &rows.join(""), &empty("暂无记录")))
    });
    crate::web::user_page(&u, "操作审计", "config", "", "", &body)
}

// ============ 团队成员 ============
const ROLE_NAMES: &[(&str, &str)] = &[("owner", "所有者"), ("manager", "管理者"), ("operator", "操作员"), ("viewer", "只读")];

fn role_name(r: &str) -> String {
    ROLE_NAMES.iter().find(|(k, _)| *k == r).map(|(_, v)| v.to_string()).unwrap_or_else(|| r.to_string())
}

fn primary_org_id(c: &rusqlite::Connection, user_id: &str) -> String {
    c.query_row("SELECT orgId FROM orgMembers WHERE userId=? ORDER BY createdAt LIMIT 1", [user_id], |r| r.get(0)).unwrap_or_default()
}

fn member_role(c: &rusqlite::Connection, org_id: &str, user_id: &str) -> String {
    c.query_row("SELECT role FROM orgMembers WHERE orgId=? AND userId=?", [org_id, user_id], |r| r.get(0)).unwrap_or_default()
}

pub async fn team(headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = db::with_db(|c| {
        let org_id = primary_org_id(c, &u.id);
        if org_id.is_empty() {
            return page_head("团队成员", "还没有组织", "") + &card("", &empty("请联系管理员初始化组织"));
        }
        let role = member_role(c, &org_id, &u.id);
        let org_name: String = c.query_row("SELECT name FROM orgs WHERE id=?", [&org_id], |r| r.get(0)).unwrap_or_default();
        let (plan_code, plan_expires, quota, webhook): (Option<String>, Option<String>, i64, Option<String>) = c
            .query_row("SELECT planCode, planExpiresAt, quotaMonitorMonthly, notifyWebhook FROM orgs WHERE id=?", [&org_id], |r| {
                Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?))
            })
            .unwrap_or((None, None, 0, None));
        let mut stmt = c
            .prepare("SELECT om.id, om.role, om.createdAt, u.email FROM orgMembers om JOIN users u ON om.userId=u.id WHERE om.orgId=? ORDER BY om.createdAt")
            .unwrap();
        let members: Vec<(String, String, String, String)> = stmt
            .query_map([&org_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        let month = &auth::now_iso()[..7];
        let usage: Vec<(String, i64)> = {
            let mut s2 = c.prepare("SELECT type, SUM(count) FROM usageCounters WHERE orgId=? AND day LIKE ? GROUP BY type").unwrap();
            s2.query_map(rusqlite::params![org_id, format!("{}%", month)], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .unwrap()
                .filter_map(|x| x.ok())
                .collect()
        };
        let is_owner = role == "owner" || u.role == "admin";
        let active_plan = plan_code.clone().and_then(|pc| mock::plan_by_code(&pc)).filter(|_| plan_expires.as_deref().map(|e| e > auth::now_iso().as_str()).unwrap_or(false));

        let member_rows: Vec<String> = members
            .iter()
            .map(|(mid, mrole, created, email)| {
                let ops = if is_owner && mrole != "owner" {
                    let role_opts: Vec<(String, String)> = ROLE_NAMES.iter().filter(|(k, _)| *k != "owner").map(|(k, v)| (k.to_string(), v.to_string())).collect();
                    format!(
                        "<form method=\"post\" action=\"/team/role\" class=\"inline\" style=\"margin-right:6px\"><input type=\"hidden\" name=\"memberId\" value=\"{}\">{}<button class=\"btn small ghost\">改角色</button></form>\
                         <form method=\"post\" action=\"/team/remove\" class=\"inline\" onsubmit=\"return confirm('确认移除该成员？')\"><input type=\"hidden\" name=\"memberId\" value=\"{}\"><button class=\"btn small danger\">移除</button></form>",
                        esc(mid),
                        sel("role", &role_opts, mrole, "", false),
                        esc(mid)
                    )
                } else {
                    String::new()
                };
                format!(
                    "<tr><td>{}</td><td>{}</td><td class=\"kv\">{}</td><td>{}</td></tr>",
                    esc(email),
                    badge(&role_name(mrole)),
                    fmt_time(created),
                    ops
                )
            })
            .collect();

        let saved_html = q.get("saved").map(|_| "<div class=\"notice\">✅ 已保存</div>".to_string()).unwrap_or_default();
        let err_html = q.get("e").map(|e| format!("<div class=\"notice warn\">{}</div>", esc(e))).unwrap_or_default();

        let mut out = page_head(
            "团队成员",
            &format!("组织：{} ｜ 你的角色：{}", esc(&org_name), role_name(&role)),
            "",
        ) + &saved_html
            + &err_html
            + &card(
                &format!("成员（{}）", members.len()),
                &table_raw(&["邮箱", "角色", "加入时间", ""], &member_rows.join(""), ""),
            );
        if is_owner {
            let role_opts: Vec<(String, String)> = vec![
                ("manager".into(), "管理者".into()),
                ("operator".into(), "操作员".into()),
                ("viewer".into(), "只读".into()),
            ];
            let plan_html = format!(
                "<div class=\"kv\">当前套餐：<b>{}</b>{}</div>",
                active_plan.as_ref().map(|p| p.name.to_string()).unwrap_or_else(|| "未订阅（自部署/不限量）".to_string()),
                active_plan
                    .as_ref()
                    .and_then(|_| plan_expires.clone())
                    .map(|e| format!("，有效期至 {}", &e[..10.min(e.len())]))
                    .unwrap_or_default()
            );
            let usage_rows: Vec<String> = if usage.is_empty() {
                vec!["<tr><td colspan=\"2\" class=\"kv\">本月暂无调用</td></tr>".to_string()]
            } else {
                usage.iter().map(|(t, n)| format!("<tr><td>{}</td><td><b>{}</b></td></tr>", esc(t), n)).collect()
            };
            out.push_str(&card(
                "邀请成员（须已注册）",
                &format!(
                    r#"<form method="post" action="/team/invite" class="row">
        <div style="flex:2"><label class="f">成员邮箱（须已在本平台注册）</label><input type="email" name="email" required></div>
        <div><label class="f">角色</label>{}</div>
        <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
      </form>
      <div class="kv" style="margin-top:6px">角色说明：管理者=业务全部（不含成员/系统配置）；操作员=日常操作；只读=仅查看。注册关闭时先由管理员为成员开号。</div>"#,
                    sel("role", &role_opts, "operator", "", false)
                ),
            ));
            out.push_str(&card(
                "订阅套餐",
                &format!(
                    "{}<form method=\"post\" action=\"/team/redeem\" class=\"row\" style=\"margin-top:8px\">\
        <div style=\"flex:2\"><label class=\"f\">卡密兑换（线下收款后交付的卡密）</label><input type=\"text\" name=\"key\" placeholder=\"GEO-BASIC-XXXX-XXXX-XXXX\" required></div>\
        <div style=\"flex:0;align-self:flex-end\"><button class=\"btn\">兑换开通</button></div>\
      </form>",
                    plan_html
                ),
            ));
            out.push_str(&card(
                "事件通知",
                &format!(
                    r#"<div class="kv">监测完成、发布完成时推送到你的 Webhook（企微机器人/自建系统均可）。</div>
      <form method="post" action="/team/notify" class="row" style="margin-top:8px">
        <div style="flex:2"><label class="f">Webhook 地址</label><input type="text" name="notifyWebhook" value="{}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">保存</button></div>
      </form>"#,
                    esc(webhook.as_deref().unwrap_or(""))
                ),
            ));
            out.push_str(&card(
                "用量与配额",
                &format!(
                    "<table><tr><th>本月用量</th><th>次数</th></tr>{}</table>\
      <form method=\"post\" action=\"/team/quota\" class=\"row\" style=\"margin-top:10px\">\
        <div><label class=\"f\">监测调用月配额（0 = 不限制）</label><input type=\"number\" name=\"quotaMonitorMonthly\" value=\"{}\"></div>\
        <div style=\"flex:0;align-self:flex-end\"><button class=\"btn\">保存配额</button></div>\
      </form>",
                    usage_rows.join(""),
                    quota
                ),
            ));
        }
        out
    });
    crate::web::user_page(&u, "团队成员", "team", "", "", &body)
}

pub async fn team_invite(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let (org_id, target_id) = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return (String::new(), String::new());
        }
        let target: String = c.query_row("SELECT id FROM users WHERE email=?", [&fb.get("email")], |r| r.get(0)).unwrap_or_default();
        (org, target)
    });
    if org_id.is_empty() {
        return html403("仅团队所有者可邀请成员");
    }
    if target_id.is_empty() {
        return redirect("/team?e=该邮箱尚未注册：请先由管理员为其创建账号，再邀请");
    }
    let already = db::with_db(|c| {
        c.query_row("SELECT id FROM orgMembers WHERE orgId=? AND userId=?", [&org_id, &target_id], |r| r.get::<_, String>(0)).is_ok()
    });
    if already {
        return redirect("/team?e=该成员已在团队中");
    }
    let new_role = fb.get("role");
    let new_role = if ["manager", "operator", "viewer"].contains(&new_role.as_str()) { new_role } else { "operator".to_string() };
    db::with_db(|c| {
        c.execute(
            "INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
            rusqlite::params![auth::gen_uuid(), org_id, target_id, new_role, auth::now_iso()],
        )
        .ok();
    });
    crate::web::audit_log(Some(&u.id), &u.email, "team.invite", &format!("{} role={}", fb.get("email"), new_role), &crate::web::client_ip(&headers));
    redirect("/team?saved=1")
}

pub async fn team_role(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ok = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return false;
        }
        let target_role: String = c
            .query_row("SELECT role FROM orgMembers WHERE id=? AND orgId=?", [&fb.get("memberId"), &org], |r| r.get(0))
            .unwrap_or_default();
        if target_role == "owner" || target_role.is_empty() {
            return false;
        }
        let new_role = fb.get("role");
        if !["manager", "operator", "viewer"].contains(&new_role.as_str()) {
            return false;
        }
        c.execute("UPDATE orgMembers SET role=? WHERE id=?", rusqlite::params![new_role, fb.get("memberId")]).is_ok()
    });
    if !ok {
        return html403("仅团队所有者可改角色");
    }
    redirect("/team?saved=1")
}

pub async fn team_remove(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ok = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return false;
        }
        let target_role: String = c
            .query_row("SELECT role FROM orgMembers WHERE id=? AND orgId=?", [&fb.get("memberId"), &org], |r| r.get(0))
            .unwrap_or_default();
        if target_role.is_empty() || target_role == "owner" {
            return false;
        }
        c.execute("DELETE FROM orgMembers WHERE id=?", [&fb.get("memberId")]).is_ok()
    });
    if !ok {
        return html403("仅团队所有者可移除成员");
    }
    redirect("/team?saved=1")
}

pub async fn team_redeem(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let result = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return Err("仅团队所有者可兑换卡密".to_string());
        }
        mock::redeem_license_key(c, &org, &fb.get("key"))
    });
    match result {
        Ok((plan_name, expires)) => {
            crate::web::audit_log(Some(&u.id), &u.email, "license.redeem", &format!("{} → {}", fb.get("key"), plan_name), &crate::web::client_ip(&headers));
            redirect(&format!("/team?saved=已开通 {}，有效期至 {}", plan_name, &expires[..10.min(expires.len())]))
        }
        Err(e) => redirect_q("/team", &[("e", &e)]),
    }
}

pub async fn team_quota(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ok = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return false;
        }
        c.execute("UPDATE orgs SET quotaMonitorMonthly=? WHERE id=?", rusqlite::params![fb.opt_i("quotaMonitorMonthly").unwrap_or(0).max(0), org]).is_ok()
    });
    if !ok {
        return html403("仅团队所有者可配置额");
    }
    redirect("/team?saved=1")
}

pub async fn team_notify(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let ok = db::with_db(|c| {
        let org = primary_org_id(c, &u.id);
        let role = member_role(c, &org, &u.id);
        if org.is_empty() || (role != "owner" && u.role != "admin") {
            return false;
        }
        c.execute(
            "UPDATE orgs SET notifyWebhook=?, notifyEvents=? WHERE id=?",
            rusqlite::params![fb.get("notifyWebhook"), serde_json::json!(["monitor.done", "publish.done"]).to_string(), org],
        )
        .is_ok()
    });
    if !ok {
        return html403("仅团队所有者可配置通知");
    }
    redirect("/team?saved=1")
}

// ============ 一键 GEO ============
pub async fn auto_geo_page(headers: HeaderMap) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let body = page_head("🚀 一键 GEO", "粘贴你的项目文档（README/产品介绍/代码注释等），AI 自动提取产品信息并跑通完整 GEO 流程", "")
        + &card(
            "一键 GEO",
            r#"<div class="notice">粘贴你的项目文档（README、产品介绍、代码说明等），自动完成：知识库六模块整理 → 50 问生成 → 品牌文章创作 → 三道审核 → 上榜监测。全程无需手工填表。</div>
      <form method="post" action="/auto-geo/run">
        <label class="f">项目/产品名称（可选，系统会自动提取）</label>
        <input type="text" name="productName" placeholder="如：LikeClaw AI 数字员工">
        <label class="f">项目文档 *</label>
        <textarea name="rawContent" class="code" style="min-height:200px" required placeholder="粘贴 README.md、产品介绍、功能说明等。内容越丰富，提取越准确。"></textarea>
        <div style="margin-top:12px"><button class="btn" style="font-size:15px;padding:12px 32px">🚀 一键 GEO</button></div>
      </form>"#,
        );
    crate::web::user_page(&u, "一键 GEO", "auto-geo", "", "", &body)
}

pub async fn auto_geo_run(headers: HeaderMap, fb: Fb) -> Response {
    let u = match require_user(&headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let result = db::with_db(|c| mock::auto_geo(c, &u.id, &fb.get("rawContent")));
    match result {
        Ok(r) => {
            crate::web::audit_log(Some(&u.id), &u.email, "auto-geo.run", &r.project_id, &crate::web::client_ip(&headers));
            let audit_text = match r.audit_verdict {
                Some(2) => "✅ 通过",
                Some(1) => "⚠️ 修改后通过",
                Some(0) => "❌ 不通过",
                _ => "未执行",
            };
            let body = page_head(
                "🚀 一键 GEO 完成",
                &format!("产品：{} ｜ 耗时自动", esc(&r.product_name)),
                "",
            ) + &card(
                "✅ 提取的产品信息",
                &format!(
                    "<div class=\"kv\"><p><b>产品名：</b>{}</p><p><b>一句话定位：</b>{}</p><p><b>主营业务：</b>{}</p><p><b>卖点：</b>{}</p><p><b>关键词：</b>{}</p></div>",
                    esc(&r.product_name),
                    esc(&r.one_line),
                    esc(&r.business),
                    esc(&r.selling_points),
                    esc(&r.keywords)
                ),
            )
            + &card(
                "✅ 自动创建的 GEO 资产",
                &format!(
                    "<table><tr><td>知识库六模块</td><td>{} 篇文档</td></tr><tr><td>问题池</td><td>{} 个问题</td></tr><tr><td>品牌文章</td><td>{}</td></tr><tr><td>三道审核</td><td>{}</td></tr><tr><td>上榜监测</td><td>{}</td></tr></table>",
                    r.knowledge_docs,
                    r.question_count,
                    esc(&r.article_title),
                    audit_text,
                    if r.monitor_task_id.is_some() { "✅ 已创建并执行首轮" } else { "未创建" }
                ),
            )
            + &card(
                "📌 下一步",
                &format!(
                    "<ol>{}</ol><div style=\"margin-top:12px\"><a class=\"btn\" href=\"/projects/{}\">进入项目 →</a><a class=\"btn ghost\" href=\"/auto-geo\">再导入一个项目</a></div>",
                    r.next_steps.iter().map(|s| format!("<li>{}</li>", esc(s))).collect::<Vec<_>>().join(""),
                    esc(&r.project_id)
                ),
            );
            crate::web::user_page(&u, "一键 GEO 结果", "auto-geo", "", "", &body)
        }
        Err(e) => {
            let body = page_head("🚀 一键 GEO", "", "")
                + &format!("<div class=\"card\"><h2>❌ 执行失败</h2><p class=\"kv\">{}</p><p><a href=\"/auto-geo\">返回重试</a></p></div>", esc(&e));
            crate::web::user_page(&u, "一键 GEO", "auto-geo", "", "", &body)
        }
    }
}

// uploads 静态文件（封面 SVG 等）
pub async fn upload_file(Path(name): Path<String>) -> Response {
    use axum::response::IntoResponse;
    // 文件名白名单校验，防目录逃逸
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return html404();
    }
    let dir = mock::uploads_dir();
    let path = std::path::Path::new(&dir).join(&name);
    match std::fs::read(&path) {
        Ok(bytes) => {
            let mime = if name.ends_with(".svg") {
                "image/svg+xml"
            } else if name.ends_with(".png") {
                "image/png"
            } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
                "image/jpeg"
            } else {
                "application/octet-stream"
            };
            (
                axum::http::StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, mime.to_string())],
                bytes,
            )
                .into_response()
        }
        Err(_) => html404(),
    }
}
