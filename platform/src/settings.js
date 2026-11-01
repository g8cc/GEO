// 系统配置中心（v1.2）：
// - 所有真实化配置项集中在这里定义（CONFIG_SCHEMA 白名单，防止任意环境变量注入）
// - 存 SQLite settings 表；启动时与保存后应用到 process.env —— 全部 Provider 读 env 的代码无需改动
// - 语义：DB 有值 → 覆盖；DB 为空 → 回落部署环境变量/默认值
// - 安全：secret 字段界面脱敏展示（只显示前后几位），保存时空值=保持原值；仅 admin 可读写
import { q, q1, run } from './db.js';
import { nowIso } from './util.js';

export const CONFIG_SCHEMA = [
  // 内容生成 LLM
  { group: 'llm', key: 'LLM_BASE_URL', label: 'API 地址', type: 'url', placeholder: 'https://api.deepseek.com（OpenAI 兼容端点）' },
  { group: 'llm', key: 'LLM_API_KEY', label: 'API Key', type: 'secret', placeholder: 'sk-…' },
  { group: 'llm', key: 'LLM_MODEL', label: '模型', type: 'text', placeholder: 'deepseek-chat / glm-4.6 / qwen-plus …' },
  // AI 监测（四平台）
  { group: 'monitor', key: 'MONITOR_ARK_BASE', label: '豆包 · API 地址（火山方舟）', type: 'url', placeholder: 'https://ark.cn-beijing.volces.com/api/v3' },
  { group: 'monitor', key: 'MONITOR_ARK_MODEL', label: '豆包 · 模型', type: 'text', placeholder: '方舟接入点 ID 或模型名' },
  { group: 'monitor', key: 'MONITOR_ARK_KEY', label: '豆包 · API Key', type: 'secret', placeholder: '' },
  { group: 'monitor', key: 'MONITOR_DEEPSEEK_BASE', label: 'DeepSeek · API 地址', type: 'url', placeholder: 'https://api.deepseek.com' },
  { group: 'monitor', key: 'MONITOR_DEEPSEEK_MODEL', label: 'DeepSeek · 模型', type: 'text', placeholder: 'deepseek-chat' },
  { group: 'monitor', key: 'MONITOR_DEEPSEEK_KEY', label: 'DeepSeek · API Key', type: 'secret', placeholder: '' },
  { group: 'monitor', key: 'MONITOR_HUNYUAN_BASE', label: '元宝（混元）· API 地址', type: 'url', placeholder: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { group: 'monitor', key: 'MONITOR_HUNYUAN_MODEL', label: '元宝（混元）· 模型', type: 'text', placeholder: 'hunyuan-websearch-pro（建议联网模型）' },
  { group: 'monitor', key: 'MONITOR_HUNYUAN_KEY', label: '元宝（混元）· API Key', type: 'secret', placeholder: '' },
  { group: 'monitor', key: 'MONITOR_DASHSCOPE_BASE', label: '通义千问 · API 地址（百炼兼容模式）', type: 'url', placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { group: 'monitor', key: 'MONITOR_DASHSCOPE_MODEL', label: '通义千问 · 模型', type: 'text', placeholder: 'qwen-plus' },
  { group: 'monitor', key: 'MONITOR_DASHSCOPE_KEY', label: '通义千问 · API Key', type: 'secret', placeholder: '' },
  { group: 'monitor', key: 'MONITOR_MOCK', label: '演示回退（未配置平台的监测）', type: 'enum', options: [['1', '允许演示数据（默认）'], ['0', '严格模式：未配置平台显式报错']], boot: false, desc: '生产建议 0' },
  // 图像生成
  { group: 'image', key: 'IMAGE_PROVIDER', label: '图像服务商', type: 'enum', options: [['openai', 'OpenAI 兼容 images'], ['dashscope', '阿里云万相（异步任务）']] },
  { group: 'image', key: 'IMAGE_BASE_URL', label: 'API 地址', type: 'url', placeholder: 'https://dashscope.aliyuncs.com/api/v1' },
  { group: 'image', key: 'IMAGE_API_KEY', label: 'API Key', type: 'secret', placeholder: '' },
  { group: 'image', key: 'IMAGE_MODEL', label: '模型', type: 'text', placeholder: 'wanx2.1-t2i-turbo / cogview-3-plus …' },
  // 对象存储
  { group: 'storage', key: 'S3_ENDPOINT', label: 'Endpoint', type: 'url', placeholder: 'https://obs.cn-north-4.myhuaweicloud.com' },
  { group: 'storage', key: 'S3_BUCKET', label: 'Bucket', type: 'text', placeholder: '' },
  { group: 'storage', key: 'S3_ACCESS_KEY', label: 'Access Key', type: 'text', placeholder: '' },
  { group: 'storage', key: 'S3_SECRET_KEY', label: 'Secret Key', type: 'secret', placeholder: '' },
  { group: 'storage', key: 'S3_REGION', label: 'Region', type: 'text', placeholder: 'cn-north-4' },
  { group: 'storage', key: 'S3_PUBLIC_BASE', label: '公开访问前缀（可选）', type: 'url', placeholder: 'https://geo-cdn.example.com（桶需公共读）' },
  // 发布
  { group: 'publish', key: 'PUBLISH_MODE', label: '发布模式', type: 'enum', options: [['manual', '真实流程：确认后人工发布 + 回填（默认）'], ['webhook', 'Webhook：推送到自建 RPA/客户端'], ['mock', '演示模式：几秒后模拟完成（仅培训）']] },
  { group: 'publish', key: 'PUBLISH_WEBHOOK_URL', label: 'Webhook 地址（发布模式=webhook 时）', type: 'url', placeholder: 'https://your-rpa-client/publish' },
  { group: 'publish', key: 'PUBLISH_WEBHOOK_TOKEN', label: 'Webhook Token（可选）', type: 'secret', placeholder: '将以 X-Geo-Token 头发送' },
  // 安全与访问
  { group: 'security', key: 'TRUST_PROXY', label: '信任反向代理', type: 'enum', options: [['0', '直连（默认）'], ['1', '部署在 Nginx 等反代后（限流按真实 IP）']] },
  { group: 'security', key: 'SESSION_SECURE', label: '会话 Cookie Secure', type: 'enum', options: [['0', 'HTTP（内网/演示）'], ['1', 'HTTPS 部署必开']], boot: false },
  { group: 'security', key: 'DISABLE_REGISTER', label: '关闭自助注册', type: 'enum', options: [['0', '允许注册'], ['1', '关闭（管理员建号，生产建议）']], boot: false },
  // 演示数据
  { group: 'demo', key: 'SEED_DEMO', label: '演示数据种子', type: 'enum', options: [['1', '空库时写入演示账号/项目'], ['0', '不写入（生产）']], boot: true, desc: '改后需重启服务生效' },
];

export const GROUP_META = {
  llm: { title: '内容生成（LLM）', desc: '文章/答案卡/50 问/知识库整理的生成引擎。配置 Key 即走真实生成；未配置回落结构化模板。' },
  monitor: { title: 'AI 监测（四平台）', desc: '配了 Key 的平台走真实联网问答（引用来源自动适配）；未配置平台按下方「演示回退」开关处理。' },
  image: { title: '图像生成（封面/配图）', desc: '配置后封面走真实文生图；未配置/失败显式回落 SVG 并在素材 meta 记录原因。' },
  storage: { title: '对象存储（S3 兼容）', desc: '华为 OBS / 阿里 OSS / MinIO 均可（SigV4）。配置后素材与封面上对象存储；未配置存本地服务器。' },
  publish: { title: '发布', desc: 'manual=真实流程（人工发布后回填）；webhook=推送发布包到你的自建客户端；mock=演示（培训专用）。' },
  security: { title: '安全与访问', desc: '限流的代理信任、Cookie 安全标记、注册开关。' },
  demo: { title: '演示数据', desc: '演示账号与示例项目的种子开关。' },
};

let cache = null;

export function loadSettings() {
  const map = {};
  for (const row of q('SELECT key, value FROM settings')) map[row.key] = row.value;
  cache = map;
  return map;
}

// 应用到 process.env：DB 有值覆盖，空值回落部署环境（不清除已有 env）
export function applySettingsToEnv() {
  const map = cache || loadSettings();
  let applied = 0;
  for (const item of CONFIG_SCHEMA) {
    const v = map[item.key];
    if (v !== undefined && v !== '') {
      process.env[item.key] = v;
      applied++;
    }
  }
  return applied;
}

function validate(item, value) {
  const v = String(value || '').trim();
  if (item.type === 'url' && v && !/^https?:\/\//i.test(v)) return `${item.label}：必须是 http(s) 开头的地址`;
  if (item.type === 'enum' && v && !item.options.some(([k]) => k === v)) return `${item.label}：取值非法`;
  if (item.type === 'secret' && v && v.length > 512) return `${item.label}：过长`;
  return null;
}

export function saveSettings(entries) {
  const errors = [];
  const toSave = [];
  const byKey = new Map(CONFIG_SCHEMA.map((x) => [x.key, x]));
  for (const [key, raw] of Object.entries(entries || {})) {
    const item = byKey.get(key);
    if (!item) continue; // 白名单外一律丢弃（防任意 env 注入）
    const v = String(raw || '').trim();
    if (item.type === 'secret' && v === '') continue; // secret 空值=保持原值
    const err = validate(item, v);
    if (err) {
      errors.push(err);
      continue;
    }
    toSave.push([item, v]);
  }
  if (errors.length) return { ok: false, errors };
  for (const [item, v] of toSave) {
    run(
      `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`,
      item.key,
      v,
      nowIso()
    );
    process.env[item.key] = v; // 立即生效
  }
  loadSettings();
  return { ok: true, saved: toSave.map(([i]) => i.key) };
}

export function settingsValue(key) {
  return (cache || loadSettings())[key] ?? '';
}

export function maskSecret(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••';
  return `${s.slice(0, 3)}••••••${s.slice(-4)}`;
}
