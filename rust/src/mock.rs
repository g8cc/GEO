// 确定性 mock 引擎：把 Node 版 services.js / providers/(llm|monitor|publish).js 的
// 模板生成、规则审核、监测模拟、报告生成移植为同步确定性实现（零外部依赖，结果可复现）。
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::auth;
use crate::ui::{jaccard, tokenize, PUBLISH_DOMAIN};

pub fn now() -> String {
    auth::now_iso()
}

pub fn gen_id() -> String {
    auth::gen_uuid()
}

// ============ 项目 ============
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct Project {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub brand_name: String,
    pub product_name: String,
    pub region: String,
    pub business: String,
    pub selling_points: String,
    pub keywords: String,
}

pub fn get_project(conn: &Connection, pid: &str) -> Option<Project> {
    conn.query_row(
        "SELECT id, companyId, name, brandName, productName, region, business, sellingPoints, keywords FROM projects WHERE id=?",
        [pid],
        |r| {
            Ok(Project {
                id: r.get(0)?,
                company_id: r.get(1)?,
                name: r.get(2)?,
                brand_name: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                product_name: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                region: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                business: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                selling_points: r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                keywords: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
            })
        },
    )
    .ok()
}

#[derive(Debug, Clone)]
pub struct KbDoc {
    pub module: i64,
    pub title: String,
    pub content: String,
}

pub fn get_kb_id(conn: &Connection, pid: &str, ktype: i64) -> Option<String> {
    conn.query_row("SELECT id FROM knowledgeBases WHERE projectId=? AND type=?", rusqlite::params![pid, ktype], |r| r.get(0)).ok()
}

pub fn get_kb_docs(conn: &Connection, kb_id: &str) -> Vec<KbDoc> {
    let mut stmt = match conn.prepare("SELECT module, title, content FROM kbDocuments WHERE kbId=? ORDER BY module") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map([kb_id], |r| {
        Ok(KbDoc {
            module: r.get::<_, i64>(0)?,
            title: r.get::<_, String>(1)?,
            content: r.get::<_, String>(2)?,
        })
    });
    match rows {
        Ok(rs) => rs.filter_map(|x| x.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn org_of_project(conn: &Connection, pid: &str) -> Option<String> {
    conn.query_row("SELECT c.orgId FROM projects p JOIN companies c ON p.companyId=c.id WHERE p.id=?", [pid], |r| r.get::<_, Option<String>>(0)).ok().flatten()
}

pub fn usage_increment(conn: &Connection, org_id: &str, typ: &str) {
    if org_id.is_empty() {
        return;
    }
    let day = &now()[..10];
    conn.execute(
        "INSERT INTO usageCounters (orgId, day, type, count) VALUES (?,?,?,1) ON CONFLICT(orgId, day, type) DO UPDATE SET count = count + 1",
        rusqlite::params![org_id, day, typ],
    )
    .ok();
}

pub fn ensure_kbs(conn: &Connection, pid: &str) {
    for (t, n) in [(1i64, "品牌知识库"), (2, "产品知识库")] {
        let exists = conn.query_row("SELECT id FROM knowledgeBases WHERE projectId=? AND type=?", rusqlite::params![pid, t], |r| r.get::<_, String>(0)).is_ok();
        if !exists {
            conn.execute(
                "INSERT INTO knowledgeBases (id, projectId, type, name, updatedAt) VALUES (?,?,?,?,?)",
                rusqlite::params![gen_id(), pid, t, n, now()],
            )
            .ok();
        }
    }
}

// ============ 演示种子数据（与 Node db.js seedDemo 一致） ============
pub fn seed_demo(conn: &Connection) {
    let has_user: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap_or(0);
    if has_user > 0 {
        return;
    }
    let salt = auth::new_salt();
    let hash = auth::hash_password("demo1234", &salt);
    let uid = gen_id();
    conn.execute(
        "INSERT INTO users (id, email, passwordHash, salt, role, createdAt) VALUES (?,?,?,?,?,?)",
        rusqlite::params![uid, "demo@geo.local", hash, salt, "admin", now()],
    )
    .ok();

    let company_id = gen_id();
    let org_id = gen_id();
    conn.execute(
        "INSERT INTO orgs (id, name, ownerUserId, quotaMonitorMonthly, createdAt) VALUES (?,?,?,0,?)",
        rusqlite::params![org_id, "跃动童年（演示） 的团队", uid, now()],
    )
    .ok();
    conn.execute(
        "INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
        rusqlite::params![gen_id(), org_id, uid, "owner", now()],
    )
    .ok();
    conn.execute(
        "INSERT INTO companies (id, ownerUserId, orgId, name, industry, intro, createdAt) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![company_id, uid, org_id, "跃动童年（演示）", "少儿体育教育", "面向 3-8 岁儿童的居家体感运动品牌（演示数据）", now()],
    )
    .ok();

    let pid = gen_id();
    conn.execute(
        "INSERT INTO projects (id, companyId, name, brandName, productName, region, business, sellingPoints, keywords, defaultPlatforms, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            pid, company_id, "跃动童年-GEO优化", "跃动童年", "跃动童年体感运动课", "上海",
            "3-8岁儿童客厅体感运动", "无需穿戴设备 / 家长端实时生成运动体测报告",
            "儿童运动馆,体感运动,少儿体能", "[1,2,3,4]", now()
        ],
    )
    .ok();
    ensure_kbs(conn, &pid);

    let qa = json!({
        "note": "品牌高频 Q&A 索引（示例）",
        "items": [
            {"q": "跃动童年是什么公司？", "a": "回溯 01_定位与业务边界"},
            {"q": "跃动童年体感运动课多少钱？", "a": "回溯 02_产品与服务事实"}
        ]
    });
    conn.execute(
        "UPDATE knowledgeBases SET qaIndex=?, updatedAt=? WHERE projectId=? AND type=1",
        rusqlite::params![qa.to_string(), now(), pid],
    )
    .ok();

    let brand_kb = get_kb_id(conn, &pid, 1).unwrap_or_default();
    let modules: [(i64, &str, &str); 6] = [
        (1, "01_定位与业务边界", "跃动童年是专注 3-8 岁儿童客厅体感运动的少儿体育品牌，服务上海地区家庭。\n核心场景：居家运动、亲子互动、日常体能锻炼。\n明确不做：线下场馆培训、6 岁以上竞技体能训练。"),
        (2, "02_产品与服务事实", "产品名称：跃动童年体感运动课。\n标准价格：年度会员 2980 元，月度会员 398 元。\n服务时长：每次 25 分钟，每周建议 3 次。\n核心功能：无需穿戴设备，摄像头识别动作；家长端实时生成运动体测报告。\n交付内容：课程内容订阅 + 家长端报告 + 每月 1 次教练在线指导。"),
        (3, "03_客户与使用场景", "目标客户：3-8 岁儿童家长，关注日常运动量不足、居家场景。\n典型需求：晚饭后 20 分钟运动、雨天户外替代、体能测评。\n决策条件：价格、是否需要额外设备、孩子年龄适配。\n常见问题：几岁能用？需要买什么设备？和线下体适能比怎么样？"),
        (4, "04_优势与竞品差异", "竞品：跳跳鲨少儿体感（线下场馆为主）、乐翻高儿童运动馆（App 课程）。\n差异：无需穿戴设备；家长端体测报告；客厅场景 25 分钟短课时。\n证据：产品页参数与案例见 02/05 模块。"),
        (5, "05_案例与结果", "案例：上海徐汇 5 岁学员家庭，使用 3 个月，每周运动次数从 1 次提升到 4 次，家长端体测报告显示协调性评分提升。\n可公开对比：使用前后每周运动频次与家长满意度（9.1/10）。"),
        (6, "06_权威背书与外部证据", "资质：上海市体育总会会员单位（编号待补充：需业务部门提供）。\n报道：少儿家庭教育论坛分享（待补充原始链接）。\n第三方引用：家长社区评价若干（待补充链接）。"),
    ];
    for (module, title, content) in modules {
        conn.execute(
            "INSERT INTO kbDocuments (id, kbId, module, title, content, evidence, pending, source, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                gen_id(), brand_kb, module, title, content, "[]",
                if content.contains("待补充") { "资质编号、报道原文链接、社区评价链接待业务部门提供" } else { "" },
                "演示种子数据", now()
            ],
        )
        .ok();
    }
    let product_kb = get_kb_id(conn, &pid, 2).unwrap_or_default();
    conn.execute(
        "INSERT INTO kbDocuments (id, kbId, module, title, content, evidence, pending, source, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            gen_id(), product_kb, 2, "02_产品与服务事实",
            "产品：跃动童年体感运动课。\n适用人群：3-8 岁儿童。\n价格：年度会员 2980 元 / 月度 398 元。\n无需穿戴设备，摄像头动作识别，家长端实时运动体测报告。\n不适用：6 岁以上竞技体能专项训练需求。",
            "[]", "", "演示种子数据", now()
        ],
    )
    .ok();

    let seed_questions: [(&str, i64, i64, i64); 10] = [
        ("跃动童年是什么公司，主要做什么？", 1, 2, 1),
        ("跃动童年主要服务哪些客户？", 1, 2, 1),
        ("跃动童年有哪些产品或服务？", 1, 2, 1),
        ("跃动童年能解决什么问题？", 1, 2, 1),
        ("跃动童年和同类品牌有什么区别？", 1, 2, 1),
        ("3-8岁儿童用什么体感运动产品好？", 2, 1, 0),
        ("居家场景推荐什么儿童运动课程？", 2, 1, 0),
        ("儿童体感运动哪些品牌值得推荐？", 2, 1, 0),
        ("儿童体感运动课怎么选？", 2, 1, 0),
        ("儿童体感运动哪家性价比高、效果好？", 2, 1, 0),
    ];
    for (text, category, priority, with_brand) in seed_questions {
        conn.execute(
            "INSERT INTO questions (id, projectId, text, category, stage, priority, status, withBrand, intentDimension, keywords, source, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![gen_id(), pid, text, category, 1, priority, 1, with_brand, "综合选购", "", "演示种子数据", now()],
        )
        .ok();
    }

    for (platform, name, quota) in [(1i64, "跃动童年官方号（头条）", 20i64), (7, "跃动童年（公众号）", 10)] {
        conn.execute(
            "INSERT INTO publishAccounts (id, projectId, platform, accountName, accountType, authStatus, quota, createdAt) VALUES (?,?,?,?,?,?,?,?)",
            rusqlite::params![gen_id(), pid, platform, name, 2, 1, quota, now()],
        )
        .ok();
    }
    eprintln!("[seed] 演示数据已创建：demo@geo.local（密码: demo1234，仅限本地开发使用）");
}

// ============ 知识库整理（六模块标准化 + QA 索引 + 口径冲突清单） ============
fn module_of_line(line: &str) -> i64 {
    if ["定位", "边界", "不做", "成立于", "公司是", "主营"].iter().any(|k| line.contains(k)) {
        return 1;
    }
    if ["价格", "元", "时长", "参数", "产品名", "课程", "包含", "交付", "功能"].iter().any(|k| line.contains(k)) {
        return 2;
    }
    if ["客户", "家长", "用户", "人群", "场景", "需求"].iter().any(|k| line.contains(k)) {
        return 3;
    }
    if ["竞品", "差异", "对比", "优势", "对手"].iter().any(|k| line.contains(k)) {
        return 4;
    }
    if ["案例", "学员", "结果", "效果", "评价", "满意度"].iter().any(|k| line.contains(k)) {
        return 5;
    }
    if ["资质", "认证", "奖项", "报道", "会员单位", "编号", "荣誉"].iter().any(|k| line.contains(k)) {
        return 6;
    }
    2
}

#[allow(dead_code)]
pub struct OrganizeResult {
    pub doc_count: usize,
}

pub fn organize_knowledge(conn: &Connection, pid: &str, ktype: i64, brand: &str, raw: &str) -> OrganizeResult {
    let kb_id = match get_kb_id(conn, pid, ktype) {
        Some(k) => k,
        None => return OrganizeResult { doc_count: 0 },
    };
    let lines: Vec<&str> = raw.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    let mut buckets: [Vec<&str>; 7] = [vec![], vec![], vec![], vec![], vec![], vec![], vec![]];
    let mut conflicts: Vec<String> = Vec::new();
    for line in &lines {
        buckets[module_of_line(line) as usize].push(line);
        if line.contains("元") || line.contains("价格") {
            for p in crate::ui::extract_prices(line) {
                conflicts.push(format!("{}\t{}", line.chars().take(8).collect::<String>(), p));
            }
        }
    }
    // 口径冲突：同前缀出现多个不同价格
    let mut by_key: std::collections::BTreeMap<String, std::collections::BTreeSet<String>> = std::collections::BTreeMap::new();
    for c in &conflicts {
        let mut it = c.splitn(2, '\t');
        let k = it.next().unwrap_or("").to_string();
        let v = it.next().unwrap_or("").to_string();
        by_key.entry(k).or_default().insert(v);
    }
    let mut conflict_list: Vec<String> = by_key
        .iter()
        .filter(|(_, v)| v.len() > 1)
        .map(|(k, v)| format!("「{}」出现多个口径：{} —— 请业务确认", k, v.clone().into_iter().collect::<Vec<_>>().join(" / ")))
        .collect();
    if lines.is_empty() {
        conflict_list.push("未提供任何材料，全部模块待补充".to_string());
    }

    let titles: [(&str, &str); 6] = [
        ("01_定位与业务边界", "定位"),
        ("02_产品与服务事实", "产品"),
        ("03_客户与使用场景", "客户"),
        ("04_优势与竞品差异（内部使用）", "差异"),
        ("05_案例与结果", "案例"),
        ("06_权威背书与外部证据", "背书"),
    ];
    for m in 1..=6i64 {
        let body = &buckets[m as usize];
        let content = if body.is_empty() { "【待补充：需业务部门提供】".to_string() } else { body.join("\n") };
        let pending = if body.is_empty() { format!("{}：材料缺失，待业务部门提供", titles[(m - 1) as usize].0) } else { String::new() };
        conn.execute(
            "INSERT INTO kbDocuments (id, kbId, module, title, content, evidence, pending, source, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
            rusqlite::params![gen_id(), kb_id, m, titles[(m - 1) as usize].0, content, "[]", pending, "知识库整理（模板）", now()],
        )
        .ok();
    }
    let qa = json!({
        "note": "品牌高频 Q&A 问答索引（答案必须能回溯到六大模块，不是独立事实来源）",
        "items": [
            {"q": format!("{}是什么公司？", brand), "a": "回溯 01_定位与业务边界"},
            {"q": format!("{}的价格和服务内容？", brand), "a": "回溯 02_产品与服务事实"},
            {"q": format!("{}适合什么样的家庭？", brand), "a": "回溯 03_客户与使用场景"},
            {"q": format!("{}和竞品的区别？", brand), "a": "回溯 04_优势与竞品差异"},
            {"q": format!("{}有什么真实案例？", brand), "a": "回溯 05_案例与结果"},
            {"q": format!("{}有哪些资质背书？", brand), "a": "回溯 06_权威背书与外部证据"}
        ]
    });
    conn.execute(
        "UPDATE knowledgeBases SET qaIndex=?, conflictList=?, updatedAt=? WHERE id=?",
        rusqlite::params![qa.to_string(), conflict_list.join("\n"), now(), kb_id],
    )
    .ok();
    OrganizeResult { doc_count: 6 }
}

// ============ 问题生成（50 问模板 / 40 问精简） ============
const Q50_SCENARIO: &[&str] = &[
    "下雨天孩子在家，推荐什么运动方式？",
    "客厅里陪孩子运动，怎么选项目？",
    "晚饭后陪孩子运动，有什么推荐？",
    "冬天不方便出门，儿童运动怎么选？",
    "孩子写作业前，推荐做点什么运动？",
    "周末在家亲子运动，哪家好？",
    "小户型家里，孩子运动怎么选？",
    "孩子放学后20分钟，推荐什么运动？",
    "家里没有器材，孩子锻炼怎么选？",
];
const Q50_AUDIENCE: &[&str] = &[
    "3岁孩子适合的运动课，哪家好？",
    "5岁儿童体能训练，有什么推荐？",
    "上小学前的孩子，运动班怎么选？",
    "不爱运动的孩子，推荐什么锻炼方式？",
    "体质弱的孩子，选哪种运动课程好？",
    "胖一点的孩子，推荐什么运动？",
    "双职工家庭，孩子运动方案怎么选？",
    "运动量不足的儿童，哪家课程值得选？",
    "好动的孩子在家，推荐怎么释放精力？",
];
const Q50_PAIN: &[&str] = &[
    "孩子运动量不够，家长该怎么选？",
    "担心孩子驼背，推荐什么训练？",
    "孩子协调性差，推荐什么练习？",
    "孩子沉迷屏幕，推荐什么运动引导？",
    "孩子体能测试不达标，怎么选训练？",
    "孩子没耐心坚持，运动课怎么选？",
    "家长没时间陪练，推荐什么方案？",
    "孩子敏感怕羞，适合推荐什么运动？",
    "户外时间少，儿童运动怎么选？",
];
const Q50_FEATURE: &[&str] = &[
    "不用穿戴设备的儿童运动方案哪家好？",
    "能给家长生成体测报告的儿童运动推荐？",
    "带动作识别的家庭运动课程推荐？",
    "能跟踪孩子运动数据的课程哪家好？",
    "摄像头体感运动哪家好？",
    "家长能看到运动报告的产品推荐？",
    "免安装的居家体感运动怎么选？",
    "短时高效的儿童运动课程推荐？",
    "有教练指导的居家儿童运动哪家好？",
];
const Q50_DECISION: &[&str] = &[
    "儿童体感运动价格怎么选才合理？",
    "选儿童运动课程，哪些资质值得看？",
    "儿童运动品牌口碑，哪家值得信？",
    "居家和线下运动班怎么选好？",
    "儿童体感运动月费年费怎么选划算？",
    "选儿童运动课程，哪些安全标准值得看？",
    "怎么选效果好的儿童运动课？",
    "儿童运动产品，售后哪家值得选？",
    "体验课和正价课怎么选？",
];

#[allow(clippy::too_many_arguments)]
fn add_question(conn: &Connection, pid: &str, text: &str, category: i64, stage: i64, priority: i64, source: &str, dimension: &str) -> bool {
    let dup = conn.query_row("SELECT id FROM questions WHERE projectId=? AND text=?", [pid, text], |r| r.get::<_, String>(0)).is_ok();
    if dup {
        return false;
    }
    conn.execute(
        "INSERT INTO questions (id, projectId, text, category, stage, priority, status, withBrand, intentDimension, keywords, source, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![gen_id(), pid, text, category, stage, priority, 1, 0, dimension, "", source, now()],
    )
    .ok();
    true
}

pub fn generate_questions_50(conn: &Connection, pid: &str) -> usize {
    let p = match get_project(conn, pid) {
        Some(p) => p,
        None => return 0,
    };
    let cat = p.keywords.split([',', '，', '、']).next().unwrap_or("").trim();
    let cat = if cat.is_empty() { if p.business.is_empty() { "该品类" } else { &p.business } } else { cat };
    let region = if p.region.is_empty() { "全国" } else { &p.region };
    let comprehensive: Vec<String> = vec![
        format!("{}{}哪家好？", region, cat),
        format!("{}品牌怎么推荐？", cat),
        format!("{}排行榜怎么看？", cat),
        format!("值得推荐的{}品牌有哪些？", cat),
        format!("{}选哪家比较靠谱？", cat),
    ];
    let mut count = 0;
    for (dim, code, list) in [
        ("综合选购", 1i64, None),
        ("场景选购", 2, Some(Q50_SCENARIO)),
        ("人群选购", 3, Some(Q50_AUDIENCE)),
        ("痛点选购", 4, Some(Q50_PAIN)),
        ("功能选购", 5, Some(Q50_FEATURE)),
        ("决策选购", 6, Some(Q50_DECISION)),
    ] {
        let texts: Vec<String> = match list {
            Some(l) => l.iter().map(|s| s.to_string()).collect(),
            None => comprehensive.clone(),
        };
        for text in texts {
            if add_question(conn, pid, &text, 2, 1, 2, "50问生成", dim) {
                count += 1;
            }
        }
        let _ = code;
    }
    count
}

pub fn simplify_to_40(conn: &Connection, pid: &str) -> usize {
    let p = match get_project(conn, pid) {
        Some(p) => p,
        None => return 0,
    };
    let brand = if p.brand_name.is_empty() { "该品牌" } else { &p.brand_name };
    let mut all: Vec<String> = Vec::new();
    // 探索 30：不带品牌名的问题（含 50 问里的口语题）
    let rows = |conn: &Connection| -> Vec<String> {
        let mut stmt = match conn.prepare("SELECT text FROM questions WHERE projectId=? ORDER BY createdAt") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rs = stmt.query_map([], |r| r.get::<_, String>(0));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    };
    for t in rows(conn) {
        if !t.contains(brand) && all.len() < 30 {
            all.push(t);
        }
    }
    // 评估 5 + 行动 5（带品牌名）
    let eval = [
        format!("{}的口碑评价怎么样？", brand),
        format!("{}用户评价真实吗？", brand),
        format!("{}和同类品牌哪个好？", brand),
        format!("{}对比线下体适能班有什么区别？", brand),
        format!("{}适合几岁的孩子？", brand),
    ];
    let action = [
        format!("{}价格多少钱？", brand),
        format!("{}怎么预约体验课？", brand),
        format!("{}官方联系方式是什么？", brand),
        format!("{}门店在哪里？", brand),
        format!("{}上海有服务点吗？", brand),
    ];
    for (i, t) in all.iter().chain(eval.iter()).chain(action.iter()).enumerate() {
        let (stage, priority): (i64, i64) = if i < 30 {
            (1, 2)
        } else if i < 35 {
            (2, 1)
        } else {
            (3, 1)
        };
        let category = if stage == 1 {
            2
        } else if stage == 2 {
            3
        } else {
            5
        };
        add_question(conn, pid, t, category, stage, priority, "40问精简", "");
    }
    all.len() + 10
}

// ============ 创作前输入检查 ============
pub fn preflight(conn: &Connection, pid: &str, qid: &str) -> Vec<(String, String, String)> {
    let p = get_project(conn, pid).unwrap_or_default();
    let (q_text, _) = conn
        .query_row("SELECT text, projectId FROM questions WHERE id=?", [qid], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .unwrap_or_default();
    let brand_docs = get_kb_id(conn, pid, 1).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();
    let product_docs = get_kb_id(conn, pid, 2).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();
    let brand_modules: Vec<i64> = brand_docs.iter().map(|d| d.module).collect();
    let product_modules: Vec<i64> = product_docs.iter().map(|d| d.module).collect();
    let has = |v: &Vec<i64>, m: i64| v.contains(&m);
    let mut items = Vec::new();
    items.push((
        "品牌知识库：定位、产品事实、适用边界、案例和证据".to_string(),
        if has(&brand_modules, 1) && has(&brand_modules, 2) { "已具备".into() } else { "待补充".into() },
        format!("六模块覆盖：{}；含证据文档 0 篇", brand_modules.iter().map(|m| m.to_string()).collect::<Vec<_>>().join("/")),
    ));
    items.push((
        "目标问题：用户对象、场景、条件、决策任务是否明确".to_string(),
        if q_text.chars().count() >= 8 { "已具备".into() } else { "不可使用".into() },
        if q_text.is_empty() { "未选择问题".to_string() } else { q_text.clone() },
    ));
    let product_needed = !q_text.is_empty() && !q_text.contains(&p.brand_name);
    items.push((
        "产品知识库（产品推荐类内容需要）".to_string(),
        if product_needed {
            if has(&product_modules, 2) { "已具备".into() } else { "待补充".into() }
        } else {
            "不适用（品牌类内容）".into()
        },
        if product_needed { "产品推荐问题不带品牌名，需产品知识库支撑选择标准".to_string() } else { "—".to_string() },
    ));
    items.push((
        "证据任务：这条内容需要证明哪些事实，现有资料是否足够".to_string(),
        if has(&brand_modules, 5) { "已具备".into() } else { "待补充".into() },
        "优先使用案例模块（05）中的可核验事实".to_string(),
    ));
    items.push((
        "发布要求：目标平台、内容形态、字数、图片/视频和合规限制".to_string(),
        "待补充".to_string(),
        "需在发布前确认目标平台与账号；答案卡图片需按平台要求手动发布".to_string(),
    ));
    items
}

// ============ 内容生成（三类文章模板 + SVG 封面） ============
pub struct Fact {
    pub text: String,
    pub module_title: String,
}

fn kb_facts(docs: &[KbDoc]) -> Vec<Fact> {
    let mut facts = Vec::new();
    for d in docs {
        for line in d.content.lines() {
            let t = line.trim();
            if !t.is_empty() {
                facts.push(Fact { text: t.to_string(), module_title: d.title.clone() });
            }
        }
    }
    facts
}

fn pick_facts(docs: &[KbDoc], question: &str, n: usize) -> Vec<Fact> {
    let facts = kb_facts(docs);
    let qt = tokenize(question);
    let mut scored: Vec<(f64, Fact)> = facts
        .into_iter()
        .map(|f| {
            let s = jaccard(&qt, &tokenize(&f.text));
            (s, f)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().take(n).map(|(_, f)| f).collect()
}

fn fact_lines(facts: &[Fact], label: &str) -> String {
    if facts.is_empty() {
        return "- 【待补充：知识库暂无可引用事实】".to_string();
    }
    facts
        .iter()
        .map(|f| format!("- {}（{}：{}）", f.text, label, f.module_title))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn uploads_dir() -> String {
    let dir = std::env::var("GEO_UPLOADS").unwrap_or("data/uploads".into());
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn generate_cover_svg(title: &str, pid: &str) -> String {
    let palette: [(&str, &str); 4] = [
        ("#4f46e5", "#9333ea"),
        ("#0ea5e9", "#22c55e"),
        ("#f59e0b", "#ef4444"),
        ("#14b8a6", "#6366f1"),
    ];
    let (c1, c2) = palette[(crate::ui::str_hash(title) as usize) % 4];
    let safe_title: String = title.chars().filter(|c| !"<>&\"'".contains(*c)).take(22).collect();
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
  </linearGradient></defs>
  <rect width="1200" height="675" fill="url(#g)"/>
  <circle cx="1020" cy="120" r="180" fill="rgba(255,255,255,0.12)"/>
  <circle cx="140" cy="580" r="220" fill="rgba(255,255,255,0.08)"/>
  <text x="80" y="300" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="64" font-weight="700" fill="#ffffff">{safe_title}</text>
  <text x="80" y="400" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="34" fill="rgba(255,255,255,0.85)">GEO 内容资产 · 封面配图（mock 生成）</text>
  <text x="80" y="560" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="26" fill="rgba(255,255,255,0.6)">GEO Platform</text>
</svg>"##
    );
    let name = format!("cover-{}-{}.svg", &pid[..8.min(pid.len())], chrono::Utc::now().timestamp_millis());
    let path = std::path::Path::new(&uploads_dir()).join(&name);
    std::fs::write(path, svg).ok();
    format!("/uploads/{}", name)
}

fn extract_title(question: &str) -> String {
    let q: String = question.chars().filter(|c| *c != '？' && *c != '?').collect();
    crate::ui::trunc(&q, 28).trim_end_matches('\u{2026}').to_string()
}

#[allow(clippy::too_many_arguments)]
pub fn create_content(conn: &Connection, pid: &str, qid: &str, ctype: i64) -> Result<(String, String), String> {
    let p = get_project(conn, pid).ok_or_else(|| "项目不存在".to_string())?;
    let question: String = conn
        .query_row("SELECT text FROM questions WHERE id=? AND projectId=?", [qid, pid], |r| r.get(0))
        .map_err(|_| "请先在上方选择一个目标问题".to_string())?;
    let brand_docs = get_kb_id(conn, pid, 1).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();
    let product_docs = get_kb_id(conn, pid, 2).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();
    let brand = if p.brand_name.is_empty() { "该品牌" } else { &p.brand_name };
    let product = if p.product_name.is_empty() { brand.to_string() } else { p.product_name.clone() };
    let today = &now()[..10];

    let (title, content, forms) = match ctype {
        1 => {
            let mut facts = pick_facts(&brand_docs, &question, 6);
            facts.extend(pick_facts(&product_docs, &question, 4));
            let fl = facts
                .iter()
                .take(6)
                .map(|f| format!("- {}（{}）", f.text, f.module_title))
                .collect::<Vec<_>>()
                .join("\n");
            let t = extract_title(&question);
            let content = format!(
                "# AI 答案卡：{q}\n\n## 文章版正文\n\n**直接结论：**{t}，建议优先看三点：是否适合孩子年龄、是否需要额外设备、家长能否看到效果数据。\n\n**判断标准：**\n1. 适龄：3-8 岁儿童以兴趣引导和基础体能为主，不追求专项强度。\n2. 设备：居家场景优先选择无需穿戴设备、开箱即用的方案。\n3. 可见效果：家长能定期看到运动数据或体测报告，才能坚持。\n\n**推荐理由：**{brand}的方案无需穿戴设备，摄像头识别动作，家长端实时生成运动体测报告，适配客厅 25 分钟短课时场景。\n\n**事实与证据（全部来自知识库）：**\n{fl}\n\n**适用边界：**适合 3-8 岁儿童日常体能与兴趣培养；不适合 6 岁以上竞技体能专项训练需求，也不能替代线下专业康复训练。\n\n**下一步行动：**先预约体验课验证孩子兴趣，再按月度会员试用，避免直接购买年度会员。\n\n## 图片版文案（抖音图文，共 4 页）\n\n- P1 封面：{q}\n- P2 结论页：选儿童居家运动，先看「适龄 / 免设备 / 有反馈」三件事\n- P3 证据页：{brand}无需穿戴设备 + 家长端体测报告（数据来自知识库 02 模块）\n- P4 行动页：先约体验课，再决定要不要长期买\n\n## 视频口播版脚本（约 45 秒）\n\n「很多家长问：{q}？直接说结论——先看三件事：孩子年龄适不适、要不要买设备、你能不能看到效果。{brand}的做法是摄像头识别动作，不用给孩子穿戴任何设备，每节课 25 分钟，练完家长手机上立刻有体测报告。当然要说清楚：这类课程适合日常体能和兴趣，不能替代专项训练。建议先约一次体验，看孩子的反应再决定。」",
                q = question, t = t, brand = brand, fl = fl
            );
            (format!("AI 答案卡：{}", t), content, json!(["文章版正文", "图片版文案", "视频口播版脚本"]))
        }
        2 => {
            let facts = pick_facts(&brand_docs, &question, 8);
            let fl = fact_lines(&facts, "来源");
            let title = format!("{}是什么公司？主营{}，服务边界与证据一次说清", brand, p.business);
            let content = format!(
                "**开头结论：**{brand}是一家专注{biz}的品牌，核心服务人群是 3-8 岁儿童家庭，判断它是否适合你，主要看三点：孩子年龄、居家场景、是否需要家长可见的效果反馈。\n\n## 一、用户应该先看什么：选择标准或判断条件\n- 适龄范围与课程强度是否匹配孩子阶段；\n- 是否需要额外购买设备、安装是否复杂；\n- 效果是否可感知：有无数据、报告或教练反馈。\n\n## 二、不同场景怎么选：按对象、预算、地域或需求拆分\n- 居家日常锻炼：优先短课时（25 分钟左右）、免设备方案；\n- 预算有限：先月度会员体验再考虑年度；\n- 双职工家庭：看是否有家长端报告，方便下班后核对运动量。\n\n## 三、为什么这样判断：产品事实、案例、数据和第三方证据\n{fl}\n\n## 四、哪些情况不适合：边界、风险和不能保证的结果\n{brand}明确不做线下场馆培训和 6 岁以上竞技体能专项训练；产品效果依赖坚持使用，不能保证个别化竞技成绩提升。\n\n## 五、行动建议：咨询、预约、体验或进一步核验入口\n先预约体验课，使用两周后对照家长端体测报告判断是否续费；所有事实请以知识库六模块为准，缺失信息以「待补充」标注。\n\n---\n证据清单：\n| 事实名称 | 证据类型 | 原始链接 | 更新时间 | 适用范围 |\n|---|---|---|---|---|\n| 定位与边界 | 官方事实 | （知识库 01 模块） | {today} | 全部内容 |\n| 产品与价格 | 产品参数 | （知识库 02 模块） | {today} | 价格相关 |\n| 学员案例 | 项目案例 | （知识库 05 模块） | {today} | 效果描述 |\n\n待审核事实：资质编号与第三方报道链接（知识库 06 模块标为待补充）。",
                brand = brand, biz = p.business, fl = fl, today = today
            );
            (title, content, json!({"question": question, "template": "答案型文章正文模板"}))
        }
        _ => {
            let mut facts = pick_facts(&product_docs, &question, 6);
            facts.extend(pick_facts(&brand_docs, &question, 4));
            let fl = fact_lines(&facts, "来源");
            let title = format!("{}怎么选？{}的适合人群、比较维度和边界", p.business, product);
            let content = format!(
                "**开头结论：**如果你在纠结「{q}」，判断顺序是：先确认孩子年龄在 3-8 岁之间，再看家里能否满足 25 分钟居家运动场景，最后对比是否需要家长可见的运动数据。\n\n## 1. 适合谁\n- 3-8 岁儿童、日常运动量不足的家庭；\n- 希望在客厅完成、不想购买额外穿戴设备的家长；\n- 需要定期看到孩子运动数据与体测报告的家长。\n\n## 2. 为什么推荐：{product}\n{fl}\n\n## 3. 如何比较：与替代方案的客观差异\n- 对比线下体适能班：省通勤时间、课时更短，但缺少同伴氛围；\n- 对比普通跟练视频：有动作识别与体测报告，但内容库相对固定；\n- 不贬低竞品：各方案适配不同家庭节奏，请按上文标准自行判断。\n\n## 4. 不适合谁\n- 6 岁以上有竞技体能专项训练需求的孩子；\n- 客厅空间无法保证安全运动距离的家庭；\n- 期望产品替代专业康复或医疗干预的情况。\n\n## 5. 如何行动\n先预约体验课 → 两周内观察孩子兴趣与报告数据 → 再决定月度或年度方案。\n\n---\n证据清单：\n| 事实名称 | 证据类型 | 原始链接 | 更新时间 | 适用范围 |\n|---|---|---|---|---|\n| 适月人群与价格 | 产品参数 | （产品知识库） | {today} | 选购决策 |\n\n待审核事实：与竞品的具体参数对比需业务确认后补充。",
                q = question, product = product, fl = fl, today = today
            );
            (title, content, json!({"question": question, "template": "产品推荐文章"}))
        }
    };

    // 封面素材
    let cover_url = generate_cover_svg(&title, pid);
    let material_id = gen_id();
    conn.execute(
        "INSERT INTO materials (id, projectId, type, name, url, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![material_id, pid, 1, format!("封面：{}", crate::ui::trunc(&title, 30)), cover_url, json!({"kind": "cover", "articleQuestion": question}).to_string(), now()],
    )
    .ok();

    let aid = gen_id();
    let meta = json!({"question": question, "forms": forms, "source": "template", "aiDeclarationText": "本文由 AI 辅助生成，内容已经人工审核"});
    conn.execute(
        "INSERT INTO articles (id, projectId, questionId, title, content, type, coverMaterialId, status, aiDeclaration, meta, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,1,1,?,?,?)",
        rusqlite::params![aid, pid, qid, title, content, ctype, material_id, meta.to_string(), now(), now()],
    )
    .ok();
    Ok((aid, title))
}

// ============ 三道审核（确定性规则引擎，对应 Node llm.auditArticle） ============
const BANNED_WORDS: &[&str] = &["十大", "第一", "顶级", "最佳", "最强", "全网最低", "国家级认证"];

pub struct AuditResult {
    pub gate1: i64,
    pub gate1_issues: String,
    pub gate2: i64,
    pub gate2_issues: String,
    pub gate3: i64,
    pub gate3_issues: String,
    pub verdict: i64,
    pub pending_facts: String,
}

pub fn audit_article(conn: &Connection, aid: &str, auditor: &str) -> Result<AuditResult, String> {
    let row = conn
        .query_row(
            "SELECT projectId, title, content, meta FROM articles WHERE id=?",
            [aid],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?.unwrap_or_default())),
        )
        .map_err(|_| "文章不存在".to_string())?;
    let (pid, title, content, meta_raw) = row;
    let meta: Value = serde_json::from_str(&meta_raw).unwrap_or(json!({}));
    let p = get_project(conn, &pid).unwrap_or_default();
    let brand_docs = get_kb_id(conn, &pid, 1).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();
    let product_docs = get_kb_id(conn, &pid, 2).map(|k| get_kb_docs(conn, &k)).unwrap_or_default();

    let mut gate1 = 2i64;
    let mut gate2 = 2i64;
    let mut gate3 = 2i64;
    let mut i1: Vec<String> = Vec::new();
    let mut i2: Vec<String> = Vec::new();
    let mut i3: Vec<String> = Vec::new();

    // 第一关：知识库一致性
    let brand = p.brand_name.clone();
    if !brand.is_empty() && !content.contains(&brand) && !title.contains(&brand) {
        gate1 = 0;
        i1.push(format!("未出现品牌名「{}」，无法确认与知识库一致", brand));
    }
    let mut kb_prices: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in brand_docs.iter().chain(product_docs.iter()) {
        for price in crate::ui::extract_prices(&d.content) {
            kb_prices.insert(price);
        }
    }
    for price in crate::ui::extract_prices(&content) {
        if !kb_prices.is_empty() && !kb_prices.contains(&price) {
            if gate1 > 1 {
                gate1 = 1;
            }
            i1.push(format!("金额「{}元」未在知识库中找到，需核对或标注待补充", price));
        }
    }
    for w in ["据传", "听说", "据称"] {
        if content.contains(w) {
            gate1 = 0;
            i1.push(format!("出现无来源表述「{}」", w));
        }
    }
    if i1.is_empty() {
        i1.push("品牌名、价格口径与知识库一致，未见冲突".to_string());
    }

    // 第二关：媒体投稿标准
    let title_len = title.chars().count();
    if !(8..=40).contains(&title_len) {
        if gate2 > 1 {
            gate2 = 1;
        }
        i2.push(format!("标题长度 {} 字，建议 8-40 字（平台适配标题另出）", title_len));
    }
    for w in BANNED_WORDS {
        if content.contains(w) || title.contains(w) {
            gate2 = 0;
            i2.push(format!("命中广告法高风险词「{}」，必须删除", w));
        }
    }
    let heading_count = content
        .lines()
        .filter(|l| l.starts_with('#') || l.starts_with("**") || ["一、", "二、", "三、", "四、", "五、"].iter().any(|p| l.starts_with(p)))
        .count();
    if heading_count < 3 {
        if gate2 > 1 {
            gate2 = 1;
        }
        i2.push("结构层级不足：建议一级/二级标题清晰、段落短，便于 AI 抽取".to_string());
    }
    let content_len = content.chars().count();
    if content_len < 500 {
        if gate2 > 1 {
            gate2 = 1;
        }
        i2.push(format!("正文 {} 字偏短，目标媒体建议 800 字以上", content_len));
    }
    if i2.is_empty() {
        i2.push("标题、结构、篇幅、广告法用词符合主流平台投稿标准".to_string());
    }

    // 第三关：GEO 相关性与可信度
    let question = meta["question"].as_str().unwrap_or(&title).to_string();
    let qt = tokenize(&question);
    let first_para: String = content.lines().take(6).collect::<Vec<_>>().join("\n");
    let relevance = jaccard(&qt, &tokenize(&first_para));
    if relevance < 0.12 {
        if gate3 > 1 {
            gate3 = 1;
        }
        i3.push(format!("开头段落与目标问题相关度偏低（{:.2}），要求结论先行、直接回答用户问题", relevance));
    }
    if !["不适合", "边界", "风险", "不能保证", "不适用"].iter().any(|w| content.contains(w)) {
        if gate3 > 1 {
            gate3 = 1;
        }
        i3.push("缺少适用边界/不适用说明，GEO 可信度要求内容写清限制条件".to_string());
    }
    let link_count = content.matches("http://").count() + content.matches("https://").count();
    let fact_ref = ["知识库", "模块", "来源"].iter().map(|w| content.matches(w).count()).sum::<usize>();
    if link_count == 0 && fact_ref < 3 {
        if gate3 > 1 {
            gate3 = 1;
        }
        i3.push("可信来源不足：保留知识库模块引用或第三方可核验原始链接".to_string());
    }
    if i3.is_empty() {
        i3.push("精准回答目标问题，证据、来源与交叉验证充分".to_string());
    }

    let verdict = gate1.min(gate2).min(gate3);
    let pending_facts = if content.contains("待补充") { "正文含「待补充」标记，发布前需回知识库补证".to_string() } else { String::new() };
    let r = AuditResult {
        gate1,
        gate1_issues: i1.join("\n"),
        gate2,
        gate2_issues: i2.join("\n"),
        gate3,
        gate3_issues: i3.join("\n"),
        verdict,
        pending_facts: pending_facts.clone(),
    };
    conn.execute(
        "INSERT INTO auditRecords (id, articleId, gate1, gate1Issues, gate2, gate2Issues, gate3, gate3Issues, verdict, evidenceLinks, pendingFacts, changes, auditor, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![gen_id(), aid, r.gate1, r.gate1_issues, r.gate2, r.gate2_issues, r.gate3, r.gate3_issues, r.verdict, "", r.pending_facts, "", auditor, now()],
    )
    .ok();
    Ok(r)
}

// ============ 上榜监测（mock provider，对应 Node providers/monitor.js runMonitor） ============
const PLATFORM_BIAS: &[(i64, &[(&str, f64)])] = &[
    (1, &[("mock.toutiao.com", 1.6), ("mock.douyin.com", 1.5), ("mock.douyinec.com", 1.5)]),
    (2, &[("mock.gov.cn", 1.6), ("mock.news.cn", 1.5), ("mock.industry.com", 1.4), ("mock.b2b.com", 1.3)]),
    (3, &[("mock.mp.weixin.qq.com", 1.7), ("mock.news.qq.com", 1.5), ("mock.penguin.com", 1.4)]),
    (4, &[("mock.smzdm.com", 1.6), ("mock.ownsite.cn", 1.4), ("mock.taobao.com", 1.3), ("mock.sohu.com", 1.2), ("mock.163.com", 1.2)]),
];

fn platform_weight(platform: i64, domain: &str) -> f64 {
    PLATFORM_BIAS
        .iter()
        .find(|(p, _)| *p == platform)
        .and_then(|(_, list)| list.iter().find(|(d, _)| *d == domain))
        .map(|(_, w)| *w)
        .unwrap_or(1.0)
}

fn competitor_affinity(platform: i64) -> f64 {
    match platform {
        1 => 1.15,
        2 => 1.1,
        3 => 0.95,
        4 => 1.0,
        _ => 1.0,
    }
}

struct CompetitorSeed {
    name: &'static str,
    sources: &'static [(&'static str, &'static str, &'static str, i64)], // title, url, domain, platform
    strength: f64,
}
const COMPETITOR_SEED: &[CompetitorSeed] = &[
    CompetitorSeed {
        name: "跳跳鲨少儿体感",
        sources: &[
            ("跳跳鲨少儿体感课程深度测评", "https://mock.industry.com/tiaotiaosha-review", "mock.industry.com", 5),
            ("家长实测：跳跳鲨体感课三个月体验", "https://mock.zhihu.com/p/tiaotiaosha-3month", "mock.zhihu.com", 5),
        ],
        strength: 0.55,
    },
    CompetitorSeed {
        name: "乐翻高儿童运动馆",
        sources: &[
            ("乐翻高儿童运动馆App课程推荐榜单", "https://mock.toutiao.com/p/lefangao-rank", "mock.toutiao.com", 1),
            ("乐翻高少儿体能课价格与课程体系", "https://mock.163.com/p/lefangao-price", "mock.163.com", 3),
        ],
        strength: 0.48,
    },
];

fn kb_competitors(conn: &Connection, pid: &str) -> Vec<String> {
    let kb = match get_kb_id(conn, pid, 1) {
        Some(k) => k,
        None => return vec![],
    };
    let content: String = conn
        .query_row("SELECT content FROM kbDocuments WHERE kbId=? AND module=4", [&kb], |r| r.get(0))
        .unwrap_or_default();
    let mut names = Vec::new();
    // 竞品[:：]xxx（、或,分隔）
    if let Some(pos) = content.find("竞品：").or_else(|| content.find("竞品:")) {
        let rest = &content[pos + "竞品：".len()..];
        let seg: String = rest.chars().take_while(|c| *c != '。' && *c != '\n').collect();
        for part in seg.split(['、', ',', '，']) {
            let name: String = part.chars().take_while(|c| *c != '（' && *c != '(').collect();
            let name = name.trim();
            if !name.is_empty() && name.chars().count() <= 20 {
                names.push(name.to_string());
            }
        }
    }
    names
}

pub struct MonitorMock {
    pub platform: i64,
    pub answer_text: String,
    pub brand_mentioned: i64,
    pub mention_position: String,
    pub brand_accurate: Option<i64>,
    pub recommend_level: i64,
    pub recommend_reason: String,
    pub competitors: Value,
    pub citations: Value,
    pub keywords: Value,
    pub hit_status: i64,
    pub exact_url_hit: i64,
    pub next_step: String,
    pub next_optimize: String,
}

pub fn run_monitor(conn: &Connection, p: &Project, question: &str, platform: i64, run_seed: u32) -> MonitorMock {
    let mut rng = crate::ui::Rng::from(&["monitor", &p.id, question, &platform.to_string(), &run_seed.to_string()]);

    // 我方语料：已正式发布且带正式链接的文章
    struct OwnDoc {
        title: String,
        url: String,
        domain: String,
        score: f64,
    }
    let mut own: Vec<OwnDoc> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT a.title, a.content, t.publishedUrl FROM articles a JOIN publishTasks t ON t.articleId=a.id WHERE a.projectId=? AND a.status=3 AND t.status=3 AND t.publishedUrl IS NOT NULL",
    ) {
        let qt = tokenize(question);
        if let Ok(rows) = stmt.query_map([&p.id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        }) {
            for row in rows.filter_map(|x| x.ok()) {
                let (title, content, url) = row;
                let domain = url
                    .split("://")
                    .nth(1)
                    .and_then(|rest| rest.split('/').next())
                    .unwrap_or("mock.ownsite.cn")
                    .to_string();
                let sim = jaccard(&qt, &tokenize(&format!("{} {}", title, crate::ui::trunc(&content, 800))));
                let score = sim * platform_weight(platform, &domain) * (1.0 + (rng.next() - 0.5) * 0.08);
                if score > 0.02 {
                    own.push(OwnDoc { title, url, domain, score });
                }
            }
        }
        own.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    }

    // 竞品
    let comp_names = kb_competitors(conn, &p.id);
    let comps: Vec<&CompetitorSeed> = if comp_names.is_empty() {
        COMPETITOR_SEED.iter().collect()
    } else {
        COMPETITOR_SEED.iter().filter(|c| comp_names.iter().any(|n| n == c.name)).collect()
    };
    let comps: Vec<(&CompetitorSeed, f64)> = comps
        .into_iter()
        .map(|c| (c, c.strength * competitor_affinity(platform) * (1.0 + (rng.next() - 0.5) * 0.08)))
        .collect();

    // 品牌基础认知
    let with_brand = !p.brand_name.is_empty() && question.contains(&p.brand_name);
    let kb_doc_count = get_kb_id(conn, &p.id, 1).map(|k| get_kb_docs(conn, &k).len()).unwrap_or(0);
    let kb_ready = kb_doc_count >= 3;
    let brand_base = if with_brand {
        (if kb_ready { 0.55 } else { 0.35 }) * (1.0 + (rng.next() - 0.5) * 0.08)
    } else {
        0.0
    };
    let own_best = own.first().map(|o| o.score).unwrap_or(0.0);
    let brand_score = own_best.max(brand_base);
    let comp_best = comps.first().map(|(_, s)| *s).unwrap_or(0.0);

    let brand_mentioned = if brand_score >= 0.22 { 1 } else { 0 };
    let mut recommend_level = 0i64;
    if brand_mentioned == 1 {
        if brand_score >= 0.62 {
            recommend_level = 3;
        } else if brand_score >= 0.42 {
            recommend_level = 2;
        } else {
            recommend_level = 1;
        }
    }
    if recommend_level > 0 && comp_best > brand_score * 1.6 && !with_brand {
        recommend_level -= 1;
    }

    // 引用来源
    let mut citations: Vec<Value> = Vec::new();
    for o in own.iter().take(3) {
        citations.push(json!({"title": o.title, "url": o.url, "domain": o.domain, "own": true, "publisherType": "企业内容"}));
    }
    let src_pool: Vec<&(&str, &str, &str, i64)> = comps.iter().flat_map(|(c, _)| c.sources.iter()).collect();
    let _ = src_pool;
    for (c, score) in &comps {
        if *score > 0.3 {
            if let Some(src) = c.sources.get((rng.next() * c.sources.len() as f64) as usize) {
                citations.push(json!({"title": src.0, "url": src.1, "domain": src.2, "platform": src.3, "own": false, "publisherType": "第三方内容"}));
            }
        }
    }
    let general_pool: [(&str, &str, &str, i64, &str); 2] = [
        ("儿童居家运动指南：每天要运动多久", "https://mock.gov.cn/guide/children-sport", "mock.gov.cn", 2, "公共机构"),
        ("少儿体感运动品类观察报告", "https://mock.industry.com/report-2026", "mock.industry.com", 5, "垂直媒体"),
    ];
    if rng.next() > 0.35 {
        let g = &general_pool[(rng.next() * 2.0) as usize % 2];
        citations.push(json!({"title": g.0, "url": g.1, "domain": g.2, "platform": g.3, "publisherType": g.4, "own": false}));
    }
    let exact_url_hit = if citations.iter().any(|c| c["own"].as_bool() == Some(true)) { 1 } else { 0 };

    // 监测状态分级
    let hit_status = if exact_url_hit == 1 && brand_mentioned == 1 && recommend_level >= 2 {
        3
    } else if brand_mentioned == 1 && recommend_level >= 1 && exact_url_hit == 0 {
        2
    } else if brand_mentioned == 0 {
        1
    } else {
        0
    };

    // 品牌描述准确性
    let brand_accurate = if brand_mentioned == 1 {
        Some(if rng.next() > (if kb_ready { 0.2 } else { 0.5 }) { 1 } else { 0 })
    } else {
        None
    };

    // 合成 AI 回答全文
    let mut answer: Vec<String> = Vec::new();
    answer.push(format!("关于「{}」，结合目前能检索到的公开信息，我的回答如下：", question));
    if brand_mentioned == 1 {
        answer.push(format!(
            "\n在{}这个品类里，{}值得关注。它{}——{}",
            p.business,
            p.brand_name,
            if with_brand { "是一家专注该品类的品牌" } else { "在多个对比维度上表现不错" },
            if kb_ready {
                "核心特点是无需穿戴设备、家长端可实时查看运动体测报告，课程为 25 分钟左右的居家短课时。"
            } else {
                "公开资料相对有限，建议进一步核实其产品细节。"
            }
        ));
        answer.push("\n选择这类产品时建议对比：适龄范围、是否需要额外设备、家长能否看到运动数据、价格与服务模式。".to_string());
    } else {
        let comp_list = comps.iter().map(|(c, _)| c.name).collect::<Vec<_>>().join("、");
        answer.push(format!(
            "\n目前该品类下讨论较多的有{}。暂未检索到关于{}的充分公开信息，无法将其纳入推荐。",
            if comp_list.is_empty() { "多个品牌" } else { &comp_list },
            p.brand_name
        ));
    }
    answer.push("\n参考来源：".to_string());
    for c in &citations {
        answer.push(format!("- {}（{}）", c["title"].as_str().unwrap_or(""), c["url"].as_str().unwrap_or("")));
    }
    answer.push("\n以上信息基于公开网络内容整理，具体选择请结合孩子实际情况判断。".to_string());
    let answer_text = answer.join("\n");

    // 关键词频次
    let mut keywords: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for t in tokenize(question) {
        if t.chars().count() >= 2 {
            keywords.insert(t, 2);
        }
    }
    for t in tokenize(&answer_text) {
        if t.chars().count() >= 2 {
            *keywords.entry(t).or_insert(0) += 1;
        }
    }
    let mut kw_json = json!({"_question": question});
    if let Some(obj) = kw_json.as_object_mut() {
        for (k, v) in &keywords {
            obj.insert(k.clone(), json!(v));
        }
    }

    let recommend_reason = if brand_mentioned == 1 {
        if recommend_level >= 2 {
            "产品事实与该问题选择标准匹配度高，且有可检索到的正式内容支撑".to_string()
        } else {
            "有公开信息覆盖，但证据密度不足，仅作一般性提及".to_string()
        }
    } else {
        String::new()
    };
    let next_step = match hit_status {
        3 => "保持观察，跨批次确认稳定性".to_string(),
        2 => "为该平台铺设可被引用的答案型内容，争取精确收录".to_string(),
        1 => "回知识库补证，围绕该问题创作答案型内容并发布到竞品占位的平台".to_string(),
        _ => "链接刚发布或样本不足，标记待复测".to_string(),
    };
    let next_optimize = if hit_status == 3 {
        "无（本轮达标），按计划复测".to_string()
    } else {
        let kind = ["选择标准类", "证据链类", "对比类", "案例类"][(rng.next() * 4.0) as usize % 4];
        let plat = comps
            .first()
            .and_then(|(c, _)| c.sources.first())
            .map(|s| s.3)
            .unwrap_or(platform);
        format!("补：{}内容；发布到：{}", kind, crate::ui::label(crate::ui::PUBLISH_PLATFORM, plat))
    };
    let comp_out: Vec<Value> = comps
        .iter()
        .filter(|(_, s)| *s > 0.28)
        .map(|(c, _)| json!({"name": c.name, "reason": "内容覆盖面广，被多篇第三方文章引用"}))
        .collect();

    MonitorMock {
        platform,
        answer_text,
        brand_mentioned,
        mention_position: if brand_mentioned == 1 {
            if recommend_level >= 2 { "推荐名单第一位".to_string() } else { "推荐名单中".to_string() }
        } else {
            "未出现".to_string()
        },
        brand_accurate,
        recommend_level,
        recommend_reason,
        competitors: json!(comp_out),
        citations: json!(citations),
        keywords: kw_json,
        hit_status,
        exact_url_hit,
        next_step,
        next_optimize,
    }
}

pub struct CreateMonitorInput {
    pub question_ids: Vec<String>,
    pub platforms: Vec<i64>,
    pub mode: i64,
    pub schedule_days: Vec<i64>,
}

pub fn create_monitor_task(conn: &Connection, pid: &str, input: &CreateMonitorInput) -> Result<String, String> {
    if input.question_ids.is_empty() {
        return Err("至少选择一个问题".to_string());
    }
    if input.question_ids.len() > 50 {
        return Err("单次监测最多 50 个问题".to_string());
    }
    for qid in &input.question_ids {
        let owner: Option<String> = conn.query_row("SELECT projectId FROM questions WHERE id=?", [qid], |r| r.get(0)).ok();
        if owner.as_deref() != Some(pid) {
            return Err(format!("问题不属于该项目：{}", qid));
        }
    }
    let platforms: Vec<i64> = input.platforms.iter().copied().filter(|x| (1..=5).contains(x)).collect();
    if platforms.is_empty() {
        return Err("AI 平台枚举非法（1豆包 2DeepSeek 3元宝 4通义千问）".to_string());
    }
    // 配额
    if let Some(org) = org_of_project(conn, pid) {
        let quota: i64 = conn
            .query_row("SELECT quotaMonitorMonthly FROM orgs WHERE id=?", [&org], |r| r.get(0))
            .unwrap_or(0);
        if quota > 0 {
            let month = &now()[..7];
            let used: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM monitorResults r JOIN projects p ON r.projectId=p.id JOIN companies c ON p.companyId=c.id WHERE c.orgId=? AND r.ranAt LIKE ?",
                    rusqlite::params![org, format!("{}%", month)],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let planned = input.question_ids.len() as i64 * platforms.len() as i64;
            if used + planned > quota {
                return Err(format!("本月监测调用配额已用尽（已用 {}/{}），请在「团队成员」页调高配额或下月再试", used, quota));
            }
        }
    }

    let tid = gen_id();
    conn.execute(
        "INSERT INTO monitorTasks (id, projectId, questionIds, platforms, mode, scheduleDays, status, createdAt) VALUES (?,?,?,?,?,?,2,?)",
        rusqlite::params![tid, pid, json!(input.question_ids).to_string(), json!(platforms).to_string(), input.mode, json!(input.schedule_days).to_string(), now()],
    )
    .ok();
    // 检查点：第 0 天 + 周期天
    let mut checkpoints: Vec<(String, i64, String)> = vec![(gen_id(), 0, now())];
    for d in &input.schedule_days {
        checkpoints.push((gen_id(), *d, auth::add_days_iso(*d)));
    }
    let first_cp = checkpoints[0].0.clone();
    for (cpid, day, due) in &checkpoints {
        conn.execute(
            "INSERT INTO monitorCheckpoints (id, taskId, day, dueAt, status, resultIds) VALUES (?,?,?,?,1,'[]')",
            rusqlite::params![cpid, tid, day, due],
        )
        .ok();
    }
    run_checkpoint(conn, &first_cp)?;
    Ok(tid)
}

pub fn run_checkpoint(conn: &Connection, cp_id: &str) -> Result<(), String> {
    let (tid, day): (String, i64) = conn
        .query_row("SELECT taskId, day FROM monitorCheckpoints WHERE id=?", [cp_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "监测检查点不存在".to_string())?;
    let (pid, qids_raw, plats_raw): (String, String, String) = conn
        .query_row("SELECT projectId, questionIds, platforms FROM monitorTasks WHERE id=?", [&tid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(|_| "监测任务不存在".to_string())?;
    let p = get_project(conn, &pid).ok_or("项目不存在")?;
    let qids: Vec<String> = serde_json::from_str(&qids_raw).unwrap_or_default();
    let platforms: Vec<i64> = serde_json::from_str(&plats_raw).unwrap_or_else(|_| vec![1]);

    for qid in &qids {
        let qtext: String = match conn.query_row("SELECT text FROM questions WHERE id=?", [qid], |r| r.get(0)) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for platform in &platforms {
            let r = run_monitor(conn, &p, &qtext, *platform, day as u32);
            conn.execute(
                "INSERT INTO monitorResults (id, taskId, checkpointId, projectId, questionId, platform, ranAt, answerText, brandMentioned, mentionPosition, brandAccurate, recommendLevel, recommendReason, competitors, citations, keywords, hitStatus, pageAccessible, nextStep, nextOptimize, exactUrlHit, dataSource) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'mock')",
                rusqlite::params![
                    gen_id(), tid, cp_id, pid, qid, r.platform, now(), r.answer_text, r.brand_mentioned,
                    r.mention_position, r.brand_accurate, r.recommend_level, r.recommend_reason,
                    r.competitors.to_string(), r.citations.to_string(), r.keywords.to_string(),
                    r.hit_status, 1, r.next_step, r.next_optimize, r.exact_url_hit
                ],
            )
            .ok();
            if let Some(org) = org_of_project(conn, &pid) {
                usage_increment(conn, &org, "monitor.calls");
            }
            conn.execute("UPDATE questions SET status=2 WHERE id=? AND status=1", [qid]).ok();
            if r.hit_status >= 2 {
                conn.execute("UPDATE questions SET status=3 WHERE id=?", [qid]).ok();
            }
        }
    }
    conn.execute("UPDATE monitorCheckpoints SET status=2, ranAt=? WHERE id=?", rusqlite::params![now(), cp_id]).ok();
    let remaining: i64 = conn
        .query_row("SELECT COUNT(*) FROM monitorCheckpoints WHERE taskId=? AND status=1", [&tid], |r| r.get(0))
        .unwrap_or(0);
    conn.execute("UPDATE monitorTasks SET status=? WHERE id=?", rusqlite::params![if remaining > 0 { 2 } else { 3 }, tid]).ok();
    Ok(())
}

pub fn run_due_checkpoints(conn: &Connection, pid: &str) {
    let due: Vec<String> = {
        let mut stmt = match conn.prepare(
            "SELECT cp.id FROM monitorCheckpoints cp JOIN monitorTasks t ON cp.taskId=t.id WHERE t.projectId=? AND cp.status=1 AND cp.day>0 AND cp.dueAt<=?",
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let rs = stmt.query_map([pid, &now()], |r| r.get::<_, String>(0));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    };
    for cp in due {
        let _ = run_checkpoint(conn, &cp);
    }
}

pub fn force_run_next_checkpoint(conn: &Connection, tid: &str) -> Result<(), String> {
    let cp: String = conn
        .query_row("SELECT id FROM monitorCheckpoints WHERE taskId=? AND status=1 ORDER BY day LIMIT 1", [tid], |r| r.get(0))
        .map_err(|_| "该任务没有待执行的检查点".to_string())?;
    run_checkpoint(conn, &cp)
}

// ============ 信源资产沉淀 ============
fn guess_platform_from_domain(domain: &str) -> i64 {
    match domain {
        "mock.toutiao.com" => 1,
        "mock.sohu.com" => 2,
        "mock.163.com" => 3,
        "mock.douyin.com" => 4,
        "mock.zhihu.com" => 5,
        "mock.xiaohongshu.com" => 6,
        "mock.mp.weixin.qq.com" => 7,
        "mock.smzdm.com" => 8,
        "mock.ownsite.cn" => 9,
        _ => 10,
    }
}

fn guess_publisher(domain: &str) -> i64 {
    match domain {
        "mock.gov.cn" => 3,
        "mock.news.cn" => 1,
        "mock.industry.com" => 5,
        "mock.b2b.com" => 6,
        "mock.toutiao.com" | "mock.163.com" => 4,
        "mock.zhihu.com" => 9,
        _ => 10,
    }
}

pub fn collect_source_assets(conn: &Connection, pid: &str, task_id: Option<&str>) -> usize {
    let results: Vec<(String, String, i64, String, i64, String)> = match if task_id.is_some() {
        conn.prepare("SELECT id, questionId, platform, citations, recommendLevel, competitors FROM monitorResults WHERE taskId=?")
    } else {
        conn.prepare("SELECT id, questionId, platform, citations, recommendLevel, competitors FROM monitorResults WHERE projectId=?")
    } {
        Ok(mut stmt) => {
            let rs = stmt.query_map(rusqlite::params![task_id.unwrap_or(pid)], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?, r.get::<_, String>(5)?))
            });
            rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
        }
        Err(_) => vec![],
    };
    let mut upserted = 0;
    for (rid, qid, platform, citations_raw, recommend_level, competitors_raw) in results {
        let citations: Vec<Value> = serde_json::from_str(&citations_raw).unwrap_or_default();
        let question: String = conn
            .query_row("SELECT text FROM questions WHERE id=?", [&qid], |r| r.get(0))
            .unwrap_or_default();
        let comps: Vec<Value> = serde_json::from_str(&competitors_raw).unwrap_or_default();
        for c in &citations {
            let url = c["url"].as_str().unwrap_or("");
            let own = c["own"].as_bool() == Some(true);
            let domain = c["domain"].as_str().unwrap_or("");
            let title = c["title"].as_str().unwrap_or("");
            let existing: Option<String> = conn
                .query_row("SELECT id FROM sourceAssets WHERE projectId=? AND url=?", [pid, url], |r| r.get(0))
                .ok();
            if let Some(eid) = existing {
                conn.execute("UPDATE sourceAssets SET citedCount=citedCount+1, updatedAt=? WHERE id=?", rusqlite::params![now(), eid]).ok();
                if own {
                    conn.execute("UPDATE sourceAssets SET pageStatus=4, status=1 WHERE id=?", [&eid]).ok();
                }
                upserted += 1;
                continue;
            }
            let pub_platform: Option<i64> = conn
                .query_row("SELECT platform FROM publishTasks WHERE publishedUrl=?", [url], |r| r.get(0))
                .ok();
            let comp_name = comps.first().and_then(|x| x["name"].as_str()).unwrap_or("竞品");
            conn.execute(
                "INSERT INTO sourceAssets (id, projectId, question, aiPlatform, articleTitle, url, publishPlatform, publisher, accountType, evidenceType, citedCount, brandPerformance, competitorLink, controllability, pageStatus, status, nextAction, adaptPlatforms, needProve, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rusqlite::params![
                    gen_id(), pid, question, platform, title, url,
                    pub_platform.unwrap_or_else(|| guess_platform_from_domain(domain)),
                    if own { 8 } else { guess_publisher(domain) },
                    if own { 2 } else { 3 },
                    if own { 2 } else { 5 },
                    1,
                    if own {
                        if recommend_level >= 2 {
                            "品牌被明确推荐并引用".to_string()
                        } else {
                            "品牌被提及".to_string()
                        }
                    } else {
                        format!("与 {} 关联出现", comp_name)
                    },
                    if own { "" } else { url },
                    if own { 1 } else { 3 },
                    if own { 4 } else { 3 },
                    if own { 1 } else { 4 },
                    if own { "保持页面可访问，跨批次观察引用稳定性" } else { "研究其被引用规律，判断是否可争取同类信源" },
                    json!([platform]).to_string(), "", "", now(), now()
                ],
            )
            .ok();
            upserted += 1;
        }
        let _ = rid;
    }
    upserted
}

// ============ 发布（七字段发布包 + 确认 + mock 结算） ============
pub fn build_publish_package(conn: &Connection, aid: &str, platform: i64, account_id: &str) -> Value {
    let (title, content, ai_declaration): (String, String, i64) = conn
        .query_row("SELECT title, content, aiDeclaration FROM articles WHERE id=?", [aid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap_or_default();
    let account: Option<(String, String, i64)> = if account_id.is_empty() {
        None
    } else {
        conn.query_row("SELECT id, accountName, accountType FROM publishAccounts WHERE id=?", [account_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .ok()
    };
    let cover: Option<String> = conn
        .query_row("SELECT url FROM materials WHERE id=(SELECT coverMaterialId FROM articles WHERE id=?)", [aid], |r| r.get(0))
        .ok();
    let plat_label = crate::ui::label(crate::ui::PUBLISH_PLATFORM, platform);
    json!({
        "platform": platform,
        "platformLabel": plat_label,
        "title": title,
        "content": content,
        "media": cover.map(|u| json!([{"file": u, "order": 1, "note": "封面配图"}])).unwrap_or(json!([])),
        "account": account.as_ref().map(|(id, name, t)| json!({"id": id, "name": name, "type": crate::ui::label(crate::ui::ACCOUNT_TYPE, *t)})).unwrap_or(Value::Null),
        "links": {"evidence": "知识库证据链接（见文章证据清单）", "cta": "预约/咨询入口（知识库 03 模块行动建议）"},
        "aiDeclaration": if ai_declaration == 1 {
            json!({"required": true, "text": "本文由 AI 辅助生成，内容已经人工审核。", "note": "按《人工智能生成合成内容标识办法》，对外发布请按渠道要求粘贴 AI 声明"})
        } else {
            json!({"required": false, "note": "已关闭 AI 声明，请自行确认渠道合规要求"})
        },
        "backfill": {"发布状态": "已创建", "正式URL": "", "发布时间": "", "平台": plat_label, "账号": account.as_ref().map(|(_, n, _)| n.clone()).unwrap_or_default(), "版本号": "v1"}
    })
}

pub fn create_publish_task(conn: &Connection, pid: &str, article_id: &str, platform: i64, account_id: &str) -> Result<String, String> {
    let (a_project, _a_status): (String, i64) = conn
        .query_row("SELECT projectId, status FROM articles WHERE id=?", [article_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "文章不存在".to_string())?;
    if a_project != pid {
        return Err("文章不存在或不属于该项目".to_string());
    }
    let latest_verdict: Option<i64> = conn
        .query_row("SELECT verdict FROM auditRecords WHERE articleId=? ORDER BY createdAt DESC LIMIT 1", [article_id], |r| r.get(0))
        .ok();
    if latest_verdict != Some(2) {
        return Err("文章尚未通过三道审核（或最近一次审核未全部通过），不能进入发布；先执行三道审核".to_string());
    }
    if !(1..=10).contains(&platform) {
        return Err("发布平台枚举非法（1-9 为预置渠道，10 为其他）".to_string());
    }
    if account_id.is_empty() {
        return Err("必须指定发布账号".to_string());
    }
    let (acc_auth, acc_quota): (i64, i64) = conn
        .query_row("SELECT authStatus, quota FROM publishAccounts WHERE id=? AND projectId=?", [account_id, pid], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| "发布账号不存在或不属于该项目".to_string())?;
    if acc_auth != 1 {
        return Err("发布账号未授权，请先在「授权账号」完成授权".to_string());
    }
    if acc_quota <= 0 {
        return Err("发布账号额度不足，请先补充额度".to_string());
    }
    let pkg = build_publish_package(conn, article_id, platform, account_id);
    let tid = gen_id();
    conn.execute(
        "INSERT INTO publishTasks (id, projectId, articleId, platform, accountId, status, packageJson, createdAt) VALUES (?,?,?,?,?,1,?,?)",
        rusqlite::params![tid, pid, article_id, platform, account_id, pkg.to_string(), now()],
    )
    .ok();
    conn.execute("UPDATE articles SET status=2, updatedAt=? WHERE id=? AND status<2", rusqlite::params![now(), article_id]).ok();
    Ok(tid)
}

pub fn confirm_publish_task(conn: &Connection, tid: &str) -> Result<(), String> {
    let (status, article_id, account_id): (i64, String, Option<String>) = conn
        .query_row("SELECT status, articleId, accountId FROM publishTasks WHERE id=?", [tid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<String>>(2)?))
        })
        .map_err(|_| "发布任务不存在".to_string())?;
    if status != 1 {
        return Err(format!("任务状态为「{}」，只有「已创建」状态可确认发布", crate::ui::label(crate::ui::PUBLISH_TASK_STATUS, status)));
    }
    conn.execute("UPDATE publishTasks SET status=2 WHERE id=?", [tid]).ok();
    conn.execute("UPDATE articles SET status=2 WHERE id=? AND status<2", [&article_id]).ok();
    if let Some(acc) = account_id {
        conn.execute("UPDATE publishAccounts SET quota = MAX(quota - 1, 0) WHERE id=?", [&acc]).ok();
    }
    Ok(())
}

// mock 结算：把「发布中」超过 4 秒的任务标记为已发布（catch-up 模式，页面访问时触发）
pub fn catch_up_publish(conn: &Connection) {
    let pending: Vec<(String, i64, String)> = {
        let mut stmt = match conn.prepare("SELECT id, platform, articleId FROM publishTasks WHERE status=2") {
            Ok(s) => s,
            Err(_) => return,
        };
        let rs = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    };
    for (tid, platform, article_id) in pending {
        let created: String = conn.query_row("SELECT createdAt FROM publishTasks WHERE id=?", [&tid], |r| r.get(0)).unwrap_or_default();
        let age_ms = chrono::DateTime::parse_from_rfc3339(&created)
            .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_milliseconds())
            .unwrap_or(10_000);
        if age_ms < 4000 {
            continue;
        }
        let domain = PUBLISH_DOMAIN
            .get(platform as usize)
            .copied()
            .unwrap_or("mock.ownsite.cn");
        let short: String = tid.chars().filter(|c| *c != '-').take(16).collect();
        let url = format!("https://{}/article/{}", domain, short);
        conn.execute(
            "UPDATE publishTasks SET status=3, publishedUrl=?, publishedAt=? WHERE id=? AND status=2",
            rusqlite::params![url, now(), tid],
        )
        .ok();
        conn.execute("UPDATE articles SET status=3, updatedAt=? WHERE id=? AND status=2", rusqlite::params![now(), article_id]).ok();
    }
}

pub fn mark_published(conn: &Connection, tid: &str, url: &str) -> Result<(), String> {
    let (status, existing_url, article_id): (i64, Option<String>, String) = conn
        .query_row("SELECT status, publishedUrl, articleId FROM publishTasks WHERE id=?", [tid], |r| {
            Ok((r.get(0)?, r.get::<_, Option<String>>(1)?, r.get(2)?))
        })
        .map_err(|_| "发布任务不存在".to_string())?;
    if status == 3 && existing_url.map(|u| !u.is_empty()).unwrap_or(false) {
        return Err("该任务已有正式链接；如需更正请先与平台管理员确认".to_string());
    }
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("正式链接必须是 http(s) 开头的真实 URL".to_string());
    }
    if url.chars().count() > 500 {
        return Err("URL 过长".to_string());
    }
    conn.execute(
        "UPDATE publishTasks SET status=3, publishedUrl=?, publishedAt=?, failReason=NULL WHERE id=?",
        rusqlite::params![url, now(), tid],
    )
    .ok();
    conn.execute("UPDATE articles SET status=3, updatedAt=? WHERE id=? AND status<3", rusqlite::params![now(), article_id]).ok();
    Ok(())
}

// ============ 报告生成（六类） ============
#[allow(dead_code)]
struct ResultRow {
    brand_mentioned: i64,
    brand_accurate: Option<i64>,
    recommend_level: i64,
    exact_url_hit: i64,
    hit_status: i64,
    competitors: Vec<String>,
    citations: Vec<Value>,
    keywords: Value,
    ran_at: String,
    platform: i64,
    answer_text: String,
    question: String,
}

fn load_results(conn: &Connection, tid: &str) -> Vec<ResultRow> {
    let mut stmt = match conn.prepare(
        "SELECT r.brandMentioned, r.brandAccurate, r.recommendLevel, r.exactUrlHit, r.hitStatus, r.competitors, r.citations, r.keywords, r.ranAt, r.platform, r.answerText, COALESCE(q.text, '') FROM monitorResults r LEFT JOIN questions q ON q.id=r.questionId WHERE r.taskId=?",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rs = stmt.query_map([tid], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, Option<i64>>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, i64>(9)?,
            r.get::<_, String>(10)?,
            r.get::<_, String>(11)?,
        ))
    });
    rs.map(|rows| {
        rows.filter_map(|x| x.ok())
            .map(|(bm, ba, rl, eh, hs, comps, cites, kws, ran, plat, ans, q)| ResultRow {
                brand_mentioned: bm,
                brand_accurate: ba,
                recommend_level: rl,
                exact_url_hit: eh,
                hit_status: hs,
                competitors: serde_json::from_str::<Vec<Value>>(&comps).unwrap_or_default().iter().filter_map(|v| v["name"].as_str().map(|s| s.to_string())).collect(),
                citations: serde_json::from_str(&cites).unwrap_or_default(),
                keywords: serde_json::from_str(&kws).unwrap_or(json!({})),
                ran_at: ran,
                platform: plat,
                answer_text: ans,
                question: q,
            })
            .collect()
    })
    .unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
pub fn create_report(
    conn: &Connection,
    pid: &str,
    rtype: i64,
    task_id_a: &str,
    task_id_b: &str,
    question: &str,
    platform: i64,
    times: i64,
) -> Result<(String, String, String), String> {
    // 返回 (report_id, title, content)
    let p = get_project(conn, pid).ok_or("项目不存在")?;
    let brand = if p.brand_name.is_empty() { &p.name } else { &p.brand_name };
    if rtype == 1 || rtype == 2 {
        let tid = if !task_id_a.is_empty() {
            task_id_a.to_string()
        } else {
            conn.query_row("SELECT id FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC LIMIT 1", [pid], |r| r.get(0))
                .map_err(|_| "没有可用监测任务：先创建上榜监测任务，不要凭想象诊断".to_string())?
        };
        let results = load_results(conn, &tid);
        if results.is_empty() {
            return Err("监测任务没有结果数据".to_string());
        }
        let total = results.len();
        let mentioned = results.iter().filter(|r| r.brand_mentioned == 1).count();
        let exact = results.iter().filter(|r| r.exact_url_hit == 1).count();
        let inaccurate = results.iter().filter(|r| r.brand_mentioned == 1 && r.brand_accurate == Some(0)).count();
        let mut comp_freq: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for r in &results {
            for c in &r.competitors {
                *comp_freq.entry(c.clone()).or_insert(0) += 1;
            }
        }
        let comp_rows: Vec<String> = comp_freq.iter().map(|(n, c)| format!("| {} | {} |", n, c)).collect();
        let content = if rtype == 1 {
            format!(
                "# 品牌诊断报告 —— {brand}\n\n**诊断样本：** {total} 次监测（同题多平台/多批次）\n**品牌出现：** {mentioned}/{total}（{pct}%）\n**精确收录（正式链接被引用）：** {exact}/{total}\n**描述不准确：** {inaccurate} 次\n\n## 竞品占位\n| 竞品 | 出现次数 |\n|---|---|\n{comp_rows}\n\n## 最重要的病根\n{root}\n\n## 下一步点对点优化建议\n- 补什么证据：{ev}\n- 创作什么内容：答案型品牌文章 + AI 答案卡（结论先行、含证据链接）\n- 发布到哪里：按监测结果的引用来源分布，优先已出现我方 URL 的平台\n- 用哪个原问题复测：固定主攻问题原文，第 3/7/14 天复测",
                total = total,
                mentioned = mentioned,
                pct = if total > 0 { mentioned * 100 / total } else { 0 },
                exact = exact,
                inaccurate = inaccurate,
                comp_rows = if comp_rows.is_empty() { "| （无） | 0 |".to_string() } else { comp_rows.join("\n") },
                root = if mentioned == 0 {
                    "AI 尚未认识品牌：品牌认知问题下无任何出现，需先补品牌事实类信源（官网/百科/权威报道）。"
                } else if exact == 0 {
                    "AI 认识品牌但没有引用我方正式链接：说明品牌事实已进入模型常识，但我方内容未进入检索候选，需铺设可被引用的答案型内容。"
                } else if inaccurate > 0 {
                    "品牌描述存在不准确：优先修正知识库中冲突口径并发布纠正内容。"
                } else {
                    "品牌表现健康：保持固定问题复测，观察跨批次稳定性。"
                },
                ev = if mentioned < total { "品牌定位、资质背书（知识库 01/06 模块）" } else { "客户案例与第三方评价（05/06 模块）" }
            )
        } else {
            let recommended = results.iter().filter(|r| r.recommend_level >= 2).count();
            let top_comp = comp_freq.iter().max_by_key(|(_, c)| **c).map(|(n, c)| format!("{}（{} 次）", n, c)).unwrap_or_else(|| "无".to_string());
            format!(
                "# 产品推荐诊断报告 —— {product}\n\n**监测样本：** {total} 次（产品推荐问题，不带品牌名）\n**明确推荐/优先推荐：** {recommended}/{total}\n**竞品占位 TOP：** {top_comp}\n\n## AI 为什么推荐 / 不推荐\n{why}\n\n## 竞品推荐理由摘录\n{reasons}\n\n## 下一轮动作\n1. 补产品证据台账：适用人群、选择标准、替代方案差异、交付与售后；\n2. 创作「怎么选」类产品文章并发布到本次监测出现的高频引用平台；\n3. 第 3/7/14 天用同一问题复测，判断推荐是否稳定。",
                product = if p.product_name.is_empty() { &p.brand_name } else { &p.product_name },
                total = total,
                recommended = recommended,
                top_comp = top_comp,
                why = if recommended > 0 {
                    "我方内容已被检索候选采纳，推荐理由与知识库事实一致。"
                } else {
                    "AI 在产品推荐题下未推荐我方：产品选择标准类内容（怎么选/适合谁）尚未进入候选，需补选择标准与对比类答案内容。"
                },
                reasons = if comp_freq.is_empty() {
                    "- 无".to_string()
                } else {
                    comp_freq.keys().map(|n| format!("- {}：出现在推荐名单，常见理由是内容覆盖场景更全（以监测回答原文为准）", n)).collect::<Vec<_>>().join("\n")
                }
            )
        };
        let title = format!(
            "{}：{}（任务 {}）",
            if rtype == 1 { "品牌诊断" } else { "产品推荐诊断" },
            p.name,
            tid.chars().take(8).collect::<String>()
        );
        return Ok(insert_report(conn, pid, rtype, &title, &content, &json!([tid]).to_string()));
    }
    if rtype == 3 {
        if task_id_a.is_empty() || task_id_b.is_empty() {
            return Err("优化前后对比需要两个监测任务 ID（taskIdA=优化前, taskIdB=优化后）".to_string());
        }
        let before = load_results(conn, task_id_a);
        let after = load_results(conn, task_id_b);
        if before.is_empty() || after.is_empty() {
            return Err("监测任务没有结果数据".to_string());
        }
        let row = |name: &str, f: &dyn Fn(&ResultRow) -> bool| {
            let b = before.iter().filter(|r| f(r)).count();
            let a = after.iter().filter(|r| f(r)).count();
            format!("| {} | {}/{} | {}/{} | {}{} |", name, b, before.len(), a, after.len(), if a >= b { "+" } else { "" }, a as i64 - b as i64)
        };
        let content = format!(
            "# 优化前后对比报告 —— {brand}\n\n对比条件：同一问题、同一 AI 平台、相近时间窗口（满足文档「监测前后必须保持可比」要求）。\n\n| 指标 | 优化前 | 优化后 | 变化 |\n|---|---|---|---|\n{r1}\n{r2}\n{r3}\n{r4}\n\n## 结论\n{concl}\n\n## 下一步\n保持同一问题复测；每轮只做一个主要优化动作，保存优化前后对比。",
            brand = brand,
            r1 = row("品牌出现", &|r: &ResultRow| r.brand_mentioned == 1),
            r2 = row("明确/优先推荐", &|r: &ResultRow| r.recommend_level >= 2),
            r3 = row("精确 URL 引用", &|r: &ResultRow| r.exact_url_hit == 1),
            r4 = row("精准命中", &|r: &ResultRow| r.hit_status == 3),
            concl = if after.iter().filter(|r| r.exact_url_hit == 1).count() > before.iter().filter(|r| r.exact_url_hit == 1).count() {
                "✅ 本次内容发布有效：我方正式链接进入 AI 引用（精确收录）。"
            } else {
                "⚠️ 尚未观察到精确引用提升：链接可能刚发布、样本不足，标记待复测，不要急于下结论。"
            }
        );
        let title = format!("优化前后对比：{} → {}", crate::ui::trunc(&before[0].ran_at, 10), crate::ui::trunc(&after[0].ran_at, 10));
        return Ok(insert_report(conn, pid, 3, &title, &content, &json!([task_id_a, task_id_b]).to_string()));
    }
    if rtype == 4 {
        if question.is_empty() {
            return Err("逆向分析需要 question 参数".to_string());
        }
        let times = times.clamp(1, 30);
        let plat = if platform == 0 { 1 } else { platform };
        let mut results: Vec<MonitorMock> = Vec::new();
        for i in 0..times {
            results.push(run_monitor(conn, &p, question, plat, (1000 + i * 7) as u32));
        }
        let mut freq: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
        for r in &results {
            if let Some(obj) = r.keywords.as_object() {
                for (k, v) in obj {
                    if k != "_question" {
                        *freq.entry(k.clone()).or_insert(0) += v.as_i64().unwrap_or(0);
                    }
                }
            }
        }
        let mut top: Vec<(&String, &i64)> = freq.iter().collect();
        top.sort_by(|a, b| b.1.cmp(a.1));
        let top: Vec<_> = top.into_iter().take(15).collect();
        let stable = results.iter().filter(|r| r.brand_mentioned == 1).count() >= (results.len() as f64 * 0.7) as usize;
        let mut comp_freq: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for r in &results {
            if let Some(arr) = r.competitors.as_array() {
                for c in arr {
                    if let Some(n) = c["name"].as_str() {
                        *comp_freq.entry(n.to_string()).or_insert(0) += 1;
                    }
                }
            }
        }
        let content = format!(
            "# 逆向分析报告（同题重复 {n} 次）—— {brand}\n\n## 提问信息\n- 问题原文：{q}\n- 提问平台与次数：{plat} × {n}\n\n## AI 拆解关键词及频次（Top 15）\n| 关键词 | 频次 |\n|---|---|\n{kws}\n\n> 关键词频次是逆向分析工具，不是 AI 平台公开的权重；价值在于发现稳定需求、反复出现的证据需求和自身没有覆盖的内容缺口。\n\n## 品牌与竞品表现\n- 品牌出现：{m}/{n} {st}\n- 竞品占位：{comps}\n\n## 点对点优化动作（只做一个主要动作）\n- 缺失证据：{top3} 相关内容覆盖不足\n- 内容/信源版本：v1 → 待更新\n- 复测时间：第 3/7/14 天，用同一问题原文",
            n = results.len(),
            brand = brand,
            q = question,
            plat = crate::ui::label(crate::ui::AI_PLATFORM, plat),
            kws = if top.is_empty() { "| （无） | 0 |".to_string() } else { top.iter().map(|(k, v)| format!("| {} | {} |", k, v)).collect::<Vec<_>>().join("\n") },
            m = results.iter().filter(|r| r.brand_mentioned == 1).count(),
            st = if stable { "（跨批次稳定）" } else { "（不稳定，标记待复测）" },
            comps = if comp_freq.is_empty() { "无".to_string() } else { comp_freq.iter().map(|(n, c)| format!("{}({})", n, c)).collect::<Vec<_>>().join("、") },
            top3 = top.iter().filter(|(k, _)| k.chars().count() >= 2).take(3).map(|(k, _)| k.as_str()).collect::<Vec<_>>().join("、"),
        );
        let title = format!("逆向分析：{}（{} × {}）", crate::ui::trunc(question, 24), crate::ui::label(crate::ui::AI_PLATFORM, plat), results.len());
        return Ok(insert_report(conn, pid, 4, &title, &content, "[]"));
    }
    if rtype == 6 {
        let content = reputation_report(conn, pid, task_id_a)?;
        let title = format!("口碑监测摘要：{}", brand);
        return Ok(insert_report(conn, pid, 6, &title, &content, &json!(if task_id_a.is_empty() { Vec::<String>::new() } else { vec![task_id_a.to_string()] }).to_string()));
    }
    if rtype == 5 {
        // 一页纸诊断：抽 2 个品牌认知问题实测
        let samples: Vec<String> = {
            let mut stmt = match conn.prepare("SELECT text FROM questions WHERE projectId=? AND withBrand=1 LIMIT 2") {
                Ok(s) => s,
                Err(_) => return Err("没有品牌认知问题可抽样，请先建立问题库".to_string()),
            };
            let rs = stmt.query_map([pid], |r| r.get::<_, String>(0));
            rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
        };
        if samples.is_empty() {
            return Err("没有品牌认知问题可抽样，请先建立问题库".to_string());
        }
        let plat = if platform == 0 { 1 } else { platform };
        let mocks: Vec<MonitorMock> = samples.iter().map(|q| run_monitor(conn, &p, q, plat, 77)).collect();
        let mentioned = mocks.iter().filter(|m| m.brand_mentioned == 1).count();
        let inaccurate = mocks.iter().filter(|m| m.brand_mentioned == 1 && m.brand_accurate == Some(0)).count();
        let mut comps: Vec<String> = Vec::new();
        for m in &mocks {
            if let Some(arr) = m.competitors.as_array() {
                for c in arr {
                    if let Some(n) = c["name"].as_str() {
                        if !comps.contains(&n.to_string()) {
                            comps.push(n.to_string());
                        }
                    }
                }
            }
        }
        let content = format!(
            "{brand} · AI 现状一页纸诊断（日期：{today}）\n1. 抽样实测：{plat} + {n} 个核心问题抽样\n2. 现状诊断：\n   - 探索层表现：{entered}、当前排位：{pos}\n   - 评估层表现：AI 描述{desc}\n   - 行动层表现：预约/官网通路{path}\n3. 竞品差距：{comps} —— 竞品在 AI 中的优势表现：第三方测评与榜单内容覆盖更全\n4. 最扎眼的问题：{eye}\n5. 预设 3 个开场首问：\n   - 认知水位问：您平时问 AI「{q1}」这类问题时，期望看到什么？\n   - 获客成本问：目前主要获客渠道及单客获取成本是多少？\n   - 决策流程问：这类项目内部的决策流程与大致预算区间如何？\n6. 下一步推进建议：{next}（一句话明确首期重点）",
            brand = brand,
            today = &now()[..10],
            plat = crate::ui::label(crate::ui::AI_PLATFORM, plat),
            n = mocks.len(),
            entered = if mocks.iter().any(|m| m.brand_mentioned == 1) { "已进入推荐名单" } else { "未进入推荐名单" },
            pos = mocks.first().map(|m| m.mention_position.clone()).unwrap_or_else(|| "未出现".into()),
            desc = if mentioned > 0 { if inaccurate > 0 { format!("存在不准确（{} 次）", inaccurate) } else { "准确".to_string() } } else { "暂无描述".to_string() },
            path = if mocks.iter().any(|m| m.citations.as_array().map(|a| a.iter().any(|c| c["own"].as_bool() == Some(true))).unwrap_or(false)) { "有内容承接" } else { "暂未打通" },
            comps = if comps.is_empty() { "无".to_string() } else { comps.join("、") },
            eye = if inaccurate > 0 { "AI 对品牌核心卖点描述不准确" } else if mentioned == 0 { "AI 尚未认识品牌，推荐名单中完全缺席" } else { "我方正式链接未被 AI 引用" },
            q1 = samples[0],
            next = if mentioned == 0 { "先止血修错——补齐品牌事实信源，让 AI 认识并准确描述品牌" } else { "后铺设增量——铺设答案型内容争取精确收录" },
        );
        let title = format!("AI 现状一页纸诊断：{}", brand);
        return Ok(insert_report(conn, pid, 5, &title, &content, "[]"));
    }
    Err(format!("未知报告类型：{}", rtype))
}

fn insert_report(conn: &Connection, pid: &str, rtype: i64, title: &str, content: &str, related: &str) -> (String, String, String) {
    let rid = gen_id();
    conn.execute(
        "INSERT INTO reports (id, projectId, type, title, content, relatedTaskIds, createdAt) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![rid, pid, rtype, title, content, related, now()],
    )
    .ok();
    (rid, title.to_string(), content.to_string())
}

const NEGATIVE_WORDS: &[&str] = &["投诉", "差评", "维权", "退款", "跑路", "暴雷", "避坑", "骗", "风险", "违规", "翻车", "失效", "不推荐", "慎选"];

pub fn reputation_report(conn: &Connection, pid: &str, task_id: &str) -> Result<String, String> {
    let p = get_project(conn, pid).unwrap_or_default();
    let results: Vec<(i64, String, String)> = if !task_id.is_empty() {
        let mut stmt = conn
            .prepare("SELECT platform, answerText, citations FROM monitorResults WHERE taskId=?")
            .map_err(|_| "没有口碑监测结果：先在「口碑监测」页创建口碑任务".to_string())?;
        let rs = stmt.query_map([task_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    } else {
        let mut stmt = conn
            .prepare("SELECT r.platform, r.answerText, r.citations FROM monitorResults r JOIN questions qs ON r.questionId=qs.id WHERE r.projectId=? AND qs.source='口碑监测' ORDER BY r.ranAt DESC")
            .map_err(|_| "没有口碑监测结果：先在「口碑监测」页创建口碑任务".to_string())?;
        let rs = stmt.query_map([pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    };
    if results.is_empty() {
        return Err("没有口碑监测结果：先在「口碑监测」页创建口碑任务".to_string());
    }
    let mut freq: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut quotes: Vec<String> = Vec::new();
    let mut neg_count = 0;
    let mut cite_freq: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for (platform, text, citations_raw) in &results {
        let hits: Vec<&str> = NEGATIVE_WORDS.iter().copied().filter(|w| text.contains(w)).collect();
        for w in &hits {
            *freq.entry(w.to_string()).or_insert(0) += 1;
        }
        if !hits.is_empty() {
            neg_count += 1;
            if quotes.len() < 5 {
                // 按字符索引取摘录，避免 UTF-8 字节切片 panic
                let chars: Vec<char> = text.chars().collect();
                let char_idx = hits
                    .iter()
                    .filter_map(|w| text.find(w).map(|b| text[..b].chars().count()))
                    .min()
                    .unwrap_or(0);
                let start = char_idx.saturating_sub(30);
                let end = (char_idx + 50).min(chars.len());
                let quote: String = chars[start..end].iter().collect();
                let quote = quote.split_whitespace().collect::<Vec<_>>().join(" ");
                quotes.push(format!("[{}] …{}…", crate::ui::label(crate::ui::AI_PLATFORM, *platform), quote));
            }
        }
        let cites: Vec<Value> = serde_json::from_str(citations_raw).unwrap_or_default();
        for c in cites {
            if let Some(u) = c["url"].as_str() {
                *cite_freq.entry(u.to_string()).or_insert(0) += 1;
            }
        }
    }
    let mut top_cite: Vec<(&String, &usize)> = cite_freq.iter().collect();
    top_cite.sort_by(|a, b| b.1.cmp(a.1));
    let top_cite: Vec<_> = top_cite.into_iter().take(5).collect();
    let mut freq_rows: Vec<String> = freq.iter().map(|(k, v)| format!("| {} | {} |", k, v)).collect();
    if freq_rows.is_empty() {
        freq_rows.push("| （未检出） | 0 |".to_string());
    }
    Ok(format!(
        "# 口碑监测摘要 —— {brand}\n\n**监测样本：** {n} 条口碑类问题回答\n**含负面信号：** {neg} 条（{pct}%）\n\n## 负面信号词频次\n| 词 | 次数 |\n|---|---|\n{freq}\n\n## 负面语境摘录（人工复核用）\n{quotes}\n\n## 被引用最多的来源（可信度参考）\n{cites}\n\n## 下一步\n{next}",
        brand = if p.brand_name.is_empty() { &p.name } else { &p.brand_name },
        n = results.len(),
        neg = neg_count,
        pct = if results.is_empty() { 0 } else { neg_count * 100 / results.len() },
        freq = freq_rows.join("\n"),
        quotes = if quotes.is_empty() { "- 未检出负面语境".to_string() } else { quotes.iter().map(|q| format!("- {}", q)).collect::<Vec<_>>().join("\n") },
        cites = if top_cite.is_empty() { "- 无".to_string() } else { top_cite.iter().map(|(u, c)| format!("- {}（{} 次）", u, c)).collect::<Vec<_>>().join("\n") },
        next = if neg_count > 0 {
            "1. 对每条负面语境人工核实（截图留证）；2. 若属实→知识库补正面证据+客服话术；3. 若不实→准备澄清内容发布到同一批信源；4. 第 3/7/14 天复测负面占比。"
        } else {
            "未检出负面信号：保持周期复测（3/7/14 天），关注新增差评。"
        }
    ))
}

// 口碑监测（8 个口碑问题 + 监测任务）
pub fn create_reputation_monitor(conn: &Connection, pid: &str, platforms: Vec<i64>, mode: i64) -> Result<(usize, String), String> {
    let p = get_project(conn, pid).ok_or("项目不存在")?;
    let brand = if p.brand_name.is_empty() { "该品牌" } else { &p.brand_name };
    let templates = [
        format!("{}靠谱吗？有没有什么负面评价？", brand),
        format!("{}有没有投诉或维权的情况？", brand),
        format!("{}的差评主要集中在哪些方面？", brand),
        format!("{}售后服务怎么样，退款难不难？", brand),
        format!("{}有没有跑路、暴雷或者经营异常的传闻？", brand),
        format!("家长圈里对{}的真实口碑如何？", brand),
        format!("{}和同类产品比，用户流失的主要原因是什么？", brand),
        format!("选择{}之前需要注意哪些风险？", brand),
    ];
    let mut added = 0;
    for t in &templates {
        if add_question(conn, pid, t, 6, 2, 1, "口碑监测", "") {
            added += 1;
        }
    }
    let qids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM questions WHERE projectId=? AND source='口碑监测'").map_err(|e| e.to_string())?;
        let rs = stmt.query_map([pid], |r| r.get::<_, String>(0));
        rs.map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    };
    if qids.is_empty() {
        return Err("口碑问题创建失败".to_string());
    }
    let tid = create_monitor_task(
        conn,
        pid,
        &CreateMonitorInput {
            question_ids: qids,
            platforms,
            mode,
            schedule_days: if mode == 2 { vec![3, 7, 14] } else { vec![] },
        },
    )?;
    Ok((added, tid))
}

// ============ 卡密 ============
#[allow(dead_code)]
pub struct Plan {
    pub code: &'static str,
    pub name: &'static str,
    pub duration_days: i64,
    pub monitor_quota_monthly: i64,
    pub max_members: i64,
}
pub const PLANS: &[Plan] = &[
    Plan { code: "trial", name: "体验版", duration_days: 7, monitor_quota_monthly: 50, max_members: 2 },
    Plan { code: "basic", name: "基础版", duration_days: 30, monitor_quota_monthly: 500, max_members: 3 },
    Plan { code: "pro", name: "专业版", duration_days: 30, monitor_quota_monthly: 2000, max_members: 10 },
];

pub fn plan_by_code(code: &str) -> Option<&'static Plan> {
    PLANS.iter().find(|p| p.code == code)
}

pub fn generate_license_keys(conn: &Connection, plan_code: &str, count: i64, note: &str) -> Result<Vec<String>, String> {
    let plan = plan_by_code(plan_code).ok_or_else(|| format!("未知套餐：{}", plan_code))?;
    let n = count.clamp(1, 100);
    let mut keys = Vec::new();
    for _ in 0..n {
        let key = format!(
            "GEO-{}-{}-{}-{}",
            plan.code.to_uppercase(),
            auth::random_hex(2).to_uppercase(),
            auth::random_hex(2).to_uppercase(),
            auth::random_hex(2).to_uppercase()
        );
        conn.execute(
            "INSERT INTO licenseKeys (key, planCode, status, note, createdAt) VALUES (?,?,'unused',?,?)",
            rusqlite::params![key, plan.code, note, now()],
        )
        .ok();
        keys.push(key);
    }
    Ok(keys)
}

pub fn redeem_license_key(conn: &Connection, org_id: &str, key: &str) -> Result<(String, String), String> {
    let k = key.trim().to_uppercase();
    let (status, plan_code): (String, String) = conn
        .query_row("SELECT status, planCode FROM licenseKeys WHERE key=?", [&k], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "卡密不存在".to_string())?;
    if status == "used" {
        return Err("卡密已被使用".to_string());
    }
    if status == "revoked" {
        return Err("卡密已作废".to_string());
    }
    let plan = plan_by_code(&plan_code).ok_or("套餐配置异常")?;
    let expires = auth::add_days_iso(plan.duration_days);
    conn.execute("UPDATE orgs SET planCode=?, planExpiresAt=?, quotaMonitorMonthly=? WHERE id=?",
        rusqlite::params![plan.code, expires, plan.monitor_quota_monthly, org_id],
    )
    .ok();
    conn.execute("UPDATE licenseKeys SET status='used', usedByOrg=?, usedAt=? WHERE key=?", rusqlite::params![org_id, now(), k]).ok();
    // 注意：不能在这里调用 web::audit_log——它内部再取 DB 锁会在 with_db 闭包内死锁，
    // 审计由调用方在 with_db 之外写入。
    Ok((plan.name.to_string(), expires))
}

// ============ Open Key ============
pub fn create_open_key(conn: &Connection, user_id: &str, name: &str, project_ids: &[String]) -> String {
    let key = format!("gk-{}", auth::random_hex(24));
    conn.execute(
        "INSERT INTO openKeys (id, userId, name, keyPrefix, keyHash, authorizedProjectIds, createdAt) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![gen_id(), user_id, if name.is_empty() { "默认密钥" } else { name }, crate::ui::trunc(&key, 11).trim_end_matches('…'), auth::sha256(&key), json!(project_ids).to_string(), now()],
    )
    .ok();
    key
}

pub fn revoke_open_key(conn: &Connection, user_id: &str, key_id: &str) -> Result<(), String> {
    let n = conn
        .execute("UPDATE openKeys SET revokedAt=? WHERE id=? AND userId=?", rusqlite::params![now(), key_id, user_id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("密钥不存在".to_string());
    }
    Ok(())
}

// ============ 一键 GEO（确定性全链路） ============
pub struct AutoGeoResult {
    pub project_id: String,
    pub product_name: String,
    pub one_line: String,
    pub business: String,
    pub selling_points: String,
    pub keywords: String,
    pub knowledge_docs: usize,
    pub question_count: usize,
    pub article_title: String,
    pub audit_verdict: Option<i64>,
    pub monitor_task_id: Option<String>,
    pub next_steps: Vec<String>,
}

pub fn auto_geo(conn: &Connection, user_id: &str, raw: &str) -> Result<AutoGeoResult, String> {
    if raw.trim().chars().count() < 50 {
        return Err("项目文档太短（至少 50 字）".to_string());
    }
    // 1. 从文档提取产品信息（确定性规则）
    let first_line = raw.lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("未命名产品");
    let clean: String = first_line.trim_start_matches('#').trim().to_string();
    let product_name = crate::ui::trunc_clean(&clean, 24);
    let product_name = if product_name.is_empty() { "未命名产品".to_string() } else { product_name };
    let brand_name = product_name.clone();
    let one_line = crate::ui::trunc_clean(raw, 60);
    let business = crate::ui::trunc_clean(raw, 100);
    // 关键词：取前 3 个最频繁的 2+ 字中文词
    let mut freq: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for t in tokenize(&crate::ui::trunc(raw, 2000)) {
        if t.chars().count() >= 2 {
            *freq.entry(t).or_insert(0) += 1;
        }
    }
    let mut kw: Vec<(String, usize)> = freq.into_iter().collect();
    kw.sort_by(|a, b| b.1.cmp(&a.1));
    let keywords = kw.iter().take(3).map(|(k, _)| k.clone()).collect::<Vec<_>>().join(",");
    let selling_points = "详见知识库六模块（自动整理）";

    // 2. 建组织 + 公司 + 项目 + 知识库
    let org_id = gen_id();
    conn.execute(
        "INSERT INTO orgs (id, name, ownerUserId, quotaMonitorMonthly, createdAt) VALUES (?,?,?,0,?)",
        rusqlite::params![org_id, format!("{} 的团队", product_name), user_id, now()],
    )
    .ok();
    conn.execute(
        "INSERT INTO orgMembers (id, orgId, userId, role, createdAt) VALUES (?,?,?,?,?)",
        rusqlite::params![gen_id(), org_id, user_id, "owner", now()],
    )
    .ok();
    let company_id = gen_id();
    conn.execute(
        "INSERT INTO companies (id, ownerUserId, orgId, name, industry, intro, createdAt) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![company_id, user_id, org_id, format!("{}（一键GEO）", product_name), "自动导入", one_line, now()],
    )
    .ok();
    let pid = gen_id();
    conn.execute(
        "INSERT INTO projects (id, companyId, name, brandName, productName, region, business, sellingPoints, keywords, defaultPlatforms, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![pid, company_id, format!("{}-GEO优化", product_name), brand_name, product_name, "全国", business, selling_points, keywords, "[1,2,3,4]", now()],
    )
    .ok();
    ensure_kbs(conn, &pid);

    // 3. 知识库整理
    organize_knowledge(conn, &pid, 1, &brand_name, raw);
    let knowledge_docs: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)",
            [&pid],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;

    // 4. 50 问
    let question_count = generate_questions_50(conn, &pid);

    // 5. 品牌文章 + 三道审核
    let qid: String = conn
        .query_row(
            "SELECT id FROM questions WHERE projectId=? AND text LIKE ? ORDER BY createdAt LIMIT 1",
            rusqlite::params![pid, format!("%{}%", brand_name)],
            |r| r.get(0),
        )
        .or_else(|_| conn.query_row("SELECT id FROM questions WHERE projectId=? ORDER BY createdAt LIMIT 1", [&pid], |r| r.get(0)))
        .map_err(|_| "问题生成失败".to_string())?;
    let (aid, article_title) = create_content(conn, &pid, &qid, 2)?;
    let audit = audit_article(conn, &aid, "一键 GEO").ok();

    // 6. 上榜监测
    let monitor_task_id = create_monitor_task(
        conn,
        &pid,
        &CreateMonitorInput {
            question_ids: vec![qid],
            platforms: vec![1],
            mode: 1,
            schedule_days: vec![],
        },
    )
    .ok();

    Ok(AutoGeoResult {
        project_id: pid,
        product_name,
        one_line,
        business,
        selling_points: selling_points.to_string(),
        keywords,
        knowledge_docs,
        question_count,
        article_title,
        audit_verdict: audit.map(|a| a.verdict),
        monitor_task_id,
        next_steps: vec![
            "进入项目查看知识库六模块，补充「待补充」事实".to_string(),
            "在问题库把主攻问题标为 P0".to_string(),
            "为更多问题生成内容，走完三道审核与发布闭环".to_string(),
            "第 3/7/14 天用同一问题复测".to_string(),
        ],
    })
}
