// 真实化 Provider：OpenAI 兼容 LLM 客户端 + 设置加载 + 方法论提示词 + 真实监测评估
// 语义对齐 Node 版 providers/llm.js 与 providers/monitor.js（真实路径）：
//   - 配置来源：DB settings 表优先，部署环境变量回落（对齐 Node applySettingsToEnv）
//   - 未配置 → 调用方回落确定性模板（Node 同语义：显式回落并记录）
//   - 网络调用一律不持有 DB 锁（调用方负责在 with_db 闭包之外调用 chat/monitor）
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::mock::Project;

// ============ 设置加载 ============
pub fn settings_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key=?", [key], |r| r.get(0))
        .ok()
        .map(|v: String| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// settings 表有值优先，空值回落部署环境变量（对齐 Node applySettingsToEnv）
fn cfg_get(conn: &Connection, key: &str) -> Option<String> {
    settings_get(conn, key).or_else(|| std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()))
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// LLM 配置（base/key/model 任一缺失 → None = 未配置真实生成）
pub fn load_llm_config(conn: &Connection) -> Option<LlmConfig> {
    let base_url = cfg_get(conn, "LLM_BASE_URL")?.trim_end_matches('/').to_string();
    let api_key = cfg_get(conn, "LLM_API_KEY")?;
    let model = cfg_get(conn, "LLM_MODEL").unwrap_or_else(|| "default".to_string());
    Some(LlmConfig { base_url, api_key, model })
}

pub fn is_real(conn: &Connection) -> bool {
    load_llm_config(conn).is_some()
}

// ============ OpenAI 兼容客户端 ============
/// chat/completions 调用（同步；不得在 with_db 闭包内调用——网络调用不持锁）
pub fn chat(cfg: &LlmConfig, user_prompt: &str, system_prompt: Option<&str>, timeout_secs: u64) -> Result<String, String> {
    let mut messages = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(json!({"role": "system", "content": sys}));
    }
    messages.push(json!({"role": "user", "content": user_prompt}));
    let body = json!({"model": cfg.model, "messages": messages, "temperature": 0.7});

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build();
    let resp = agent
        .post(&format!("{}/chat/completions", cfg.base_url))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", cfg.api_key))
        .send_string(&body.to_string())
        .map_err(|e| format!("LLM 调用失败: {}", e))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| format!("LLM 响应读取失败: {}", e))?;
    if status != 200 {
        return Err(format!("LLM {}: {}", status, text.chars().take(200).collect::<String>()));
    }
    let data: Value = serde_json::from_str(&text).map_err(|e| format!("LLM 响应解析失败: {}", e))?;
    let content = extract_content(&data);
    if content.is_empty() {
        return Err("LLM 返回了空回答".to_string());
    }
    Ok(content)
}

/// 提取回答内容：content 为空时回落 reasoning 字段（推理模型兜底，对齐 Node runMonitorLLM）
pub fn extract_content(data: &Value) -> String {
    let msg = &data["choices"][0]["message"];
    let content = msg["content"].as_str().unwrap_or("").trim().to_string();
    if !content.is_empty() {
        return content;
    }
    // 推理模型：从 reasoning 中取最后几段有意义文字
    if let Some(reasoning) = msg["reasoning"].as_str() {
        let lines: Vec<&str> = reasoning
            .split(['。', '！', '？', '\n'])
            .filter(|x| x.trim().chars().count() > 10)
            .collect();
        let tail: Vec<&str> = lines.iter().rev().take(3).rev().cloned().collect();
        if !tail.is_empty() {
            return tail.join("。");
        }
        return reasoning.chars().rev().take(200).collect::<String>().chars().rev().collect();
    }
    String::new()
}

// ============ 方法论提示词（严格按 Node PROMPTS 原文） ============
pub fn prompt_questions50(p: &Project) -> String {
    format!(
        "你是一位资深 GEO（生成式引擎优化）专家，擅长根据消费者的真实决策路径构建意图题库。\n背景信息：\n- 品牌名称：【{}】\n- 所在区域：【{}】\n- 主营业务与目标人群：【{}】\n- 核心差异化卖点：【{}】\n- 核心品类搜索词：【{}】\n\n任务要求：生成 50 个真实消费者在选购前会向 AI 提问的口语化问题。\n\n结构规范：\n一、综合选购（5条）：核心词直接提问（哪家好/推荐/品牌排行）。\n二、场景选购（9条）：覆盖至少 5 个具体场景。\n三、人群选购（9条）：覆盖至少 5 类细分人群。\n四、痛点选购（9条）：覆盖至少 5 个顾虑或痛点。\n五、功能选购（9条）：围绕差异化卖点提问。\n六、决策选购（9条）：从价格标准、距离、口碑资质等角度提问。\n\n核心规则：\n1. 每条问题必须包含\"哪家好/推荐/怎么选/排行\"等促使 AI 输出品牌名单的词。\n2. 严禁出现我们的品牌名称；严禁混入纯科普类问题。\n3. 语言口语化，符合普通用户在对话框的打字习惯，每条 10-25 字。",
        p.brand_name, p.region, p.business, p.selling_points, p.keywords
    )
}

pub fn prompt_organize_knowledge(brand: &str, raw: &str) -> String {
    format!(
        "我是【{}】的负责人，正在为 GEO 基础建设搭建品牌标准知识库。后续所有对外宣发与内容生成均需严格以此库为唯一事实依据。\n\n请基于我提供的公司与产品材料，整理生成以下 6 个标准的 Markdown 模块：\n- 01_定位与业务边界：包含 50 字精准定位、明确的服务人群、核心场景和明确不做的业务边界。\n- 02_产品与服务事实：产品/课程名称、标准价格、服务时长、适用范围、核心功能参数、服务流程和交付内容。\n- 03_客户与使用场景：目标客户画像、典型需求、使用场景、决策条件和常见问题。\n- 04_优势与竞品差异：与行业同行的客观差异点、比较维度和可核验证据（内部使用）。\n- 05_案例与结果：客户背景、问题、实施过程、交付内容、结果变化、客户评价和可公开的前后对比。\n- 06_权威背书与外部证据：已获得的资质、认证、奖项、官方报道、合作方页面和第三方引用（注明机构、编号、时间或原始链接）。\n\n另外，请基于以上 6 个模块生成一个\"品牌高频 Q&A 问答索引\"，用于内容创作和销售沟通；问答索引不是独立事实来源，所有答案必须能回溯到六大模块。\n\n整理铁律：\n1. 严格以提供的事实为准，严禁编造任何参数、资质或数字。\n2. 遇到资料不完整之处，统一标注「【待补充：需业务部门提供】」。\n3. 发现不同资料中存在数据冲突时，单独列出「口径冲突清单」供我确认。\n4. 每条重要事实尽量保留来源、时间和原始链接，便于 AI 和人工交叉核验。\n\n以下是公司材料：\n{}",
        brand, raw
    )
}

pub fn prompt_answer_card(q: &str) -> String {
    format!(
        "请基于【品牌知识库】和【目标问题】，创建一张可发布的 AI 答案卡。\n要求：\n1. 先给直接结论，再给判断标准、推荐理由、适用边界和下一步行动。\n2. 所有品牌、产品、价格、案例和数据必须来自知识库；缺失信息标注待补充。\n3. 内容必须围绕用户问题回答，不得写成泛泛品牌宣传。\n4. 输出文章版正文、图片版文案和视频口播版脚本三种形式。\n5. 完成后进入三道审核：知识库一致性、媒体投稿标准、GEO 相关性与可信度。\n\n目标问题：{}",
        q
    )
}

pub fn prompt_brand_article(q: &str) -> String {
    format!(
        "请基于【品牌知识库】、【目标问题】和【可公开证据】，创建一篇品牌优化文章。\n写作要求：\n- 围绕用户真实决策问题组织内容，结论先行。\n- 使用清晰的一级标题、二级标题、三级标题；段落短，关键事实可被单独抽取。\n- 明确适用对象、选择标准、真实案例、数据来源、边界和更新时间。\n- 保留第三方可核验的原始链接，不编造案例、资质、数字或评价。\n- 避免空泛口号、重复关键词、过度营销和无法证明的第一名表述。\n请同时输出：文章标题、正文、证据清单、引用链接、待审核事实。\n\n目标问题：{}",
        q
    )
}

pub fn prompt_product_article(q: &str, product: &str) -> String {
    format!(
        "请围绕用户问题\"{}\"，为【{}】创建一篇产品推荐文章。\n先判断用户需要什么证据，再组织文章：\n1. 适合谁：对象、场景、需求和使用条件。\n2. 为什么推荐：功能事实、过程证据、真实案例或第三方评价。\n3. 如何比较：与替代方案的客观差异，不贬低竞品。\n4. 不适合谁：限制条件、风险和不能保证的结果。\n5. 如何行动：预约、咨询、体验或购买入口。\n所有事实以知识库为准，不能用 AI 推测替代证据。",
        q, product
    )
}

pub const ARTICLE_SYSTEM: &str = "你是 GEO 内容生成引擎。严格只输出一个 JSON 对象：{\"title\":\"文章标题\",\"content\":\"完整正文（Markdown）\"}，禁止输出 JSON 以外的任何解释文字。";

/// 文章 JSON 解析：非 JSON 输出整体采用、标题从问题推导（对齐 Node createArticleWithLlm 兜底）
pub fn parse_article_json(text: &str, question: &str) -> (String, String) {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();
    if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
        let title = v["title"].as_str().unwrap_or("").trim().to_string();
        let content = v["content"].as_str().unwrap_or("").trim().to_string();
        if !content.is_empty() {
            return (crate::ui::trunc(&title, 120).trim_end_matches('\u{2026}').to_string(), content);
        }
    }
    // 兜底：正文整体采用，标题从问题推导
    let q: String = question.chars().filter(|c| *c != '？' && *c != '?').collect();
    let title = crate::ui::trunc(&q, 30).trim_end_matches('\u{2026}').to_string();
    (title, text.trim().to_string())
}

// ============ 50 问解析（宽容适配；Node 版此处未定义 parseQuestionLines，属潜在 bug） ============
/// 解析 LLM 输出的问题行：支持「1. xxx（维度）」「1、xxx」「- xxx」「裸行」
pub fn parse_question_lines(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let mut line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('|') {
            continue;
        }
        // 小节标题行（一、综合选购（5条） 等）不是问题
        if ["一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、", "结构规范", "核心规则", "任务要求"]
            .iter()
            .any(|p| line.starts_with(p))
        {
            continue;
        }
        // 去序号：1. 1、 1) (1) -
        for p in ["、", ". ", ".）", "．", ") ", "）"] {
            if let Some(rest) = line.strip_prefix(|c: char| c.is_ascii_digit()).map(|s| s.trim_start_matches(|c: char| c.is_ascii_digit())) {
                let rest = rest.trim_start();
                if let Some(stripped) = rest.strip_prefix(p) {
                    line = stripped.trim();
                    break;
                }
            }
        }
        if let Some(rest) = line.strip_prefix("- ") {
            line = rest.trim();
        }
        if let Some(rest) = line.strip_prefix("•") {
            line = rest.trim();
        }
        if line.starts_with(|c: char| c.is_ascii_digit()) {
            // 序号后没有可识别分隔符（如 "1哪家好"）——保留原样
        }
        if line.chars().count() < 6 {
            continue;
        }
        // 拆维度：（xxx选购）尾部
        let (text, dim) = match (line.rfind('（'), line.ends_with('）')) {
            (Some(i), true) => (line[..i].trim().to_string(), line[i + 3..line.len() - 3].trim().to_string()),
            _ => (line.to_string(), String::new()),
        };
        let text = text.trim_end_matches(['。', '？', '?']).to_string();
        if text.chars().count() >= 6 {
            out.push((text, dim));
        }
        if out.len() >= 50 {
            break;
        }
    }
    out
}

// ============ 知识库整理解析（## NN_ 模块分段，对齐 Node organizeWithLlm） ============
pub struct OrganizeDoc {
    pub module: i64,
    pub title: String,
    pub content: String,
    pub pending: String,
}

pub fn parse_organize_sections(text: &str) -> Vec<OrganizeDoc> {
    const TITLES: [(&str, i64); 6] = [
        ("01_定位与业务边界", 1),
        ("02_产品与服务事实", 2),
        ("03_客户与使用场景", 3),
        ("04_优势与竞品差异", 4),
        ("05_案例与结果", 5),
        ("06_权威背书与外部证据", 6),
    ];
    let mut docs = Vec::new();
    // 按 NN_ 标题行切段
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        let is_header = ["## ", "### ", "# "].iter().any(|p| trimmed.starts_with(p) && TITLES.iter().any(|(t, _)| trimmed.contains(t)))
            || TITLES.iter().any(|(t, _)| trimmed == *t);
        if is_header {
            sections.push((trimmed.to_string(), vec![]));
        } else if let Some(last) = sections.last_mut() {
            last.1.push(line.to_string());
        }
    }
    for (header, body) in sections {
        let title = TITLES
            .iter()
            .find(|(t, _)| header.contains(t))
            .map(|(t, _)| t.to_string())
            .unwrap_or_else(|| header.trim_start_matches('#').trim().to_string());
        let module = TITLES
            .iter()
            .find(|(t, _)| header.contains(t))
            .map(|(_, m)| *m)
            .unwrap_or(2);
        let content: String = body.join("\n").trim().to_string();
        let content = if content.is_empty() { "【待补充：需业务部门提供】".to_string() } else { content };
        let pending = if content.contains("待补充") { "含待补充标记，请业务确认".to_string() } else { String::new() };
        docs.push(OrganizeDoc { module, title, content, pending });
    }
    docs
}

// ============ 真实监测（四平台 OpenAI 兼容端点，对齐 Node REAL_MONITOR_ENV） ============
pub struct MonitorPlatformCfg {
    pub name: &'static str,
    pub base_env: &'static str,
    pub base_dflt: &'static str,
    pub key_env: &'static str,
    pub model_env: &'static str,
}

pub fn monitor_platform(platform: i64) -> Option<MonitorPlatformCfg> {
    match platform {
        1 => Some(MonitorPlatformCfg { name: "豆包（火山方舟）", base_env: "MONITOR_ARK_BASE", base_dflt: "https://ark.cn-beijing.volces.com/api/v3", key_env: "MONITOR_ARK_KEY", model_env: "MONITOR_ARK_MODEL" }),
        2 => Some(MonitorPlatformCfg { name: "DeepSeek", base_env: "MONITOR_DEEPSEEK_BASE", base_dflt: "https://api.deepseek.com", key_env: "MONITOR_DEEPSEEK_KEY", model_env: "MONITOR_DEEPSEEK_MODEL" }),
        3 => Some(MonitorPlatformCfg { name: "元宝（腾讯混元）", base_env: "MONITOR_HUNYUAN_BASE", base_dflt: "https://api.hunyuan.cloud.tencent.com/v1", key_env: "MONITOR_HUNYUAN_KEY", model_env: "MONITOR_HUNYUAN_MODEL" }),
        4 => Some(MonitorPlatformCfg { name: "通义千问（阿里云百炼）", base_env: "MONITOR_DASHSCOPE_BASE", base_dflt: "https://dashscope.aliyuncs.com/compatible-mode/v1", key_env: "MONITOR_DASHSCOPE_KEY", model_env: "MONITOR_DASHSCOPE_MODEL" }),
        _ => None,
    }
}

/// 平台是否配置了真实监测（Key 在 settings 或环境变量中）
pub fn real_monitor_configured(conn: &Connection, platform: i64) -> bool {
    monitor_platform(platform)
        .map(|c| cfg_get(conn, c.key_env).is_some())
        .unwrap_or(false)
}

/// 平台凭据（调用方在锁内一次读齐，网络调用不持锁）
pub fn monitor_creds(conn: &Connection, platform: i64) -> Option<(String, String, String)> {
    let c = monitor_platform(platform)?;
    let key = cfg_get(conn, c.key_env)?;
    let base = cfg_get(conn, c.base_env).unwrap_or_else(|| c.base_dflt.to_string());
    let model = cfg_get(conn, c.model_env).unwrap_or_else(|| "default".to_string());
    Some((key, base.trim_end_matches('/').to_string(), model))
}

/// 真实监测调用：联网提问 + 引用提取 + 品牌表现启发式评估（对齐 Node runMonitorReal）
/// 必须在 with_db 闭包之外调用（网络调用不持锁）；凭据与已发布链接由调用方传入。
pub fn run_monitor_real_with(
    p: &Project,
    question: &str,
    platform: i64,
    key: &str,
    base: &str,
    model: &str,
    published: &[String],
) -> Result<crate::mock::MonitorMock, String> {
    let c = monitor_platform(platform).ok_or_else(|| format!("平台 {} 暂无真实监测通道", platform))?;

    let mut body = json!({"model": model, "messages": [{"role": "user", "content": question}], "stream": false});
    if platform == 4 && std::env::var("MONITOR_DASHSCOPE_SEARCH").as_deref() != Ok("0") {
        body["enable_search"] = json!(true);
    }
    if platform == 3 && std::env::var("MONITOR_HUNYUAN_SEARCH").as_deref() != Ok("0") {
        body["citation"] = json!(true);
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(45))
        .build();
    let resp = agent
        .post(&format!("{}/chat/completions", base))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", key))
        .send_string(&body.to_string())
        .map_err(|e| format!("真实监测调用失败（{}）：{}", c.name, e))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| format!("真实监测响应读取失败: {}", e))?;
    if status != 200 {
        return Err(format!("真实监测调用失败（{} HTTP {}）：{}", c.name, status, text.chars().take(200).collect::<String>()));
    }
    let payload: Value = serde_json::from_str(&text).map_err(|e| format!("真实监测响应解析失败: {}", e))?;
    let message = &payload["choices"][0]["message"];
    let mut answer_text = message["content"].as_str().unwrap_or("").trim().to_string();
    if answer_text.is_empty() {
        answer_text = "[真实监测] 平台返回了空回答".to_string();
    }

    // 引用来源：多形态提取；我方判定 = URL 与已发布/回填正式链接精确匹配
    let mut citations = extract_citations(message, &payload);
    for c2 in citations.iter_mut() {
        c2["own"] = json!(published.iter().any(|u| u == c2["url"].as_str().unwrap_or("")));
    }
    let exact_url_hit = if citations.iter().any(|x| x["own"].as_bool() == Some(true)) { 1 } else { 0 };

    // 品牌表现：真实语义下的保守启发式（对齐 Node）
    let brand = p.brand_name.clone();
    let brand_mentioned = if !brand.is_empty() && answer_text.contains(&brand) { 1 } else { 0 };
    let mut recommend_level = 0i64;
    if brand_mentioned == 1 {
        if ["首推", "优先推荐", "最推荐", "排名第一", "首选"].iter().any(|w| answer_text.contains(w)) {
            recommend_level = 3;
        } else if ["推荐", "值得", "不错", "可以考虑"].iter().any(|w| answer_text.contains(w)) {
            recommend_level = 2;
        } else {
            recommend_level = 1;
        }
    }
    let mut hit_status = 1i64;
    if brand_mentioned == 1 {
        hit_status = if exact_url_hit == 1 { if recommend_level >= 2 { 3 } else { 2 } } else { 2 };
    }
    if answer_text.is_empty() || answer_text == "[真实监测] 平台返回了空回答" {
        hit_status = 0;
    }

    let mention_position = if brand_mentioned == 1 {
        if recommend_level >= 2 { "推荐内容中（启发式判定）" } else { "被提及" }.to_string()
    } else {
        "未出现".to_string()
    };
    let next_step = if exact_url_hit == 1 {
        "真实链接已被引用，跨批次观察稳定性".to_string()
    } else if brand_mentioned == 1 {
        "通过「手动发布回填」登记真实正式链接，等待下一轮检索命中".to_string()
    } else {
        "回知识库补证并铺设可被检索的答案型内容".to_string()
    };

    Ok(crate::mock::MonitorMock {
        platform,
        answer_text,
        brand_mentioned,
        mention_position,
        brand_accurate: None, // 真实模式不做准确性断言，人工对照知识库
        recommend_level,
        recommend_reason: if brand_mentioned == 1 { "基于真实 AI 回答的启发式判定（真实模式）".to_string() } else { String::new() },
        competitors: json!([]),
        citations: json!(citations),
        keywords: json!({}),
        hit_status,
        exact_url_hit,
        next_step,
        next_optimize: "检查引用来源中的可投放信源，按四状态沉淀".to_string(),
    })
}

/// 引用来源多形态提取（annotations / DashScope search_result / 混元 search_info / 通用兜底）
pub fn extract_citations(message: &Value, payload: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut push = |title: &str, url: &str| {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return;
        }
        if out.iter().any(|x| x["url"].as_str() == Some(url)) {
            return;
        }
        let domain = url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or(url);
        out.push(json!({
            "title": crate::ui::trunc(if title.is_empty() { url } else { title }, 120),
            "url": url,
            "domain": domain,
            "platform": Value::Null,
            "own": false,
            "publisherType": "真实联网检索"
        }));
    };

    // OpenAI annotations
    if let Some(arr) = message["annotations"].as_array() {
        for a in arr {
            push(a["url_citation"]["title"].as_str().or(a["title"].as_str()).unwrap_or(""), a["url_citation"]["url"].as_str().or(a["url"].as_str()).unwrap_or(""));
        }
    }
    // DashScope search_result（顶层或 message 上）
    for src in [payload["search_result"].as_array(), message["search_result"].as_array()].into_iter().flatten() {
        for r in src {
            push(r["title"].as_str().or(r["site_name"].as_str()).unwrap_or(""), r["url"].as_str().or(r["link"].as_str()).unwrap_or(""));
        }
    }
    // 混元 search_info.search_result_list
    if let Some(arr) = message["search_info"]["search_result_list"].as_array() {
        for r in arr {
            push(r["title"].as_str().unwrap_or(""), r["url"].as_str().unwrap_or(""));
        }
    }
    // 通用兜底
    for src in [message["citations"].as_array(), message["web_search_results"].as_array()].into_iter().flatten() {
        for r in src {
            if let Some(s) = r.as_str() {
                push(s, s);
            } else {
                push(r["title"].as_str().unwrap_or(""), r["url"].as_str().or(r["link"].as_str()).unwrap_or(""));
            }
        }
    }
    out
}

// 从回答正文中兜底提取 URL 引用（部分平台把来源直接写进正文）
#[allow(dead_code)]
pub fn extract_urls_from_text(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == 'h'
            && (chars[i..].starts_with(&['h', 't', 't', 'p', ':']) || chars[i..].starts_with(&['h', 't', 't', 'p', 's', ':', '/', '/']))
        {
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() && !"）)]>\"'，。；」".contains(chars[i]) {
                i += 1;
            }
            out.push(chars[start..i].iter().collect::<String>());
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat_response(content: &str) -> Value {
        json!({"choices": [{"message": {"role": "assistant", "content": content}}]})
    }

    #[test]
    fn test_extract_content_and_reasoning_fallback() {
        assert_eq!(extract_content(&chat_response("你好")), "你好");
        let r = json!({"choices": [{"message": {"content": "", "reasoning": "先想第一步分析需求。第二步对比三家品牌参数。最终结论：跃动童年最合适。"}}]});
        let c = extract_content(&r);
        assert!(c.contains("最终结论"), "reasoning 兜底应取末段：{}", c);
    }

    #[test]
    fn test_parse_article_json_and_fallback() {
        let (t, c) = parse_article_json("{\"title\":\"T\",\"content\":\"正文\"}", "q");
        assert_eq!(t, "T");
        assert_eq!(c, "正文");
        // 非 JSON：正文整体采用，标题从问题推导
        let (t2, c2) = parse_article_json("这是纯文本正文", "跃动童年是什么公司？");
        assert_eq!(t2, "跃动童年是什么公司");
        assert_eq!(c2, "这是纯文本正文");
        // ```json 包裹
        let (t3, _) = parse_article_json("```json\n{\"title\":\"标题\",\"content\":\"内容\"}\n```", "q");
        assert_eq!(t3, "标题");
    }

    #[test]
    fn test_parse_question_lines_tolerant() {
        let text = "一、综合选购（5条）\n1. 上海儿童体感运动哪家好？（综合选购）\n2、客厅亲子运动怎么选？（场景选购）\n- 不带序号的口语化问题也该被解析\n# 标题行跳过\n短";
        let qs = parse_question_lines(text);
        assert_eq!(qs.len(), 3);
        assert_eq!(qs[0].0, "上海儿童体感运动哪家好");
        assert_eq!(qs[0].1, "综合选购");
        assert_eq!(qs[1].1, "场景选购");
        assert!(qs[2].1.is_empty());
    }

    #[test]
    fn test_parse_organize_sections() {
        let text = "## 01_定位与业务边界\n专注 3-8 岁儿童。\n## 02_产品与服务事实\n年度会员 2980 元【待补充：需业务部门提供】\n无关行";
        let docs = parse_organize_sections(text);
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].module, 1);
        assert!(docs[0].content.contains("专注 3-8 岁儿童"));
        assert_eq!(docs[1].module, 2);
        assert!(docs[1].pending.contains("待补充"));
    }

    #[test]
    fn test_extract_citations_multi_shape() {
        let message = json!({
            "annotations": [{"url_citation": {"title": "A", "url": "https://a.com/1"}}],
            "search_info": {"search_result_list": [{"title": "B", "url": "https://b.com/2"}]}
        });
        let payload = json!({"search_result": [{"site_name": "C", "url": "https://c.com/3"}]});
        let cites = extract_citations(&message, &payload);
        assert_eq!(cites.len(), 3);
        assert_eq!(cites[0]["url"], "https://a.com/1");
        // Node 语义：payload.search_result 优先于混元 search_info
        assert_eq!(cites[1]["domain"], "c.com");
        assert_eq!(cites[2]["domain"], "b.com");
        // 去重 + 非法 URL 拒绝
        let cites2 = extract_citations(&json!({"citations": ["https://a.com/1", "not-a-url"]}), &json!({}));
        assert_eq!(cites2.len(), 1);
    }

    #[test]
    fn test_extract_urls_from_text() {
        let urls = extract_urls_from_text("参考 https://mock.ownsite.cn/article/1 和 https://a.com/x）以及纯文本");
        assert_eq!(urls, vec!["https://mock.ownsite.cn/article/1", "https://a.com/x"]);
    }
}

#[cfg(test)]
mod real_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// 本地 mock OpenAI /chat/completions 服务器（返回 content + DashScope 风格 search_result）
    fn spawn_openai_mock(content: &str, search_result: Value) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let content = content.to_string();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            let mut body_left: i64 = -1;
            loop {
                let n = sock.read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if body_left < 0 {
                    if let Some(pos) = text.find("\r\n\r\n") {
                        body_left = text
                            .lines()
                            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|v| v.trim().parse::<i64>().ok())
                            .unwrap_or(0);
                        body_left -= (buf.len() - pos - 4) as i64;
                        if body_left <= 0 {
                            break;
                        }
                    }
                } else {
                    body_left -= n as i64;
                    if body_left <= 0 {
                        break;
                    }
                }
            }
            let req = String::from_utf8_lossy(&buf).to_string();
            let body = serde_json::json!({
                "choices": [{"message": {"role": "assistant", "content": content}}],
                "search_result": search_result
            })
            .to_string();
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            sock.write_all(resp.as_bytes()).unwrap();
            req
        });
        (format!("http://127.0.0.1:{}", port), handle)
    }

    fn test_project() -> Project {
        Project {
            id: "proj-1".into(),
            company_id: "co-1".into(),
            name: "跃动童年-GEO优化".into(),
            brand_name: "跃动童年".into(),
            product_name: "跃动童年体感运动课".into(),
            region: "上海".into(),
            business: "3-8岁儿童客厅体感运动".into(),
            selling_points: "无需穿戴设备".into(),
            keywords: "儿童运动".into(),
        }
    }

    #[test]
    fn test_chat_against_mock_openai() {
        let (base, handle) = spawn_openai_mock("你好，我是测试模型。", json!([]));
        let cfg = LlmConfig { base_url: base.clone(), api_key: "sk-test".into(), model: "test-model".into() };
        let out = chat(&cfg, "连通性测试", None, 10).unwrap();
        assert_eq!(out, "你好，我是测试模型。");
        let req = handle.join().unwrap();
        assert!(req.contains("POST /chat/completions"));
        assert!(req.contains("Bearer sk-test"));
        assert!(req.contains("test-model"));
    }

    #[test]
    fn test_chat_unreachable_is_err() {
        let cfg = LlmConfig { base_url: "http://127.0.0.1:1".into(), api_key: "k".into(), model: "m".into() };
        assert!(chat(&cfg, "x", None, 3).is_err());
    }

    #[test]
    fn test_run_monitor_real_with_citations_and_own_match() {
        let (base, handle) = spawn_openai_mock(
            "跃动童年是专注 3-8 岁儿童的品牌，值得推荐。详情见 https://mock.ownsite.cn/article/abc",
            json!([{"title": "第三方报道", "url": "https://news.example.com/x"}]),
        );
        let p = test_project();
        let published = vec!["https://mock.ownsite.cn/article/abc".to_string()];
        let r = run_monitor_real_with(&p, "跃动童年是什么公司？", 4, "sk-dash", &base, "qwen-plus", &published).unwrap();
        // 品牌表现（真实启发式）
        assert_eq!(r.brand_mentioned, 1);
        assert_eq!(r.recommend_level, 2); // "值得推荐" 命中
        assert_eq!(r.brand_accurate, None);
        // 引用：正文 URL 提取不到（citation 字段才提取），search_result 命中
        let cites = r.citations.as_array().unwrap();
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0]["url"], "https://news.example.com/x");
        // own 精确匹配我方已发布链接
        assert_eq!(r.exact_url_hit, 0);
        assert_eq!(r.hit_status, 2);
        let req = handle.join().unwrap();
        assert!(req.contains("enable_search")); // DashScope 平台默认开联网
        assert!(req.contains("qwen-plus"));
    }

    #[test]
    fn test_run_monitor_real_own_url_exact_hit() {
        // 平台把引用放进 citations 数组且 URL 命中我方已发布链接 → 精准命中
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            // 长度感知读取（read_to_string 会死等 EOF，客户端在等响应 → 死锁）
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            let mut body_left: i64 = -1;
            loop {
                let n = sock.read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if body_left < 0 {
                    if let Some(pos) = text.find("\r\n\r\n") {
                        body_left = text
                            .lines()
                            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|v| v.trim().parse::<i64>().ok())
                            .unwrap_or(0);
                        body_left -= (buf.len() - pos - 4) as i64;
                        if body_left <= 0 {
                            break;
                        }
                    }
                } else {
                    body_left -= n as i64;
                    if body_left <= 0 {
                        break;
                    }
                }
            }
            let body = serde_json::json!({
                "choices": [{"message": {"content": "跃动童年不错，来源 https://mock.toutiao.com/article/z", "citations": ["https://mock.toutiao.com/article/z"]}}],
                "search_result": []
            })
            .to_string();
            sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).unwrap();
        });
        let p = test_project();
        let published = vec!["https://mock.toutiao.com/article/z".to_string()];
        let r = run_monitor_real_with(&p, "跃动童年怎么样？", 1, "k", &format!("http://127.0.0.1:{}", port), "m", &published).unwrap();
        assert_eq!(r.exact_url_hit, 1);
        // "不错" 命中推荐级别 2 → 品牌提及 + 精确 URL 引用 + 推荐 ≥2 → 精准命中
        assert_eq!(r.hit_status, 3);
    }
}
