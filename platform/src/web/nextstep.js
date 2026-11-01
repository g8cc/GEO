// 新手引导：根据用户数据状态计算「当前建议下一步」。
// nextStepFromCounts 是纯函数（便于测试）；gatherNextStep 负责取数。
import { q1, q } from '../db.js';

export function nextStepFromCounts(c) {
  if (!c.companies) {
    return { step: 1, title: '创建公司', desc: '一切从公司开始——它决定项目和数据的归属', href: '/companies' };
  }
  if (!c.projects) {
    return { step: 2, title: '创建 GEO 项目', desc: '认真填品牌名、产品名、主营业务与卖点，它们决定内容生成质量', href: '/projects' };
  }
  if (!c.kbDocs) {
    return { step: 3, title: '整理知识库', desc: '粘贴原始资料一键生成品牌知识库六模块（AI 只能用库里已确认的事实写作）', href: `/projects/${c.projectId}/kb` };
  }
  if (!c.questions) {
    return { step: 4, title: '生成搜索问题', desc: '一键生成 50 问，再精简为标准 40 问（探索30/评估5/行动5）', href: `/projects/${c.projectId}/questions` };
  }
  if (!c.articles) {
    return { step: 5, title: '创作第一篇内容', desc: '选一个问题，生成 AI 答案卡 / 品牌优化文章 / 产品推荐文章', href: `/projects/${c.projectId}/content` };
  }
  if (!c.audited) {
    return { step: 6, title: '完成三道审核', desc: '知识库一致性 / 媒体投稿标准 / GEO 可信度——任何一道不通过都不能发布', href: `/projects/${c.projectId}/articles` };
  }
  if (!c.accounts) {
    return { step: 7, title: '添加授权账号', desc: '登记发布渠道的账号（平台、账号名、类型、额度）', href: `/projects/${c.projectId}/accounts` };
  }
  if (!c.publishTasks) {
    return { step: 8, title: '创建发布任务', desc: '生成发布包（七字段）→ 确认 → 发布；或手动发布后回填真实链接', href: `/projects/${c.projectId}/publish` };
  }
  if (!c.published) {
    return { step: 9, title: '回查正式链接', desc: '发布是异步的：出现 publishedUrl（或手动回填）才算已发布', href: `/projects/${c.projectId}/publish` };
  }
  if (!c.monitors) {
    return { step: 10, title: '创建上榜监测', desc: '用同一个问题监测 AI：品牌出现了吗？引用我方链接了吗？', href: `/projects/${c.projectId}/monitor` };
  }
  if (!c.sourceAssets) {
    return { step: 11, title: '沉淀信源资产', desc: '把监测引用来源归入四状态：已引用/潜在/可投放/观察', href: `/projects/${c.projectId}/sources` };
  }
  if (!c.reports) {
    return { step: 12, title: '生成诊断报告', desc: '品牌诊断 / 一页纸诊断 / 优化前后对比 / 逆向分析', href: `/projects/${c.projectId}/reports` };
  }
  return {
    step: 13,
    title: '进入持续运营循环',
    desc: '每轮只做一个优化动作，第 3/7/14 天用同一个问题复测，看趋势',
    href: `/projects/${c.projectId}/monitor`,
  };
}

export function gatherNextStep(userId, explicitProjectId) {
  const projects = q(
    `SELECT p.id FROM projects p JOIN companies c ON p.companyId=c.id WHERE c.ownerUserId=? ORDER BY p.createdAt DESC`,
    userId
  );
  const companies = q1('SELECT COUNT(*) as n FROM companies WHERE ownerUserId=?', userId).n;
  const projectId = explicitProjectId || projects[0]?.id;
  const base = { companies: companies > 0, projects: projects.length > 0, projectId };
  if (!projectId) return nextStepFromCounts(base);
  const n = (sql, ...p) => q1(sql, ...p).n;
  return nextStepFromCounts({
    ...base,
    kbDocs: n('SELECT COUNT(*) as n FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)', projectId) > 0,
    questions: n('SELECT COUNT(*) as n FROM questions WHERE projectId=?', projectId) > 0,
    articles: n('SELECT COUNT(*) as n FROM articles WHERE projectId=?', projectId) > 0,
    audited: n('SELECT COUNT(*) as n FROM auditRecords ar JOIN articles a ON ar.articleId=a.id WHERE a.projectId=? AND ar.verdict=2', projectId) > 0,
    accounts: n('SELECT COUNT(*) as n FROM publishAccounts WHERE projectId=?', projectId) > 0,
    publishTasks: n('SELECT COUNT(*) as n FROM publishTasks WHERE projectId=?', projectId) > 0,
    published: n('SELECT COUNT(*) as n FROM publishTasks WHERE projectId=? AND status=3 AND publishedUrl IS NOT NULL', projectId) > 0,
    monitors: n('SELECT COUNT(*) as n FROM monitorTasks WHERE projectId=?', projectId) > 0,
    sourceAssets: n('SELECT COUNT(*) as n FROM sourceAssets WHERE projectId=?', projectId) > 0,
    reports: n('SELECT COUNT(*) as n FROM reports WHERE projectId=?', projectId) > 0,
  });
}


// —— 聚光灯引导步骤：按用户数据状态动态生成（已完成站点标 ✓）——
export function gatherTourCounts(userId, explicitProjectId) {
  const projects = q(
    `SELECT p.id FROM projects p JOIN companies c ON p.companyId=c.id WHERE c.ownerUserId=? ORDER BY p.createdAt DESC`,
    userId
  );
  const projectId = explicitProjectId || projects[0]?.id;
  const c = {
    companies: q1('SELECT COUNT(*) as n FROM companies WHERE ownerUserId=?', userId).n > 0,
    projects: projects.length > 0,
    projectId,
    openKeys: q1('SELECT COUNT(*) as n FROM openKeys WHERE userId=? AND revokedAt IS NULL', userId).n > 0,
  };
  if (!projectId) return c;
  const n = (sql, ...p) => q1(sql, ...p).n;
  c.kbDocs = n('SELECT COUNT(*) as n FROM kbDocuments WHERE kbId IN (SELECT id FROM knowledgeBases WHERE projectId=?)', projectId) > 0;
  c.questions = n('SELECT COUNT(*) as n FROM questions WHERE projectId=?', projectId) > 0;
  c.articles = n('SELECT COUNT(*) as n FROM articles WHERE projectId=?', projectId) > 0;
  c.audited = n('SELECT COUNT(*) as n FROM auditRecords ar JOIN articles a ON ar.articleId=a.id WHERE a.projectId=? AND ar.verdict=2', projectId) > 0;
  c.accounts = n('SELECT COUNT(*) as n FROM publishAccounts WHERE projectId=?', projectId) > 0;
  c.published = n('SELECT COUNT(*) as n FROM publishTasks WHERE projectId=? AND status=3 AND publishedUrl IS NOT NULL', projectId) > 0;
  c.monitors = n('SELECT COUNT(*) as n FROM monitorTasks WHERE projectId=?', projectId) > 0;
  c.sourceAssets = n('SELECT COUNT(*) as n FROM sourceAssets WHERE projectId=?', projectId) > 0;
  c.reports = n('SELECT COUNT(*) as n FROM reports WHERE projectId=?', projectId) > 0;
  return c;
}

export function buildTourSteps(c) {
  const steps = [];
  const mark = (done, name) => (done ? '✓ 已完成 · ' : '') + name;
  const S = (sel, title, desc, href, cta) => steps.push({ sel, title, desc, href, cta });

  S('a.nav[href="/dashboard"]', '欢迎 👋 这是你的 GEO 控制台',
    '十步工作台在这里：迷路了随时回这里，每一步完成会自动打勾。下面用 1 分钟带你认全所有入口。');
  S('a.nav[href="/companies"]', mark(c.companies, '① 公司管理'),
    c.companies ? '公司已创建。多客户/多品牌时在这里区分归属。' : '从这里开始：填公司名称、行业、简介——它决定项目与数据的归属。');
  S('a.nav[href="/projects"]', mark(c.projects, '② GEO 项目'),
    c.projects ? '项目已创建。认真填品牌名/产品名/卖点，它们决定内容生成质量。' : '创建项目时认真填品牌名、产品名、主营业务与核心卖点——AI 写作全靠它们。');
  if (c.projectId) {
    S('a.nav[href$="/kb"]', mark(c.kbDocs, '③ 知识库（事实唯一来源）'),
      c.kbDocs ? '六模块知识库已就绪。记得随时补「待补充」项、处理口径冲突。' : '把原始资料粘贴进「知识库整理」，自动生成六模块；AI 只能用库里已确认的事实，绝不编造。');
    S('a.nav[href$="/questions"]', mark(c.questions, '④ 问题拓展 / 搜索问题库'),
      c.questions ? '问题池已建立。用优先级列标记主攻问题（P0 最高）。' : '一键生成 50 个消费者真实会问 AI 的问题，再精简为标准 40 问（探索30/评估5/行动5）。');
    S('a.nav[href$="/content"]', mark(c.articles, '⑤ 内容创作'),
      c.articles ? '内容已生成。下一步是三道审核。' : '选一个问题生成三类资产：AI 答案卡 / 品牌优化文章 / 产品推荐文章（含封面）。');
    S('a.nav[href$="/articles"]', mark(c.audited, '⑥ 三道审核'),
      c.audited ? '审核已通过 ✅ 可以进入发布。' : '知识库一致性 / 媒体投稿标准 / GEO 可信度——任何一道不通过都不能发布；点进文章执行审核。');
    S('a.nav[href$="/accounts"]', mark(c.accounts, '⑦ 授权账号'),
      c.accounts ? '账号已就绪。' : '登记发布渠道账号（平台/名称/类型/额度），发布需要账号。');
    S('a.nav[href$="/publish"]', mark(c.published, '⑧ 发布与回填'),
      c.published ? '已有正式链接。真实渠道手动发布后记得「手动发布回填」真实 URL。' : '生成发布包（七字段）→ 确认发布；渠道没有 API 时手动发布后回填真实链接。');
    S('a.nav[href$="/monitor"]', mark(c.monitors, '⑨ 上榜监测（核心价值）'),
      c.monitors ? '监测已建立：用同一个问题在第 3/7/14 天复测看趋势。' : '用同一个问题监测 AI：品牌出现了吗？引用我方链接了吗？创建后立即执行首轮。');
    S('a.nav[href$="/sources"]', mark(c.sourceAssets, '⑩ 信源资产'),
      c.sourceAssets ? '信源库已建立，注意维护四状态与下一步动作。' : '把监测引用来源归入四状态：已引用 / 潜在 / 可投放 / 观察。');
    S('a.nav[href$="/reports"]', mark(c.reports, '⑪ 诊断报告'),
      c.reports ? '报告已生成，用于复盘与客户沟通。' : '品牌诊断 / 一页纸诊断 / 优化前后对比 / 逆向分析——复盘和商务拜访直接可用。');
  } else {
    S('a.nav[href="/projects"]', '提示：还没有 GEO 项目', '先完成 ② 创建项目和 ③ 知识库，右侧菜单会自动展开后续功能。', '/projects', '去创建项目');
  }
  S('a.nav[href="/settings/keys"]', mark(c.openKeys, '⑫ Open Key（让 AI 帮你操作）',
    c.openKeys ? '密钥已创建。在 AI 工具里执行 geo auth login 即可让 AI 驱动平台。' : '在 Codex / Claude Code 里用一句话让 AI 干活的前提：创建密钥并在本机录入（geo auth login）。写操作永远先给你确认摘要。'),
    '/settings/keys', '去创建密钥');
  return steps;
}


// ═════════ 任务式快速上手（最小闭环 6 步）═════════
// 每个任务 = 一个真实动作；完成与否以数据为准（不靠点击记录）
export function buildMissions(c) {
  const missions = [
    { key: 'company', title: '创建公司', desc: '1 分钟：填名称/行业/简介', href: '/companies', tour: 'companies', done: c.companies },
    { key: 'project', title: '创建 GEO 项目', desc: '填品牌名、产品名、主营业务与卖点——决定内容质量', href: '/projects', tour: 'projects', done: c.projects },
  ];
  if (c.projectId) {
    missions.push(
      { key: 'kb', title: '整理知识库', desc: '粘贴原始资料 → 自动生成品牌知识库六模块', href: `/projects/${c.projectId}/kb?tour=kb`, tour: 'kb', done: !!c.kbDocs },
      { key: 'questions', title: '生成问题池', desc: '一键 50 问 → 标准 40 问（探索30/评估5/行动5）', href: `/projects/${c.projectId}/questions?tour=questions`, tour: 'questions', done: !!c.questions },
      { key: 'content', title: '创作并审核第一篇内容', desc: '生成品牌文章 → 三道审核全部通过', href: `/projects/${c.projectId}/content?tour=content`, tour: 'content', done: !!c.audited },
      { key: 'publish', title: '发布并监测', desc: '发布包确认 → 正式链接 → 上榜监测看 AI 是否引用你', href: `/projects/${c.projectId}/publish?tour=publish`, tour: 'publish', done: !!(c.published && c.monitors) },
      { key: 'harvest', title: '沉淀与复盘', desc: '信源资产四状态 + 品牌诊断报告', href: `/projects/${c.projectId}/sources?tour=sources`, tour: 'sources', done: !!(c.sourceAssets && c.reports) },
    );
  } else {
    missions.push({
      key: 'project-hint', title: '提示：创建项目后展开后续 5 步', desc: '知识库/问题池/内容/发布/监测都挂在项目下', href: '/projects', tour: 'projects', done: false,
    });
  }
  const firstUndone = missions.find((m) => !m.done);
  missions.forEach((m) => { m.current = m === firstUndone; });
  return { missions, current: firstUndone || null, allDone: !firstUndone };
}

// ═════════ 页面微引导（?tour=<name> 触发，聚光灯指到具体表单控件）═════════
export const PAGE_TOURS = {
  companies: [
    { sel: 'input[name="name"]', title: '① 填公司名称', desc: '公司决定项目和数据的归属。行业与简介可选填。' },
    { sel: 'form[action="/companies/create"] button', title: '② 点「添加」', desc: '创建后回来，任务清单会自动打勾 ✓，然后进入第 2 步：创建 GEO 项目。' },
  ],
  projects: [
    { sel: 'select[name="companyId"]', title: '① 选择所属公司', desc: '刚创建的公司在这里选。' },
    { sel: 'input[name="brandName"]', title: '② 品牌名（重点）', desc: 'AI 监测和内容全靠它识别你的品牌，务必与对外名称完全一致。' },
    { sel: 'input[name="business"]', title: '③ 主营业务与目标人群', desc: '例：3-8 岁儿童客厅体感运动。越具体，50 问和内容越精准。' },
    { sel: 'input[name="sellingPoints"]', title: '④ 核心差异化卖点', desc: '例：无需穿戴设备 / 家长端实时生成体测报告。' },
    { sel: 'form[action="/projects/create"] button', title: '⑤ 点「添加」', desc: '创建后自动进入项目页，后续任务在左侧项目菜单里。' },
  ],
  kb: [
    { sel: 'textarea[name="raw"]', title: '① 粘贴原始资料', desc: '把公司/产品的介绍、价格、案例、资质整段贴进来——有什么贴什么，缺的会标「待补充」，绝不编造。' },
    { sel: 'form[action$="/kb/organize"] button', title: '② 点「开始整理」', desc: '系统按标准六模块（定位/产品/客户/差异/案例/背书）自动整理 + 生成 QA 索引和口径冲突清单。' },
    { sel: 'table thead', title: '③ 六模块清单', desc: '整理结果出现在这里。绿色「可用」即可支撑内容创作；「待补充」项找业务补资料。' },
  ],
  questions: [
    { sel: 'form[action$="questions/generate"]', title: '① 点「生成 50 问」', desc: '按消费者决策路径生成 50 个真实口语化问题（综合/场景/人群/痛点/功能/决策六组，全部不带品牌名）。' },
    { sel: 'form[action$="questions/generate"] ~ form, form[action$="questions/generate"]', title: '② 再点「精简为标准 40 问」', desc: '筛选为探索 30 / 评估 5 / 行动 5 的标准结构，输出可直接复制的表格。' },
    { sel: 'table thead', title: '③ 问题池就绪', desc: '用优先级列把主攻问题标为 P0。下一步：内容创作。' },
  ],
  content: [
    { sel: 'select[name="questionId"]', title: '① 选目标问题', desc: '建议先用品牌认知问题（带品牌名的那类）。可先点上方「创作前输入检查」看资料是否齐。' },
    { sel: 'select[name="type"]', title: '② 选内容类型', desc: 'AI 答案卡（抖音图文三形态）/ 品牌优化文章 / 产品推荐文章。第一篇建议选「品牌优化文章」。' },
    { sel: 'form[action$="/content/create"] button', title: '③ 点「生成内容 + 封面」', desc: '生成后自动跳到文章详情页——记得执行三道审核，全部通过才能发布。' },
  ],
  publish: [
    { sel: 'select[name="articleId"]', title: '① 选文章（需已过审）', desc: '只有三道审核全过的文章会出现在这里。' },
    { sel: 'select[name="accountId"]', title: '② 选账号与平台', desc: '没有账号？先到「授权账号」添加。' },
    { sel: 'form[action$="/publish/create"] button', title: '③ 生成发布包预览', desc: '七字段发布包确认后进入发布。渠道没有 API 时：手动发布后用「手动发布回填」登记真实链接。' },
  ],
  sources: [
    { sel: 'form[action$="/sources/collect"] button', title: '① 一键沉淀信源', desc: '把监测引用来源自动归类：我方被引用 → 已引用信源；竞品/第三方 → 观察信源。' },
    { sel: 'table thead', title: '② 信源四状态', desc: '已引用 / 潜在 / 可投放 / 观察——逐条维护「下一步动作」，这就是你的 GEO 资产库。' },
  ],
  monitor: [
    { sel: 'select[name="questionIds"]', title: '① 选问题（可多选）', desc: '固定问题原文！复测必须用同一个问题。' },
    { sel: 'select[name="platforms"]', title: '② 选 AI 平台', desc: '豆包 / DeepSeek / 元宝 / 通义。配了 Key 的平台走真实联网问答。' },
    { sel: 'form[action$="/monitor/create"] button', title: '③ 创建并执行首轮', desc: '第 0 天立即出结果：品牌出现？引用我方链接了吗？周期任务自动建 3/7/14 天复测点。' },
  ],
};
