// 图像生成 Provider（封面/配图）：
// - 配置 IMAGE_API_KEY 后调用真实文生图 API（OpenAI 兼容 images/generations 或
//   DashScope 万相异步任务），产物经对象存储/本地存储落盘。
// - 未配置或调用失败：显式回落 SVG 占位封面（meta.coverSource=svg-fallback），不产生假"已生成"假象。
import { put, storageConfigured } from './storage.js';

export function imageConfigured() {
  return !!process.env.IMAGE_API_KEY;
}

function buildPrompt(title) {
  const safe = String(title).replace(/[<>"'\\|]/g, '').slice(0, 60);
  return `为以下主题设计一张现代简洁的中文营销封面图，深蓝到紫色渐变背景，扁平插画风，大量留白，主体居中，无水印无乱码：${safe}`;
}

async function fetchImageBytes(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000); // 审计 v1.2-F2：下载超时保护
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`下载生成图片失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('生成的图片内容异常（过小）');
  return buf;
}

// OpenAI 兼容：POST {base}/images/generations → b64_json 或 url
async function viaOpenAI(prompt) {
  const base = (process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.IMAGE_MODEL || 'gpt-image-1';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000); // 审计 v1.2-F2
  let res;
  try {
    res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.IMAGE_API_KEY}` },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`图像生成失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) return fetchImageBytes(item.url);
  throw new Error('图像生成响应中没有图片数据');
}

// DashScope 万相：异步任务 → 轮询（最多 60 秒）→ 下载
async function viaDashScope(prompt) {
  const base = (process.env.IMAGE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/+$/, '');
  const model = process.env.IMAGE_MODEL || 'wanx2.1-t2i-turbo';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000); // 审计 v1.2-F2
  let res;
  try {
    res = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: { size: '1024*1024', n: 1 },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`图像任务提交失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const submit = await res.json();
  const taskId = submit.output?.task_id;
  if (!taskId) throw new Error('图像任务提交响应缺少 task_id');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pctrl = new AbortController();
    const ptimer = setTimeout(() => pctrl.abort(), 10_000);
    let pr;
    try {
      pr = await fetch(`${base}/tasks/${taskId}`, {
        signal: pctrl.signal,
        headers: { Authorization: `Bearer ${process.env.IMAGE_API_KEY}` },
      });
    } finally {
      clearTimeout(ptimer);
    }
    if (!pr.ok) throw new Error(`图像任务查询失败 HTTP ${pr.status}`);
    const st = await pr.json();
    const status = st.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = st.output?.results?.[0]?.url;
      if (!url) throw new Error('图像任务成功但无结果 URL');
      return fetchImageBytes(url);
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`图像任务失败：${st.output?.message || status}`);
    }
  }
  throw new Error('图像任务轮询超时（60 秒）');
}

/**
 * 生成封面图并落存储。
 * @returns {{url: string, storage: string, source: string, imageGenerated: boolean}}
 */
export async function generateCover(projectId, title, questionText = '') {
  const prompt = buildPrompt(title);
  const ts = Date.now();
  const name = `cover-${String(projectId).slice(0, 8)}-${ts}.png`;
  if (imageConfigured()) {
    try {
      const provider = process.env.IMAGE_PROVIDER || 'openai';
      const buffer = provider === 'dashscope' ? await viaDashScope(prompt) : await viaOpenAI(prompt);
      const r = await put('covers', name, buffer, 'image/png');
      return { ...r, source: `image-${provider}`, imageGenerated: true };
    } catch (e) {
      // 显式降级：真实生成失败不静默，SVG 回退并记录原因
      console.error('[image] 真实封面生成失败，回落 SVG：', e.message);
      const fb = await svgFallback(projectId, title);
      return { ...fb, source: `svg-fallback:${e.message.slice(0, 80)}`, imageGenerated: false };
    }
  }
  const fb = await svgFallback(projectId, title);
  return { ...fb, source: 'svg-default', imageGenerated: false };
}

async function svgFallback(projectId, title) {
  const { generateCoverSvg } = await import('./publish.js');
  const url = generateCoverSvg(title, projectId);
  return { url, storage: storageConfigured() ? 's3(unused)' : 'local' };
}
