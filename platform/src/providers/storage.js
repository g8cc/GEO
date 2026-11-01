// 对象存储 Provider（S3 兼容，零依赖手写 AWS SigV4）
// 配置 S3_* 环境变量后，素材/封面写入对象存储（华为 OBS / 阿里 OSS / MinIO 等 S3 兼容服务）；
// 未配置时回落本地 uploads 目录——调用方接口不变。
// 安全：Secret Key 只在签名时使用，绝不写入日志/返回值。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from '../db.js';

function cfg() {
  if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_BUCKET) return null;
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(endpoint)) return null;
  return {
    endpoint,
    bucket: process.env.S3_BUCKET,
    ak: process.env.S3_ACCESS_KEY,
    sk: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION || 'us-east-1',
    publicBase: (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, ''),
  };
}

export function storageConfigured() {
  return !!cfg();
}

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// key 形态：covers/xxx.png、materials/yyy.jpg（仅允许安全字符，防路径注入）
function safeKey(key) {
  const k = String(key)
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, ''))
    .filter(Boolean)
    .join('/');
  if (!k || k.startsWith('/')) throw new Error('非法存储 key');
  return k;
}

// AWS SigV4 签名（path-style：{endpoint}/{bucket}/{key}）
export function signRequest({ method, host, canonicalUri, payload, amzDate, region, ak, sk, contentType }) {
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(payload);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${sk}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash,
  };
}

/**
 * 写入对象并返回可公开访问的 URL。
 * @param {string} kind 目录类别：covers | materials
 * @param {string} name 文件名（含扩展名）
 * @param {Buffer} buffer 内容
 * @param {string} contentType
 */
export async function put(kind, name, buffer, contentType = 'application/octet-stream') {
  const safeName = safeKey(name);
  const c = cfg();
  if (!c) {
    // 本地回落：uploads 平铺，静态服务 /uploads/* 直接可访问
    fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
    return { url: `/uploads/${safeName}`, storage: 'local' };
  }
  const key = safeKey(`${kind}/${safeName}`);
  const host = c.endpoint.replace(/^https?:\/\//, '');
  const canonicalUri = `/${c.bucket}/${key}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const { authorization, amzDate: xAmzDate, payloadHash } = signRequest({
    method: 'PUT',
    host,
    canonicalUri,
    payload: buffer,
    amzDate,
    region: c.region,
    ak: c.ak,
    sk: c.sk,
    contentType,
  });
  const res = await fetch(`${c.endpoint}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'x-amz-date': xAmzDate,
      'x-amz-content-sha256': payloadHash,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`对象存储写入失败（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`);
  }
  const url = c.publicBase ? `${c.publicBase}/${key}` : `${c.endpoint}${canonicalUri}`;
  return { url, storage: 's3' };
}


// 系统配置页连通性测试（写入并校验小对象）
export async function testS3() {
  const c = cfg();
  if (!c) throw new Error('S3 未配置');
  const r = await put('materials', `connectivity-test-${Date.now()}.txt`, Buffer.from('geo-ok'), 'text/plain');
  return `对象存储连通正常：${r.url}`;
}
