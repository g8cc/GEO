// 图像生成 Provider（封面/配图真实化）：
// - 配置 IMAGE_API_KEY 后调用真实文生图 API（OpenAI 兼容 images/generations 或
//   DashScope 万相异步任务），产物落本地 uploads。
// - 未配置或调用失败：显式回落 SVG 占位封面（coverSource=svg-fallback），不产生"已生成"假象。
//   语义对齐 Node 版 providers/image.js。网络调用不持 DB 锁（调用方在 with_db 之外调用）。
use serde_json::{json, Value};
use std::io::Read;

use crate::llm::settings_get;

pub struct ImageCfg {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// 图像配置：IMAGE_API_KEY（settings→env）存在即启用
#[allow(dead_code)]
pub fn image_configured(conn: &rusqlite::Connection) -> bool {
    settings_get(conn, "IMAGE_API_KEY")
        .or_else(|| std::env::var("IMAGE_API_KEY").ok().filter(|v| !v.is_empty()))
        .is_some()
}

/// 锁内读配置（快）；网络生成用 generate_cover_with
pub fn cover_cfg(conn: &rusqlite::Connection) -> Option<ImageCfg> {
    let api_key = settings_get(conn, "IMAGE_API_KEY")
        .or_else(|| std::env::var("IMAGE_API_KEY").ok().filter(|v| !v.is_empty()))?;
    let provider = settings_get(conn, "IMAGE_PROVIDER")
        .or_else(|| std::env::var("IMAGE_PROVIDER").ok())
        .unwrap_or_else(|| "openai".to_string());
    let base_env = "IMAGE_BASE_URL";
    let model_env = "IMAGE_MODEL";
    let (dflt_base, dflt_model) = if provider == "dashscope" {
        ("https://dashscope.aliyuncs.com/api/v1", "wanx2.1-t2i-turbo")
    } else {
        ("https://api.openai.com/v1", "gpt-image-1")
    };
    let base_url = settings_get(conn, base_env)
        .or_else(|| std::env::var(base_env).ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| dflt_base.to_string())
        .trim_end_matches('/')
        .to_string();
    let model = settings_get(conn, model_env)
        .or_else(|| std::env::var(model_env).ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| dflt_model.to_string());
    Some(ImageCfg { provider, api_key, base_url, model })
}

/// 封面提示词（对齐 Node buildPrompt）
pub fn build_prompt(title: &str) -> String {
    let safe: String = title.chars().filter(|c| !"<>|\\\"'".contains(*c)).take(60).collect();
    format!(
        "为以下主题设计一张现代简洁的中文营销封面图，深蓝到紫色渐变背景，扁平插画风，大量留白，主体居中，无水印无乱码：{}",
        safe
    )
}

fn http_post_json(url: &str, key: &str, extra_headers: &[(&str, &str)], body: &Value, timeout: u64) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(timeout))
        .build();
    let mut req = agent.post(url).set("Content-Type", "application/json").set("Authorization", &format!("Bearer {}", key));
    for (k, v) in extra_headers {
        req = req.set(k, v);
    }
    let resp = req.send_string(&body.to_string()).map_err(|e| format!("HTTP 调用失败: {}", e))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| format!("响应读取失败: {}", e))?;
    if status != 200 {
        return Err(format!("HTTP {}: {}", status, text.chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|e| format!("响应解析失败: {}", e))
}

fn fetch_image_bytes(url: &str) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build();
    let resp = agent.get(url).call().map_err(|e| format!("下载生成图片失败: {}", e))?;
    let status = resp.status();
    if status != 200 {
        return Err(format!("下载生成图片失败 HTTP {}", status));
    }
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("图片下载读取失败: {}", e))?;
    if bytes.len() < 1000 {
        return Err("生成的图片内容异常（过小）".to_string());
    }
    Ok(bytes)
}

/// OpenAI 兼容：POST {base}/images/generations → b64_json 或 url
fn via_openai(cfg: &ImageCfg, prompt: &str) -> Result<Vec<u8>, String> {
    let body = json!({"model": cfg.model, "prompt": prompt, "n": 1, "size": "1024x1024"});
    let data = http_post_json(&format!("{}/images/generations", cfg.base_url), &cfg.api_key, &[], &body, 60)?;
    let item = &data["data"][0];
    if let Some(b64) = item["b64_json"].as_str() {
        use base64::Engine;
        return base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("b64 解码失败: {}", e));
    }
    if let Some(url) = item["url"].as_str() {
        return fetch_image_bytes(url);
    }
    Err("图像生成响应中没有图片数据".to_string())
}

/// DashScope 万相：异步任务提交 → 轮询（最多 60 秒）→ 下载
fn via_dashscope(cfg: &ImageCfg, prompt: &str) -> Result<Vec<u8>, String> {
    let body = json!({
        "model": cfg.model,
        "input": {"prompt": prompt},
        "parameters": {"size": "1024*1024", "n": 1}
    });
    let submit = http_post_json(
        &format!("{}/services/aigc/text2image/image-synthesis", cfg.base_url),
        &cfg.api_key,
        &[("X-DashScope-Async", "enable")],
        &body,
        30,
    )?;
    let task_id = submit["output"]["task_id"].as_str().unwrap_or("").to_string();
    if task_id.is_empty() {
        return Err("图像任务提交响应缺少 task_id".to_string());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(10))
        .build();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(3000));
        let resp = agent
            .get(&format!("{}/tasks/{}", cfg.base_url, task_id))
            .set("Authorization", &format!("Bearer {}", cfg.api_key))
            .call()
            .map_err(|e| format!("图像任务查询失败: {}", e))?;
        let status_code = resp.status();
        let text = resp.into_string().map_err(|e| format!("任务查询读取失败: {}", e))?;
        if status_code != 200 {
            return Err(format!("图像任务查询失败 HTTP {}", status_code));
        }
        let st: Value = serde_json::from_str(&text).map_err(|e| format!("任务查询解析失败: {}", e))?;
        let status = st["output"]["task_status"].as_str().unwrap_or("");
        if status == "SUCCEEDED" {
            let url = st["output"]["results"][0]["url"].as_str().unwrap_or("");
            if url.is_empty() {
                return Err("图像任务成功但无结果 URL".to_string());
            }
            return fetch_image_bytes(url);
        }
        if status == "FAILED" || status == "CANCELED" {
            return Err(format!(
                "图像任务失败：{}",
                st["output"]["message"].as_str().unwrap_or(status)
            ));
        }
    }
    Err("图像任务轮询超时（60 秒）".to_string())
}

pub struct CoverGen {
    pub url: String,
    pub source: String,
    pub image_generated: bool,
}

/// 生成封面：配置了 IMAGE_API_KEY → 真实文生图（写本地 uploads）；失败显式回落 SVG。
/// DB 仅用于读配置（快），网络与文件写在锁外由调用方保证。
#[allow(dead_code)]
pub fn generate_cover(conn: &rusqlite::Connection, pid: &str, title: &str) -> CoverGen {
    match cover_cfg(conn) {
        Some(cfg) => generate_cover_with(&cfg, pid, title),
        None => svg_fallback(pid, title, "svg-default".to_string()),
    }
}

/// 锁外网络生成（调用方先在锁内 cover_cfg 读配置）
pub fn generate_cover_with(cfg: &ImageCfg, pid: &str, title: &str) -> CoverGen {
    let prompt = build_prompt(title);
    let name = format!("cover-{}-{}.png", &pid[..8.min(pid.len())], chrono::Utc::now().timestamp_millis());
    match if cfg.provider == "dashscope" {
        via_dashscope(cfg, &prompt)
    } else {
        via_openai(cfg, &prompt)
    } {
        Ok(bytes) => {
            let dir = crate::mock::uploads_dir();
            std::fs::write(std::path::Path::new(&dir).join(&name), &bytes).ok();
            CoverGen { url: format!("/uploads/{}", name), source: format!("image-{}", cfg.provider), image_generated: true }
        }
        Err(e) => {
            eprintln!("[image] 真实封面生成失败，回落 SVG：{}", e);
            svg_fallback(pid, title, format!("svg-fallback:{}", e.chars().take(80).collect::<String>()))
        }
    }
}

fn svg_fallback(pid: &str, title: &str, source: String) -> CoverGen {
    let url = crate::mock::generate_cover_svg(title, pid);
    CoverGen { url, source, image_generated: false }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn fake_png() -> Vec<u8> {
        let mut v = vec![0x89u8, b'P', b'N', b'G'];
        v.resize(1200, 0xAB);
        v
    }

    /// 长度感知读完整请求（body 可能分片到达）
    fn read_request(sock: &mut std::net::TcpStream) -> String {
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
        String::from_utf8_lossy(&buf).to_string()
    }

    fn respond(sock: &mut std::net::TcpStream, status_line: &str, content_type: &str, body: &[u8]) {
        let resp = format!("{}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", status_line, content_type, body.len());
        sock.write_all(resp.as_bytes()).unwrap();
        sock.write_all(body).unwrap();
    }

    #[test]
    fn test_cover_openai_b64_generated() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let png = fake_png();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let req = read_request(&mut sock);
            assert!(req.contains("POST /images/generations"));
            assert!(req.contains("Bearer sk-img"));
            assert!(req.contains("gpt-image-1"));
            respond(&mut sock, "HTTP/1.1 200 OK", "application/json", format!("{{\"data\":[{{\"b64_json\":\"{}\"}}]}}", b64).as_bytes());
        });
        let cfg = ImageCfg { provider: "openai".into(), api_key: "sk-img".into(), base_url: format!("http://127.0.0.1:{}", port), model: "gpt-image-1".into() };
        let c = generate_cover_with(&cfg, "abcd1234-test", "跃动童年封面标题");
        assert!(c.image_generated, "应为真实生成：{}", c.source);
        assert!(c.url.starts_with("/uploads/cover-"));
        assert!(c.source.contains("image-openai"));
        // 文件确实落盘且字节数一致
        let path = std::path::Path::new(&crate::mock::uploads_dir()).join(c.url.trim_start_matches("/uploads/"));
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 1200);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_cover_dashscope_async_flow() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let png = fake_png();
        std::thread::spawn(move || {
            // 1) 提交任务
            let (mut sock, _) = listener.accept().unwrap();
            let req = read_request(&mut sock);
            assert!(req.contains("/services/aigc/text2image/image-synthesis"));
            assert!(req.contains("X-DashScope-Async: enable"));
            respond(&mut sock, "HTTP/1.1 200 OK", "application/json", br#"{"output":{"task_id":"task-1"},"request_id":"r"}"#);
            // 2) 轮询 → SUCCEEDED
            let (mut sock2, _) = listener.accept().unwrap();
            let req2 = read_request(&mut sock2);
            assert!(req2.contains("/tasks/task-1"));
            let poll_body = format!(r#"{{"output":{{"task_status":"SUCCEEDED","results":[{{"url":"http://127.0.0.1:{}/dl"}}]}}}}"#, port);
            respond(&mut sock2, "HTTP/1.1 200 OK", "application/json", poll_body.as_bytes());
            // 3) 下载图片
            let (mut sock3, _) = listener.accept().unwrap();
            let req3 = read_request(&mut sock3);
            assert!(req3.starts_with("GET /dl"));
            respond(&mut sock3, "HTTP/1.1 200 OK", "image/png", &png);
        });
        let cfg = ImageCfg { provider: "dashscope".into(), api_key: "sk-dash".into(), base_url: format!("http://127.0.0.1:{}", port), model: "wanx2.1-t2i-turbo".into() };
        let c = generate_cover_with(&cfg, "abcd1234-test", "万相封面");
        assert!(c.image_generated, "万相三段交互应成功：{}", c.source);
        assert!(c.source.contains("image-dashscope"));
    }

    #[test]
    fn test_cover_fallback_on_failure() {
        // 不可达端口 → 显式回落 SVG（image_generated=false，coverSource 记录原因）
        let cfg = ImageCfg { provider: "openai".into(), api_key: "k".into(), base_url: "http://127.0.0.1:1".into(), model: "m".into() };
        let c = generate_cover_with(&cfg, "abcd1234-test", "失败回落封面");
        assert!(!c.image_generated);
        assert!(c.source.starts_with("svg-fallback:"));
        assert!(c.url.starts_with("/uploads/cover-")); // SVG 落盘
    }
}
