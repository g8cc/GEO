#!/usr/bin/env python3
# rust-html-audit.py —— HTML 标签平衡审计
# 背景：format! 拼 HTML 的页面若产生未闭合 div/table 等结构性损坏，grep 断言与状态码检查都发现不了
#       （v1.6.2 登录页缺壳事故的近亲类）。本脚本以真实会话抓取全部页面，栈式校验容器标签配对。
# 用法：python3 scripts/rust-html-audit.py [BASE]   （BASE 默认 http://localhost:3439，需已启动并种子演示数据）
import sys
import urllib.request
import urllib.parse
import http.cookiejar
from html.parser import HTMLParser

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3439").rstrip("/")
LOGIN_EMAIL, LOGIN_PW = "demo@geo.local", "demo1234"

# 需要配对校验的容器标签（保守集合，避免依赖浏览器可选闭合行为造成误报）
STACKABLE = {"div", "table", "thead", "tbody", "form", "select", "textarea",
             "details", "summary", "main", "aside", "ul", "ol", "li",
             "a", "button", "label", "h1", "h2", "h3", "pre", "b", "tr", "td", "th"}

OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def login():
    data = urllib.parse.urlencode({"email": LOGIN_EMAIL, "password": LOGIN_PW}).encode()
    req = urllib.request.Request(f"{BASE}/login", data=data, method="POST")
    OPENER.open(req, timeout=10)  # 会话 Cookie 落入 OPENER 的 cookiejar


class Auditor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag in STACKABLE:
            self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag not in STACKABLE:
            return
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
            return
        names = [t for t, _ in self.stack]
        if tag in names:
            idx = len(names) - 1 - names[::-1].index(tag)
            for t, pos in self.stack[idx + 1:]:
                self.errors.append(f"未闭合 <{t}>（{pos[0]} 行，被 </{tag}> 提前截断）")
            self.stack = self.stack[:idx]
        else:
            self.errors.append(f"多余的闭合标签 </{tag}>（{self.getpos()[0]} 行）")


def audit_page(page, html):
    a = Auditor()
    a.feed(html)
    for t, pos in a.stack:
        a.errors.append(f"未闭合 <{t}>（{pos[0]} 行，文档结束时仍打开）")
    if a.errors:
        print(f"  ❌ {page}")
        for e in a.errors[:5]:
            print(f"       {e}")
        return False
    print(f"  ✅ {page}")
    return True


def main():
    login()  # 建立会话（登录态页面审计依赖它）
    # 登录态页面（需会话）
    pid = ""
    try:
        import re as _re
        dash = OPENER.open(f"{BASE}/dashboard", timeout=10).read().decode()
        m = _re.search(r'option value="([a-f0-9-]{36})" selected', dash)
        pid = m.group(1) if m else ""
    except Exception:
        pass
    pages = {
        "/login": OPENER, "/register": OPENER, "/terms": OPENER, "/privacy": OPENER,
        "/dashboard": OPENER, "/companies": OPENER, "/projects": OPENER,
        "/settings/keys": OPENER, "/settings/config": OPENER,
        "/settings/licenses": OPENER, "/settings/audit": OPENER,
        "/team": OPENER, "/auto-geo": OPENER, "/change-password": OPENER,
    }
    if pid:
        pages.update({
            f"/projects/{pid}": OPENER, f"/projects/{pid}/kb": OPENER,
            f"/projects/{pid}/questions": OPENER, f"/projects/{pid}/content": OPENER,
            f"/projects/{pid}/articles": OPENER, f"/projects/{pid}/materials": OPENER,
            f"/projects/{pid}/accounts": OPENER, f"/projects/{pid}/publish": OPENER,
            f"/projects/{pid}/monitor": OPENER, f"/projects/{pid}/sites": OPENER,
            f"/projects/{pid}/wom": OPENER, f"/projects/{pid}/sources": OPENER,
            f"/projects/{pid}/reports": OPENER,
        })
    AUTHPAGES = {p for p in pages if not p.startswith(("/login", "/register", "/terms", "/privacy"))}
    print(f"▸ HTML 标签平衡审计：{len(pages)} 个页面")
    ok = 0
    for page, op in pages.items():
        try:
            html = op.open(f"{BASE}{page}", timeout=10).read().decode()
        except Exception as e:
            print(f"  ❌ {page}（抓取失败：{e}）")
            continue
        if page in AUTHPAGES and 'class="sidebar"' not in html:
            print(f"  ❌ {page}（会话失效：未渲染侧边栏）")
            continue
        ok += audit_page(page, html)
    total = len(pages)
    print(f"{'🎉' if ok == total else '⚠️'} HTML 审计：{ok}/{total} 通过")
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    main()
