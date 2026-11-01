// Rust 版集成测试：需要先启动服务器（PORT=3438），再运行
//   cargo run &
//   cargo test --test api_test -- --nocapture
// 使用 std TcpStream 原始 HTTP，避免额外依赖。
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;

const BASE: &str = "127.0.0.1:3438";

fn raw_request(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> (u16, String) {
    let mut stream = match TcpStream::connect(BASE) {
        Ok(s) => s,
        Err(_) => return (0, String::new()),
    };
    let mut req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method,
        path,
        BASE,
        body.len()
    );
    for (k, v) in headers {
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    req.push_str("\r\n");
    req.push_str(body);
    stream.write_all(req.as_bytes()).unwrap();
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    let status: u16 = buf.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let body_start = buf.find("\r\n\r\n").map(|i| i + 4).unwrap_or(buf.len());
    (status, buf[body_start..].to_string())
}

fn server_up() -> bool {
    TcpStream::connect(BASE).is_ok()
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or(json!({}))
}

#[test]
fn test_healthz() {
    if !server_up() {
        eprintln!("跳过：服务器未启动（PORT=3438）");
        return;
    }
    let (status, body) = raw_request("GET", "/healthz", &[], "");
    assert_eq!(status, 200);
    assert_eq!(json_of(&body)["ok"], true);
}

#[test]
fn test_login_page_and_auth_flow() {
    if !server_up() {
        eprintln!("跳过：服务器未启动（PORT=3438）");
        return;
    }
    let (status, body) = raw_request("GET", "/login", &[], "");
    assert_eq!(status, 200);
    assert!(body.contains("GEO 营销平台"));
    // 未登录访问受保护页 → 302/303 跳登录
    let (status, _) = raw_request("GET", "/dashboard", &[], "");
    assert!(status == 302 || status == 303, "expect redirect, got {}", status);
}

#[test]
fn test_open_api_auth() {
    if !server_up() {
        eprintln!("跳过：服务器未启动（PORT=3438）");
        return;
    }
    let (status, body) = raw_request(
        "POST",
        "/api/open/v1/call/projects.list",
        &[("Content-Type", "application/json"), ("Authorization", "Bearer gk-invalid")],
        "{}",
    );
    assert_eq!(status, 200);
    assert!(body.contains("AUTH_REQUIRED"));
}
