// geo CLI guide 文本：按需读取一份，不要一次全读。
export const GUIDES = {
  project: {
    title: 'GEO 项目（projects）',
    body: `所有知识库、问题、文章、素材、发布、监测都挂在项目下。
- 先 projects.list 拿到已授权项目，让用户选择；projectId 不确定时不要猜。
- 除 projects.list/create 外，所有能力都要显式传 projectId。
- projects.create 会自动就绪该项目的品牌/产品两个知识库。
- GEO 项目本身不提供删除能力（级联删除风险大），请到网页端操作。`,
  },
  question: {
    title: '搜索问题（questions）',
    body: `问题库分六类：品牌认知/产品推荐/对比选型/效果验证/行动转化/风险判断；
阶段：探索（不带品牌名）/评估（带品牌名）/行动（带品牌名）；优先级 P0-P3（0 最高）。
- questions.create 单条新增；questions.batchCreate 批量导入（返回 将新增/已存在跳过/重复跳过 计数）。
- questions.generate 触发方法论生成：mode=50 生成 50 问；mode=40 精简为标准 40 问结构（探索30/评估5/行动5）。
- questions.update 维护优先级与状态（1待监测 2监测中 3已上榜 4优化中）。
- 监测复测必须固定问题原文，不要每次更换问题。`,
  },
  article: {
    title: '文章（articles）',
    body: `文章类型：1=AI 答案卡（三形态：文章版/图片版/视频口播版）、2=品牌优化文章、3=产品推荐文章。
状态机（说给用户听用 Label）：0已生成 → 1已上传 → 2已创建发布任务 → 3已正式发布。
- articles.create 需要有效 questionId，会同时生成封面配图。
- 发布前必须先 articles.audit 三道审核：知识库一致性 / 媒体投稿标准 / GEO 相关性与可信度；
  任何一道不通过都不应直接进入重点投放。
- articles.delete 唯一不可逆：摘要里的连带影响必须原样念给用户，等他明确说删。
- preflight.check 是创作前输入检查（已具备/待补充/不可使用）。`,
  },
  knowledge: {
    title: '知识库（knowledge）',
    body: `每个项目有两个知识库：type=1 品牌、type=2 产品。
品牌知识库按六模块组织：01_定位与业务边界 / 02_产品与服务事实 / 03_客户与使用场景 /
04_优势与竞品差异（内部）/ 05_案例与结果 / 06_权威背书与外部证据。
- knowledge.uploadDoc 上传单篇文档（title/content/module/evidence/pending）。
- knowledge.organize 按《品牌知识库标准化整理》提示词整理原始资料：生成六模块文档 +
  品牌高频 Q&A 索引 + 口径冲突清单；没有资料支持的模块统一标注【待补充：需业务部门提供】。
- 整理铁律：严禁编造参数、资质或数字；数据冲突单独列出口径冲突清单。`,
  },
  material: {
    title: '素材（materials）',
    body: `图片/视频/答案卡图组统一在素材库，上传后取得 URL。
- materials.upload 传 name + dataBase64（base64 内容）或直接给 url。
- 文章封面会在 articles.create 时自动生成（mock SVG）。
- 抖音答案卡图片需要学员按平台要求手动发布到抖音图文，不走自动发布。`,
  },
  'question-task': {
    title: '问题生成任务（questions.generate）',
    body: `按方法论提示词生成消费者选购问题：
- mode=50：六组结构（综合5/场景9/人群9/痛点9/功能9/决策9），每条含「哪家好/推荐/怎么选/排行」，
  严禁出现品牌名，口语化 10-25 字。
- mode=40：精简为标准 40 问（探索30 严禁品牌名 / 评估5 必须品牌名 / 行动5 必须品牌名），
  输出 Markdown 表格（编号/问题内容/分类/意图维度/核心关键词）。
apply 成功后问题直接进入问题库（返回 将新增/已存在跳过/重复跳过 计数）。`,
  },
  'article-task': {
    title: '内容创作任务（articles.create）',
    body: `articles.create = 基于问题 + 知识库创作内容：
- type=1 AI 答案卡：结论先行 → 判断标准 → 推荐理由 → 适用边界 → 下一步行动；
  输出文章版正文/图片版文案/视频口播版脚本三形态；只能使用知识库中已确认的事实和证据。
- type=2 品牌优化文章：先回答用户问题，再用真实事实、案例和边界支撑结论；
  输出标题/正文/证据清单/引用链接/待审核事实。
- type=3 产品推荐文章：先帮助用户做选择，再说明我方产品为什么符合，不要写成产品广告；
  必须包含选择标准、适用条件、证据、边界和行动入口。
创作前建议先 preflight.check。内容生成后必须三道审核。`,
  },
  'scheduled-monitor': {
    title: '上榜监测任务（monitorTasks）',
    body: `固定问题版本、AI 平台、提问时间和监测周期。
- monitorTasks.create：questionIds + platforms（1豆包 2DeepSeek 3元宝 4通义千问）+ mode
  （1一次性 / 2周期复测 scheduleDays=[3,7,14]）。第 0 天立即执行。
- 任务类 apply 成功 ≠ 事情做完：结果里的 checkpoint 状态才是执行情况；不要因为查不到就再建一个。
- monitorTasks.runNext 执行下一个到期检查点（第 3/7/14 天复测）。
- 复测必须同问题、同平台、相近条件；区分一次回答和多次稳定结果。`,
  },
  'indexing-query': {
    title: '监测结果与即时查询（monitorResults）',
    body: `monitorResults.list 返回每次监测的完整记录：
- answerText：AI 回答全文
- brandMentioned / mentionPosition / brandAccurate：品牌是否出现、位置、描述是否准确
- recommendLevel：3优先推荐 2明确推荐 1提及 0未出现
- competitors：竞品及推荐理由
- citations：引用来源（title/url/domain/own）；exactUrlHit=1 表示我方正式链接被引用
- hitStatus：3精准命中 / 2弱命中（标题或账号提及） / 1未命中 / 0待复测
判断口径：articleId ≠ 已发布；publishedUrl ≠ AI 已看见；弱命中 ≠ 精确收录；
exact_url_hit 才是「URL 被 AI 引用/检索到」的证据；stable 需跨批次持续出现。
monitorResults.reverse：同题同平台重复提问 N 次（默认 10），生成逆向分析报告。`,
  },
  publication: {
    title: '发布与投稿（publishTasks / accounts）',
    body: `发布任务是异步的：
1. publishTasks.create → 状态「已创建」（此时平台已生成发布包，但未发布）；
2. 人工确认预览、账号、素材、链接 → publishTasks.confirm → 状态「发布中」；
3. 稍后 publishTasks.get 回查 publishedUrl / failReason。
- 创建任务成功只代表平台接受任务，不代表已发布；不要重复创建。
- accounts.list 查询授权账号（mock 授权）。
- 抖音答案卡图片按平台要求手动发布，不自动发布。
- 发布失败：检查账号、额度、素材、链接和发布范围，再走 geo-troubleshooter。`,
  },
  sources: {
    title: '信源资产（sources）',
    body: `从监测结果沉淀引用源资产库，按问题和 AI 平台分别记录，不能合并成一张媒体名单。
- sources.collect：从监测任务提取真实引用来源（citations），自动四状态归类：
  我方正式链接被引用 → 已引用信源；竞品/第三方 → 观察信源。
- sources.upsert：手工新增/更新（14 字段：问题/AI平台/标题/URL/平台/主体/账号类型/
  证据类型/引用次数/品牌表现/竞品关联/可控性/页面状态/下一步动作）。
- 四状态：已引用信源 / 潜在信源 / 可投放信源 / 观察信源。
- 推荐发布平台时必须说明「问题、证据类型、平台、发布主体」的对应关系；
  不使用通用平台清单，只用真实引用来源。`,
  },
  report: {
    title: '报告（reports）',
    body: `reports.create 的 type：
- 1 品牌诊断：AI 是否认识品牌、如何描述、为什么不推荐、竞品为何占位、最重要的病根
- 2 产品推荐诊断：AI 是否推荐产品、推荐了谁、依据是什么
- 3 优化前后对比：需要 taskIdA（优化前）+ taskIdB（优化后），同题同平台才可比
- 4 逆向分析：question + platform + times（默认10），同题重复提问 + 关键词频次
- 5 AI 现状一页纸诊断：抽样实测 + 现状 + 竞品差距 + 最扎眼问题 + 3 个开场首问
报告必须区分事实、推断和待验证信息；没有监测结果时先建监测任务，不要凭想象诊断。`,
  },
};

export function guideList() {
  return Object.entries(GUIDES).map(([name, g]) => ({ name, title: g.title }));
}
