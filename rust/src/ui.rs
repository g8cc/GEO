// Web UI 组件助手 + 枚举标签 + 文本工具（与 Node 版 ui.js / enums.js / util.js 对应）

// ============ HTML 转义 ============
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

// UTF-8 安全截断（按字符数）
pub fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let cut: String = s.chars().take(n).collect();
    format!("{}\u{2026}", cut)
}

pub fn trunc_clean(s: &str, n: usize) -> String {
    let t = trunc(s, n);
    t.replace(['<', '>', '&', '"', '\''], "")
}

// 外链白名单：只允许 http(s)，防止 javascript: 注入（对应 Node safeUrl）
pub fn safe_url(u: &str) -> String {
    let t = u.trim();
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with('/') {
        esc(t)
    } else {
        "#".to_string()
    }
}

// 时间格式化：ISO → YYYY-MM-DD HH:MM（本地时区，对应 Node fmtTime）
pub fn fmt_time(iso: &str) -> String {
    if iso.is_empty() {
        return "—".into();
    }
    match chrono::DateTime::parse_from_rfc3339(iso) {
        Ok(d) => d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string(),
        Err(_) => trunc(iso, 16),
    }
}

// ============ 枚举标签（与 Node enums.js 一致；数值→中文） ============
pub fn label(map: &[&str], code: i64) -> String {
    let idx = code;
    if idx >= 0 && (idx as usize) < map.len() {
        map[idx as usize].to_string()
    } else {
        "—".into()
    }
}

pub const ARTICLE_STATUS: &[&str] = &["已生成", "已上传", "已创建发布任务", "已正式发布"];
pub const ARTICLE_TYPE: &[&str] = &["", "AI 答案卡", "品牌优化文章", "产品推荐文章"];
pub const QUESTION_CATEGORY: &[&str] = &["", "品牌认知", "产品推荐", "对比选型", "效果验证", "行动转化", "风险判断"];
pub const QUESTION_STAGE: &[&str] = &["", "探索", "评估", "行动"];
pub const QUESTION_PRIORITY: &[&str] = &["P0 最高", "P1 高", "P2 中", "P3 低"];
pub const QUESTION_STATUS: &[&str] = &["", "待监测", "监测中", "已上榜", "优化中"];
pub const KB_MODULE: &[&str] = &[
    "",
    "01_定位与业务边界",
    "02_产品与服务事实",
    "03_客户与使用场景",
    "04_优势与竞品差异",
    "05_案例与结果",
    "06_权威背书与外部证据",
];
pub const PUBLISH_PLATFORM: &[&str] = &[
    "", "今日头条", "搜狐", "网易", "抖音", "知乎", "小红书", "微信公众号", "什么值得买", "官网", "其他",
];
pub const PUBLISH_DOMAIN: &[&str] = &[
    "", "mock.toutiao.com", "mock.sohu.com", "mock.163.com", "mock.douyin.com", "mock.zhihu.com",
    "mock.xiaohongshu.com", "mock.mp.weixin.qq.com", "mock.smzdm.com", "mock.ownsite.cn",
];
pub const ACCOUNT_TYPE: &[&str] = &["", "官方机构号", "企业号", "个人自媒体", "KOL或大V", "用户账号", "其他"];
pub const ACCOUNT_AUTH_STATUS: &[&str] = &["未授权", "已授权", "已过期"];
pub const PUBLISH_TASK_STATUS: &[&str] = &["", "已创建", "发布中", "已发布", "失败"];
pub const AI_PLATFORM: &[&str] = &["", "豆包", "DeepSeek", "元宝", "通义千问", "其他"];
pub const MONITOR_MODE: &[&str] = &["", "一次性监测", "周期复测"];
pub const MONITOR_TASK_STATUS: &[&str] = &["", "排队", "运行中", "完成", "失败"];
#[allow(dead_code)]
pub const CHECKPOINT_STATUS: &[&str] = &["", "待执行", "已完成", "失败"];
pub const RECOMMEND_LEVEL: &[&str] = &["未出现", "提及", "明确推荐", "优先推荐"];
pub const HIT_STATUS: &[&str] = &["待复测", "未命中", "弱命中", "精准命中"];
pub const SOURCE_ASSET_STATUS: &[&str] = &["", "已引用信源", "潜在信源", "可投放信源", "观察信源"];
pub const SOURCE_CONTROLLABILITY: &[&str] = &["", "可控信源", "潜在信源", "不可控信源"];
pub const SOURCE_PAGE_STATUS: &[&str] = &["", "已上传", "已创建任务", "已正式发布", "已被 AI 引用", "失效"];
pub const EVIDENCE_TYPE: &[&str] = &["", "官方事实", "产品参数", "项目案例", "用户评价", "行业观点", "其他"];
pub const PUBLISHER_TYPE: &[&str] = &[
    "", "国家级媒体", "省级媒体", "地方或公共机构", "商业媒体", "垂直行业媒体", "B2B门户", "电商平台",
    "企业官网", "用户社区", "自媒体账号",
];
pub const AUDIT_GATE: &[&str] = &["不通过", "修改后通过", "通过"];
pub const AUDIT_VERDICT: &[&str] = &["不通过", "修改后通过", "通过"];
pub const REPORT_TYPE: &[&str] = &[
    "", "品牌诊断报告", "产品推荐诊断报告", "优化前后对比报告", "逆向分析报告", "AI 现状一页纸诊断", "口碑监测摘要",
];
pub const MATERIAL_TYPE: &[&str] = &["", "图片", "视频", "答案卡图组"];

// ============ 徽章 ============
pub fn badge_class(text: &str) -> &'static str {
    match text {
        "已正式发布" | "已发布" | "已被AI引用" | "精准命中" | "已上榜" | "通过" | "已授权" | "已引用信源" | "完成" | "已完成" | "优先推荐" => "b-ok",
        "修改后通过" | "弱命中" | "待复测" | "发布中" | "运行中" | "监测中" | "优化中" | "已创建" | "已创建任务" | "待执行" | "排队" => "b-warn",
        "P0 最高" | "不通过" | "未命中" | "失败" | "已过期" | "失效" => "b-bad",
        "已生成" | "待监测" => "b-gray",
        "已上传" => "b-info",
        _ => "b-gray",
    }
}

pub fn badge(text: &str) -> String {
    format!("<span class=\"badge {}\">{}</span>", badge_class(text), esc(if text.is_empty() { "—" } else { text }))
}

pub fn label_badge(map: &[&str], code: i64) -> String {
    badge(&label(map, code))
}

// ============ 组件 ============
pub fn page_head(title: &str, sub: &str, right: &str) -> String {
    format!(
        "<div class=\"page-head\"><div><h1>{}</h1>{}</div><div>{}</div></div>",
        esc(title),
        if sub.is_empty() { String::new() } else { format!("<div class=\"sub\">{}</div>", sub) },
        right
    )
}

pub fn card(title: &str, body: &str) -> String {
    format!(
        "<div class=\"card\">{}{}</div>",
        if title.is_empty() { String::new() } else { format!("<h2>{}</h2>", esc(title)) },
        body
    )
}

pub fn table_raw(headers: &[&str], rows_html: &str, empty_html: &str) -> String {
    if rows_html.trim().is_empty() {
        return if empty_html.is_empty() { "<div class=\"empty\">暂无数据</div>".into() } else { empty_html.to_string() };
    }
    let th: Vec<String> = headers.iter().map(|h| format!("<th>{}</th>", esc(h))).collect();
    format!("<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>", th.join(""), rows_html)
}

pub fn empty(text: &str) -> String {
    format!("<div class=\"empty\">{}</div>", esc(text))
}

pub fn empty_cta(text: &str, href: &str, cta: &str) -> String {
    format!(
        "<div class=\"empty\">{}<div style=\"margin-top:10px\"><a class=\"btn\" href=\"{}\">{}</a></div></div>",
        esc(text),
        esc(href),
        esc(cta)
    )
}

// 下拉选择框：options 为 (value, text)
pub fn sel(name: &str, options: &[(String, String)], value: &str, allow_empty: &str, required: bool) -> String {
    let mut out = format!(
        "<select name=\"{}\"{}>",
        esc(name),
        if required { " required" } else { "" }
    );
    if !allow_empty.is_empty() {
        out.push_str(&format!("<option value=\"\">{}</option>", esc(allow_empty)));
    }
    for (v, t) in options {
        let selected = if v == value { " selected" } else { "" };
        out.push_str(&format!("<option value=\"{}\"{}>{}</option>", esc(v), selected, esc(t)));
    }
    out.push_str("</select>");
    out
}

pub fn enum_options(map: &[&str]) -> Vec<(String, String)> {
    map.iter()
        .enumerate()
        .filter(|(i, _)| *i > 0 || !map.is_empty() && *i == 0 && !map[0].is_empty())
        .map(|(i, t)| (i.to_string(), t.to_string()))
        .collect()
}

// ============ 文本工具（与 Node util.js 对应） ============
pub fn str_hash(text: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for c in text.chars() {
        h ^= c as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

pub struct Rng(u32);
impl Rng {
    pub fn from(parts: &[&str]) -> Self {
        Rng(str_hash(&parts.join("|")))
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = t.wrapping_add(0x6d2b79f5);
        let mut x = t;
        x ^= x >> 15;
        x = x.wrapping_mul(0x2545f491);
        x ^= x >> 13;
        x = x.wrapping_mul(0x2545f491);
        x ^= x >> 16;
        (x as f64) / 4294967296.0
    }
}

// 简易中文分词：CJK 双字组 + ASCII 词
pub fn tokenize(text: &str) -> std::collections::HashSet<String> {
    let mut tokens = std::collections::HashSet::new();
    let cleaned: String = text.chars().map(|c| c.to_ascii_lowercase()).collect();
    // ASCII 词
    let mut cur = String::new();
    for c in cleaned.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '+' | '#' | '.' | '-') {
            cur.push(c);
        } else if !cur.is_empty() {
            if cur.chars().count() >= 2 {
                tokens.insert(cur.clone());
            }
            cur.clear();
        }
    }
    if cur.chars().count() >= 2 {
        tokens.insert(cur);
    }
    // CJK 双字组
    let cjk_only: String = cleaned.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).collect();
    let chars: Vec<char> = cjk_only.chars().collect();
    if chars.len() == 1 {
        tokens.insert(chars[0].to_string());
    } else {
        for w in chars.windows(2) {
            tokens.insert(w.iter().collect::<String>());
        }
    }
    tokens
}

pub fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count();
    inter as f64 / a.len().min(b.len()) as f64
}

// 从文本提取「N元」价格口径（对应 /(\d{2,6})\s*元/g）
pub fn extract_prices(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            // 允许数字与「元」之间有空格（对应 \s*）
            let mut j = i;
            while j < chars.len() && chars[j] == ' ' {
                j += 1;
            }
            if j < chars.len() && chars[j] == '元' {
                let digits: String = chars[start..i].iter().collect();
                if digits.len() >= 2 && digits.len() <= 6 {
                    out.push(digits);
                }
                i = j + 1;
            }
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_esc() {
        assert_eq!(esc("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;");
    }

    #[test]
    fn test_trunc_utf8_safe() {
        let s = "中文内容测试字符串";
        assert_eq!(trunc(s, 4), "中文内容\u{2026}");
        assert_eq!(trunc(s, 100), s);
    }

    #[test]
    fn test_label() {
        assert_eq!(label(ARTICLE_STATUS, 3), "已正式发布");
        assert_eq!(label(ARTICLE_TYPE, 2), "品牌优化文章");
        assert_eq!(label(ARTICLE_STATUS, 99), "—");
    }

    #[test]
    fn test_tokenize_jaccard() {
        let a = tokenize("儿童体感运动哪家好");
        assert!(a.contains("儿童"));
        assert!(a.contains("体感"));
        let b = tokenize("儿童体感运动怎么选");
        assert!(jaccard(&a, &b) > 0.3);
    }

    #[test]
    fn test_extract_prices() {
        let p = extract_prices("年度会员 2980 元，月度 398元，共 60 天");
        assert_eq!(p, vec!["2980", "398"]);
    }

    #[test]
    fn test_badge_class() {
        assert_eq!(badge_class("已正式发布"), "b-ok");
        assert_eq!(badge_class("未命中"), "b-bad");
        assert_eq!(badge_class("未知状态"), "b-gray");
    }
}
