use axum::response::IntoResponse;

pub const STYLE_CSS: &str = r###":root {
  --bg: #f6f7fb;
  --panel: #ffffff;
  --ink: #1a2233;
  --muted: #6b7280;
  --line: #e5e8f0;
  --brand: #4f46e5;
  --brand-soft: #eef0ff;
  --ok: #16a34a;
  --warn: #d97706;
  --bad: #dc2626;
  --info: #0284c7;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 14px; line-height: 1.6;
}
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }

.shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 224px; flex-shrink: 0; background: #171d2e; color: #cdd3e1;
  padding: 18px 12px; position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.sidebar .logo { color: #fff; font-weight: 700; font-size: 16px; padding: 4px 10px 14px; letter-spacing: .5px; }
.sidebar .proj {
  margin: 0 8px 12px; padding: 10px; background: rgba(255,255,255,.06); border-radius: 8px; font-size: 12px;
}
.sidebar .proj select { width: 100%; margin-top: 6px; }
.sidebar .group { margin: 14px 0 4px; padding: 0 10px; font-size: 11px; color: #7c86a0; letter-spacing: 1px; }
.sidebar a.nav {
  display: block; padding: 7px 10px; margin: 1px 0; border-radius: 7px; color: #cdd3e1; font-size: 13px;
}
.sidebar a.nav:hover { background: rgba(255,255,255,.07); text-decoration: none; }
.sidebar a.nav.active { background: var(--brand); color: #fff; }
.sidebar .foot { margin-top: 18px; padding: 10px; font-size: 12px; color: #7c86a0; }

.main { flex: 1; padding: 22px 28px 60px; max-width: 1160px; }
.page-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.page-head h1 { font-size: 20px; margin: 0; }
.page-head .sub { color: var(--muted); font-size: 13px; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
.card h2 { font-size: 15px; margin: 0 0 12px; }
.card h3 { font-size: 14px; margin: 14px 0 8px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid #eef1f6; vertical-align: top; }
tr:hover td { background: #fafbfe; }
td.wrap { max-width: 380px; }

.badge { display: inline-block; padding: 1px 9px; border-radius: 99px; font-size: 12px; line-height: 20px; white-space: nowrap; }
.b-gray { background: #eef1f6; color: #4b5563; }
.b-ok { background: #e8f7ee; color: var(--ok); }
.b-warn { background: #fdf3e2; color: var(--warn); }
.b-bad { background: #fdeaea; color: var(--bad); }
.b-info { background: #e6f4fc; color: var(--info); }
.b-brand { background: var(--brand-soft); color: var(--brand); }

.btn {
  display: inline-block; padding: 7px 16px; border-radius: 8px; border: 1px solid var(--brand);
  background: var(--brand); color: #fff; font-size: 13px; cursor: pointer;
}
.btn:hover { opacity: .92; text-decoration: none; }
.btn.ghost { background: #fff; color: var(--brand); }
.btn.small { padding: 3px 10px; font-size: 12px; }
.btn.danger { background: var(--bad); border-color: var(--bad); }
.btn:disabled { opacity: .5; cursor: not-allowed; }

form.inline { display: inline; }
label.f { display: block; margin: 10px 0 4px; font-size: 13px; color: var(--muted); }
input[type=text], input[type=email], input[type=password], input[type=number], select, textarea {
  width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px;
  font-family: inherit; background: #fff;
}
textarea { min-height: 90px; resize: vertical; }
textarea.code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; background: #f8fafc; }
.row { display: flex; gap: 14px; flex-wrap: wrap; }
.row > div { flex: 1; min-width: 180px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.step { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: #fff; }
.step .no { font-size: 11px; color: var(--muted); }
.step .name { font-weight: 600; margin: 2px 0 6px; }
.step.done { border-color: #bfe8cd; background: #f2fbf5; }
.step .st { font-size: 12px; }

.md { white-space: pre-wrap; font-size: 13px; }
.md-box { background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; max-height: 560px; overflow: auto; }
.keybox { font-family: ui-monospace, Menlo, monospace; background: #f8fafc; border: 1px dashed var(--brand); padding: 12px 14px; border-radius: 8px; word-break: break-all; }
.empty { color: var(--muted); text-align: center; padding: 28px 0; }
.notice { background: var(--brand-soft); border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }
.notice.warn { background: #fdf3e2; }
.kv { font-size: 13px; color: var(--muted); }
.kv b { color: var(--ink); font-weight: 600; }
.mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.answer { background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; white-space: pre-wrap; font-size: 13px; }
.cite { font-size: 12px; color: var(--muted); margin-top: 4px; }
.auth-hero { max-width: 380px; margin: 12vh auto; }

/* 新手引导 */
.modal-mask { position: fixed; inset: 0; background: rgba(15,20,35,.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 14px; padding: 26px 30px; max-width: 560px; box-shadow: 0 12px 48px rgba(0,0,0,.18); }
.modal h2 { margin: 0 0 8px; }
.modal .tour { padding-left: 20px; margin: 12px 0; }
.modal .tour li { margin: 7px 0; font-size: 13px; }
.ns-banner { border-left: 4px solid var(--brand); }

/* 聚光灯引导 */
body.geo-tour-on { overflow: hidden; }
.geo-tour-spot {
  position: fixed; z-index: 90; border-radius: 12px; pointer-events: none;
  box-shadow: 0 0 0 200vmax rgba(10, 15, 30, .58);
  outline: 2px solid var(--brand);
  opacity: 0; transition: all .35s cubic-bezier(.4, 0, .2, 1);
}
.geo-tour-spot.on { opacity: 1; }
.geo-tour-pulse {
  position: absolute; inset: -6px; border-radius: 14px;
  border: 2px solid var(--brand); animation: geo-pulse 1.6s ease-out infinite;
}
@keyframes geo-pulse {
  0% { opacity: .9; transform: scale(1); }
  70% { opacity: 0; transform: scale(1.12); }
  100% { opacity: 0; transform: scale(1.12); }
}
.geo-tour-tip {
  position: fixed; z-index: 95; width: 320px; background: #fff; border-radius: 12px;
  padding: 14px 16px; box-shadow: 0 10px 40px rgba(0,0,0,.25);
  opacity: 0; transform: translateY(6px);
  transition: left .35s cubic-bezier(.4,0,.2,1), top .35s cubic-bezier(.4,0,.2,1), opacity .25s, transform .25s;
}
.geo-tour-tip.show { opacity: 1; transform: translateY(0); }
.geo-tour-tip.flip::before {
  content: ''; position: absolute; right: -8px; top: 50%; margin-top: -8px;
  border: 8px solid transparent; border-left-color: #fff;
}
.geo-tour-tip:not(.flip)::before {
  content: ''; position: absolute; left: -8px; top: 50%; margin-top: -8px;
  border: 8px solid transparent; border-right-color: #fff;
}
.geo-tour-tip .tt-head { display: flex; justify-content: space-between; align-items: center; }
.geo-tour-tip .tt-step { font-size: 11px; color: var(--brand); font-weight: 700; letter-spacing: .5px; }
.geo-tour-tip .tt-skip { font-size: 12px; color: var(--muted); }
.geo-tour-tip .tt-title { font-weight: 700; font-size: 15px; margin: 6px 0 4px; }
.geo-tour-tip .tt-desc { font-size: 13px; color: #374151; line-height: 1.65; }
.geo-tour-tip .tt-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.geo-tour-tip .tt-dots { flex: 1; display: flex; gap: 5px; justify-content: center; }
.geo-tour-tip .dot { width: 7px; height: 7px; border-radius: 99px; background: #dfe3ee; transition: all .3s; }
.geo-tour-tip .dot.on { background: var(--brand); width: 18px; }
.geo-tour-tip .dot.done { background: var(--brand-soft); outline: 1px solid var(--brand); }
/* 悬浮引导按钮 */
.geo-fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 80;
  background: var(--brand); color: #fff; border-radius: 99px; padding: 10px 18px;
  font-size: 13px; box-shadow: 0 6px 24px rgba(79,70,229,.4);
}
.geo-fab:hover { transform: translateY(-2px); text-decoration: none; }
body.geo-tour-on .geo-fab { display: none; }

/* 任务式快速上手 */
.missions-card .ms-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 10px; margin: 4px 0; }
.missions-card .ms-item.done { opacity: .62; }
.missions-card .ms-item.current { background: var(--brand-soft); border: 1px solid var(--brand); }
.missions-card .ms-no { width: 26px; height: 26px; border-radius: 99px; background: #eef1f6; color: #4b5563; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
.missions-card .ms-item.done .ms-no { background: var(--ok); color: #fff; }
.missions-card .ms-item.current .ms-no { background: var(--brand); color: #fff; }
.missions-card .ms-body { flex: 1; display: flex; flex-direction: column; line-height: 1.35; }
.missions-card .ms-item.done .ms-body b { text-decoration: line-through; }

/* 终局-D：移动端适配 */
@media (max-width: 900px) {
  .shell { flex-direction: column; }
  .sidebar { position: static; width: 100%; height: auto; padding: 10px; }
  .sidebar .group { display: inline-block; margin: 4px 6px 0 0; }
  .sidebar a.nav { display: inline-block; padding: 5px 9px; }
  .sidebar .foot { display: none; }
  .main { padding: 14px; }
  .steps { grid-template-columns: repeat(2, 1fr); }
  .grid2 { grid-template-columns: 1fr; }
  .missions-card .ms-item { flex-wrap: wrap; }
  table { display: block; overflow-x: auto; }
}

/* ===== 登录 / 注册（分屏品牌版式，Node 与 Rust 共用同一份）===== */
.auth-wrap { display: flex; min-height: 100vh; }
.auth-brand { flex: 1.1; background: linear-gradient(160deg, #171d2e 0%, #2b2f63 70%, #4f46e5 130%); color: #cdd3e1; padding: 52px 48px; display: flex; flex-direction: column; justify-content: center; }
.auth-brand .auth-logo { width: 52px; height: 52px; border-radius: 14px; background: var(--brand); color: #fff; font-weight: 800; font-size: 28px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 34px rgba(79,70,229,.5); margin-bottom: 6px; }
.auth-brand h1 { color: #fff; font-size: 26px; margin: 12px 0 6px; letter-spacing: .5px; }
.auth-brand .auth-tag { color: #aeb6d8; font-size: 14px; margin: 0 0 26px; }
.auth-brand ul.auth-points { list-style: none; padding: 0; margin: 0 0 30px; }
.auth-brand ul.auth-points li { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; color: #b9c0dd; }
.auth-brand ul.auth-points li b { color: #fff; margin-right: 6px; }
.auth-brand .auth-foot { font-size: 12px; color: #7c86a0; }
.auth-brand .auth-foot a { color: #9aa3c7; }
.auth-panel { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 20px; background: var(--bg); }
.auth-card { width: 100%; max-width: 400px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 30px 32px 26px; box-shadow: 0 12px 48px rgba(26,34,51,.08); }
.auth-card h2 { margin: 0 0 4px; font-size: 19px; }
.auth-error { background: #fdeaea; color: var(--bad); border: 1px solid #f3c8c8; border-radius: 8px; padding: 9px 12px; font-size: 13px; margin: 12px 0 0; }
.pwd-row { position: relative; }
.pwd-row input { padding-right: 58px; }
.pwd-eye { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: var(--brand); font-size: 12px; cursor: pointer; padding: 4px 6px; }
@media (max-width: 860px) { .auth-brand { display: none; } .auth-wrap { display: block; } }
"###;

pub const TOUR_JS: &str = r###"// GEO 新手聚光灯引导引擎（零依赖）
// 屏幕遮罩 + 目标元素聚光灯（呼吸动画）+ 气泡指引 + 上一步/下一步/去操作 + 进度点
// 步骤由服务端按用户数据状态生成（window.GEO_TOUR_STEPS），已完成站点自动标注 ✓
(function () {
  'use strict';

  var rawSteps = window.GEO_TOUR_STEPS || [];
  var state = { active: false, idx: 0, spot: null, tip: null };

  function visibleSteps() {
    // 只保留当前页面能找到目标元素的步骤（服务端已按数据状态过滤）
    return rawSteps.filter(function (s) {
      try { return document.querySelector(s.sel); } catch (e) { return false; }
    });
  }

  function ensureDom() {
    if (state.spot) return;
    var spot = document.createElement('div');
    spot.className = 'geo-tour-spot';
    spot.innerHTML = '<div class="geo-tour-pulse"></div>';
    var tip = document.createElement('div');
    tip.className = 'geo-tour-tip';
    tip.setAttribute('role', 'dialog');
    document.body.appendChild(spot);
    document.body.appendChild(tip);
    state.spot = spot;
    state.tip = tip;
  }

  function render() {
    var steps = visibleSteps();
    if (!steps.length) { finish(true); return; }
    if (state.idx >= steps.length) { finish(false); return; }
    var st = steps[state.idx];
    var el = document.querySelector(st.sel);
    if (!el) { state.idx += 1; render(); return; }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var pad = 9;
    var r = el.getBoundingClientRect();
    state.spot.style.top = r.top - pad + 'px';
    state.spot.style.left = r.left - pad + 'px';
    state.spot.style.width = r.width + pad * 2 + 'px';
    state.spot.style.height = r.height + pad * 2 + 'px';
    state.spot.classList.add('on');

    var total = steps.length;
    var dots = '';
    for (var i = 0; i < total; i++) {
      dots += '<span class="dot' + (i === state.idx ? ' on' : i < state.idx ? ' done' : '') + '"></span>';
    }
    var cta = st.href
      ? '<a class="btn small" href="' + st.href + '" onclick="geoTour.done()">' + (st.cta || '去操作') + '</a>'
      : '';
    state.tip.innerHTML =
      '<div class="tt-head"><span class="tt-step">' + (state.idx + 1) + ' / ' + total + '</span>' +
      '<a class="tt-skip" href="javascript:void(0)" onclick="geoTour.done()">跳过引导</a></div>' +
      '<div class="tt-title">' + st.title + '</div>' +
      '<div class="tt-desc">' + st.desc + '</div>' +
      '<div class="tt-foot">' + cta +
      '<span class="tt-dots">' + dots + '</span>' +
      (state.idx > 0 ? '<a class="btn ghost small" href="javascript:void(0)" onclick="geoTour.prev()">上一步</a>' : '') +
      (state.idx < total - 1
        ? '<a class="btn small" href="javascript:void(0)" onclick="geoTour.next()">下一步</a>'
        : '<a class="btn small" href="javascript:void(0)" onclick="geoTour.done()">完成 🎉</a>') +
      '</div>';

    // 气泡定位：默认目标右侧（侧边栏目标都在左侧），空间不足翻到左侧/下方
    state.tip.style.visibility = 'hidden';
    state.tip.classList.add('show');
    requestAnimationFrame(function () {
      var tw = state.tip.offsetWidth;
      var th = state.tip.offsetHeight;
      var left = r.right + pad + 16;
      if (left + tw > window.innerWidth - 12) left = r.left - pad - tw - 16;
      var top = r.top + r.height / 2 - th / 2;
      if (top < 12) top = 12;
      if (top + th > window.innerHeight - 12) top = window.innerHeight - th - 12;
      if (left < 12) {
        left = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12));
        top = r.bottom + pad + 12;
        if (top + th > window.innerHeight - 12) top = Math.max(12, r.top - th - pad - 12);
      }
      state.tip.style.left = left + 'px';
      state.tip.style.top = top + 'px';
      state.tip.style.visibility = 'visible';
      state.tip.classList.toggle('flip', left < r.left);
    });
  }

  function start(force) {
    if (!rawSteps.length) return;
    ensureDom();
    state.active = true;
    state.idx = 0;
    document.body.classList.add('geo-tour-on');
    render();
  }

  function finish(markDone) {
    state.active = false;
    document.body.classList.remove('geo-tour-on');
    if (state.spot) state.spot.classList.remove('on');
    if (state.tip) state.tip.classList.remove('show');
    if (markDone !== false) {
      try { localStorage.setItem('geo_tour_v2', '1'); } catch (e) {}
    }
  }

  function reposition() {
    if (!state.active) return;
    var steps = visibleSteps();
    var st = steps[state.idx];
    if (!st) return;
    var el = document.querySelector(st.sel);
    if (!el) return;
    var pad = 9;
    var r = el.getBoundingClientRect();
    state.spot.style.top = r.top - pad + 'px';
    state.spot.style.left = r.left - pad + 'px';
    state.spot.style.width = r.width + pad * 2 + 'px';
    state.spot.style.height = r.height + pad * 2 + 'px';
  }

  window.geoTour = {
    start: start,
    next: function () { state.idx += 1; render(); },
    prev: function () { if (state.idx > 0) { state.idx -= 1; render(); } },
    done: function () { finish(false); },
    finish: finish,
  };

  document.addEventListener('keydown', function (e) {
    if (!state.active) return;
    if (e.key === 'Escape') finish(false);
    if (e.key === 'ArrowRight') window.geoTour.next();
    if (e.key === 'ArrowLeft') window.geoTour.prev();
  });
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  // 首次访问自动启动（工作台以外的页面元素缺失会被 visibleSteps 过滤，
  // 服务端已把跨页面步骤的 sel 设为侧边栏导航——每页都存在，可在任意页续看）
  function startNamed(name) {
    var seq = (window.GEO_PAGE_TOURS || {})[name];
    if (!seq || !seq.length) return false;
    rawSteps = seq;
    state.manual = true;
    start();
    return true;
  }
  window.geoTour.startNamed = startNamed;

  document.addEventListener('DOMContentLoaded', function () {
    // 页面微引导：URL 带 ?tour=<name> 时优先播放该页的具体操作引导
    var name = new URLSearchParams(location.search).get('tour');
    if (name && startNamed(name)) return;
    // 功能地图（13 站点）不再自动播放，避免与任务式上手冲突；右下角 FAB 手动触发
    try { localStorage.removeItem('geo_tour_pending'); } catch (e) {}
  });
})();
"###;

pub async fn style_css() -> axum::response::Response {
    (
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        STYLE_CSS.to_string(),
    ).into_response()
}

pub async fn tour_js() -> axum::response::Response {
    (
        [(axum::http::header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        TOUR_JS.to_string(),
    ).into_response()
}
