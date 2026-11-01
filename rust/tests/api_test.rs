// Rust 版 API 集成测试
// 运行方式：先启动服务器，再运行测试
// cargo test --test api_test -- --nocapture

use std::io::Read;

fn http_post(path: &str, body: &str, key: &str) -> (u16, serde_json::Value) {
    let url = format!("http://localhost:3438{}", path);
    let mut req = urllib_request(&url, "POST");
    req.header("Content-Type", "application/json");
    req.header("Authorization", &format!("Bearer {}", key));
    let resp = req.body(body.to_string()).send().unwrap();
    let status = resp.status().as_u16();
    let body = resp.text().unwrap();
    (status, serde_json::from_str(&body).unwrap_or(json!({})))
}

fn http_get(path: &str, key: &str) -> (u16, serde_json::Value) {
    let url = format!("http://localhost:3438{}", path);
    let req = urllib_request(&url, "GET");
    let resp = req.header("Authorization", &format!("Bearer {}", key)).send().unwrap();
    let status = resp.status().as_u16();
    let body = resp.text().unwrap();
    (status, serde_json::from_str(&body).unwrap_or(json!({})))
}

// 使用 std::net::TcpStream 做原始 HTTP（避免依赖 reqwest）
fn urllib_request(url: &str, method: &str) -> http::Request<http::Body> {
    http::Request::builder()
        .method(method)
        .uri(url)
        .body(http::Body::empty())
        .unwrap()
}

#[test]
fn test_healthz() {
    let (status, body) = http_get("/healthz", "");
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);
}

#[test]
fn test_capabilities() {
    let (status, body) = http_post("/api/open/v1/call", "{}", "test-key");
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);
    let caps = body["data"]["capabilities"].as_array().unwrap();
    assert!(caps.len() >= 40);
}

#[test]
fn test_auth_required() {
    let (status, body) = http_post("/api/open/v1/call/projects.list", "{}", "invalid-key");
    assert_eq!(body["ok"], false);
    assert_eq!(body["code"], "AUTH_REQUIRED");
}

#[test]
fn test_invalid_capability() {
    let (status, body) = http_post("/api/open/v1/call/nonexistent.capability", "{}", "test-key");
    assert_eq!(body["ok"], false);
}

#[test]
fn test_root_redirect() {
    let (status, body) = http_get("/", "");
    // Rust 版根路径返回 "GEO Platform (Rust)"
    assert_eq!(status, 200);
}
