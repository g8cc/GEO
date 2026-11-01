// 状态枚举与 Label 对照。
// 约定（与 geo CLI / Skills 一致）：数据库与 API 过滤使用数值；对用户展示一律使用 *Label 中文名。
// 同一个数值在不同对象上含义不同，禁止凭记忆翻译，必须经本表转换。

export const ARTICLE_STATUS = {
  0: '已生成',
  1: '已上传',
  2: '已创建发布任务',
  3: '已正式发布',
};

export const ARTICLE_TYPE = {
  1: 'AI 答案卡',
  2: '品牌优化文章',
  3: '产品推荐文章',
};

export const QUESTION_CATEGORY = {
  1: '品牌认知',
  2: '产品推荐',
  3: '对比选型',
  4: '效果验证',
  5: '行动转化',
  6: '风险判断',
};

export const QUESTION_STAGE = {
  1: '探索',
  2: '评估',
  3: '行动',
};

// P0-P3 优先级：0 最高
export const QUESTION_PRIORITY = {
  0: 'P0 最高',
  1: 'P1 高',
  2: 'P2 中',
  3: 'P3 低',
};

export const QUESTION_STATUS = {
  1: '待监测',
  2: '监测中',
  3: '已上榜',
  4: '优化中',
};

export const KB_TYPE = {
  1: '品牌知识库',
  2: '产品知识库',
};

// 品牌知识库六模块（文档二 1.5）
export const KB_MODULE = {
  1: '01_定位与业务边界',
  2: '02_产品与服务事实',
  3: '03_客户与使用场景',
  4: '04_优势与竞品差异',
  5: '05_案例与结果',
  6: '06_权威背书与外部证据',
};

export const PUBLISH_PLATFORM = {
  1: '今日头条',
  2: '搜狐',
  3: '网易',
  4: '抖音',
  5: '知乎',
  6: '小红书',
  7: '微信公众号',
  8: '什么值得买',
  9: '官网',
  10: '其他',
};

// 发布渠道 → 模拟正式链接域名
export const PUBLISH_DOMAIN = {
  1: 'mock.toutiao.com',
  2: 'mock.sohu.com',
  3: 'mock.163.com',
  4: 'mock.douyin.com',
  5: 'mock.zhihu.com',
  6: 'mock.xiaohongshu.com',
  7: 'mock.mp.weixin.qq.com',
  8: 'mock.smzdm.com',
  9: 'mock.ownsite.cn',
};

export const ACCOUNT_TYPE = {
  1: '官方机构号',
  2: '企业号',
  3: '个人自媒体',
  4: 'KOL或大V',
  5: '用户账号',
  6: '其他',
};

export const ACCOUNT_AUTH_STATUS = {
  0: '未授权',
  1: '已授权',
  2: '已过期',
};

export const PUBLISH_TASK_STATUS = {
  1: '已创建',
  2: '发布中',
  3: '已发布',
  4: '失败',
};

export const AI_PLATFORM = {
  1: '豆包',
  2: 'DeepSeek',
  3: '元宝',
  4: '通义千问',
  5: '其他',
};

export const MONITOR_MODE = {
  1: '一次性监测',
  2: '周期复测',
};

export const MONITOR_TASK_STATUS = {
  1: '排队',
  2: '运行中',
  3: '完成',
  4: '失败',
};

export const CHECKPOINT_STATUS = {
  1: '待执行',
  2: '已完成',
  3: '失败',
};

export const RECOMMEND_LEVEL = {
  0: '未出现',
  1: '提及',
  2: '明确推荐',
  3: '优先推荐',
};

// 监测状态（文档二 4.2）：精准命中 / 弱命中 / 未命中 / 待复测
export const HIT_STATUS = {
  0: '待复测',
  1: '未命中',
  2: '弱命中',
  3: '精准命中',
};

export const SOURCE_ASSET_STATUS = {
  1: '已引用信源',
  2: '潜在信源',
  3: '可投放信源',
  4: '观察信源',
};

export const SOURCE_CONTROLLABILITY = {
  1: '可控信源',
  2: '潜在信源',
  3: '不可控信源',
};

export const SOURCE_PAGE_STATUS = {
  1: '已上传',
  2: '已创建任务',
  3: '已正式发布',
  4: '已被 AI 引用',
  5: '失效',
};

export const EVIDENCE_TYPE = {
  1: '官方事实',
  2: '产品参数',
  3: '项目案例',
  4: '用户评价',
  5: '行业观点',
  6: '其他',
};

export const PUBLISHER_TYPE = {
  1: '国家级媒体',
  2: '省级媒体',
  3: '地方或公共机构',
  4: '商业媒体',
  5: '垂直行业媒体',
  6: 'B2B门户',
  7: '电商平台',
  8: '企业官网',
  9: '用户社区',
  10: '自媒体账号',
};

export const AUDIT_GATE = {
  2: '通过',
  1: '修改后通过',
  0: '不通过',
};

export const AUDIT_VERDICT = {
  2: '通过',
  1: '修改后通过',
  0: '不通过',
};

export const REPORT_TYPE = {
  1: '品牌诊断报告',
  2: '产品推荐诊断报告',
  3: '优化前后对比报告',
  4: '逆向分析报告',
  5: 'AI 现状一页纸诊断',
  6: '口碑监测摘要',
};

export const MATERIAL_TYPE = {
  1: '图片',
  2: '视频',
  3: '答案卡图组',
};

// —— Label 包装 ——
// 数值字段成对返回：status / statusLabel。过滤与程序判断用数值，展示用 Label。
// 注意：status / platform 是跨表歧义字段（同一个数字在不同对象上含义不同），
// 必须通过 withRowLabels(kind, row) 按行类型转换，禁止凭记忆翻译。
const LABEL_MAPS = {
  articleStatus: { map: ARTICLE_STATUS },
  type: { map: ARTICLE_TYPE },
  articleType: { map: ARTICLE_TYPE },
  category: { map: QUESTION_CATEGORY },
  stage: { map: QUESTION_STAGE },
  priority: { map: QUESTION_PRIORITY },
  questionStatus: { map: QUESTION_STATUS },
  kbType: { map: KB_TYPE },
  module: { map: KB_MODULE },
  publishPlatform: { map: PUBLISH_PLATFORM },
  accountType: { map: ACCOUNT_TYPE },
  authStatus: { map: ACCOUNT_AUTH_STATUS },
  publishStatus: { map: PUBLISH_TASK_STATUS },
  aiPlatform: { map: AI_PLATFORM },
  mode: { map: MONITOR_MODE },
  monitorStatus: { map: MONITOR_TASK_STATUS },
  checkpointStatus: { map: CHECKPOINT_STATUS },
  recommendLevel: { map: RECOMMEND_LEVEL },
  hitStatus: { map: HIT_STATUS },
  assetStatus: { map: SOURCE_ASSET_STATUS },
  controllability: { map: SOURCE_CONTROLLABILITY },
  pageStatus: { map: SOURCE_PAGE_STATUS },
  evidenceType: { map: EVIDENCE_TYPE },
  publisher: { map: PUBLISHER_TYPE },
  gate1: { map: AUDIT_GATE },
  gate2: { map: AUDIT_GATE },
  gate3: { map: AUDIT_GATE },
  verdict: { map: AUDIT_VERDICT },
  reportType: { map: REPORT_TYPE },
  materialType: { map: MATERIAL_TYPE },
};

// 歧义字段按行类型查表
const ROW_KIND_MAPS = {
  question: { status: QUESTION_STATUS },
  article: { status: ARTICLE_STATUS },
  publishTask: { status: PUBLISH_TASK_STATUS, platform: PUBLISH_PLATFORM },
  monitorTask: { status: MONITOR_TASK_STATUS },
  checkpoint: { status: CHECKPOINT_STATUS },
  account: { authStatus: ACCOUNT_AUTH_STATUS, platform: PUBLISH_PLATFORM },
  sourceAsset: { status: SOURCE_ASSET_STATUS },
  monitorResult: { platform: AI_PLATFORM },
};

function labelFor(mapName, value) {
  const conf = LABEL_MAPS[mapName];
  if (!conf) return undefined;
  const label = conf.map[value];
  return label === undefined ? '' : label; // 空串表示尚无值，照实说「还没有」，不要猜
}

// 对单行数据追加 *Label 字段
export function withLabels(row) {
  if (row === null || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map(withLabels);
  const out = { ...row };
  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'number' && LABEL_MAPS[field]) {
      out[`${field}Label`] = labelFor(field, value);
    }
  }
  return out;
}

export function label(mapName, value) {
  return labelFor(mapName, value);
}

// 按行类型补歧义字段的 Label，再补唯一命名字段的 Label
export function withRowLabels(kind, row) {
  if (Array.isArray(row)) return row.map((r) => withRowLabels(kind, r));
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  const kindMap = ROW_KIND_MAPS[kind];
  if (kindMap) {
    for (const [field, map] of Object.entries(kindMap)) {
      if (typeof out[field] === 'number') out[`${field}Label`] = map[out[field]] ?? '';
    }
  }
  return withLabels(out);
}
