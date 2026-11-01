// Web UI 组件：布局 + 常用片段
import { escapeHtml as e, fmtTime, safeUrl } from '../util.js';
import { PAGE_TOURS } from './nextstep.js';
import {
  ARTICLE_STATUS, ARTICLE_TYPE, QUESTION_CATEGORY, QUESTION_STAGE, QUESTION_PRIORITY, QUESTION_STATUS,
  KB_TYPE, KB_MODULE, PUBLISH_PLATFORM, PUBLISH_TASK_STATUS, AI_PLATFORM, MONITOR_MODE, MONITOR_TASK_STATUS,
  CHECKPOINT_STATUS, RECOMMEND_LEVEL, HIT_STATUS, SOURCE_ASSET_STATUS, SOURCE_CONTROLLABILITY,
  SOURCE_PAGE_STATUS, EVIDENCE_TYPE, PUBLISHER_TYPE, ACCOUNT_TYPE, ACCOUNT_AUTH_STATUS, REPORT_TYPE,
  AUDIT_GATE, AUDIT_VERDICT, MATERIAL_TYPE,
} from '../enums.js';

export { e, fmtTime, safeUrl };

const BADGE_COLOR = {
  已正式发布: 'b-ok', 已发布: 'b-ok', 已被AI引用: 'b-ok', 精准命中: 'b-ok', 已上榜: 'b-ok', 通过: 'b-ok', 已授权: 'b-ok', 已引用信源: 'b-ok', 完成: 'b-ok', 已完成: 'b-ok', 优先推荐: 'b-ok',
  修改后通过: 'b-warn', 弱命中: 'b-warn', 待复测: 'b-warn', 发布中: 'b-warn', 运行中: 'b-warn', 监测中: 'b-warn', 优化中: 'b-warn', 已创建: 'b-warn', 已创建任务: 'b-warn', 待执行: 'b-warn', 排队: 'b-warn', P0最高: 'b-bad', 不通过: 'b-bad', 未命中: 'b-bad', 失败: 'b-bad', 已过期: 'b-bad', 失效: 'b-bad',
  已生成: 'b-gray', 已上传: 'b-info', 待监测: 'b-gray',
};

export function badge(text) {
  const cls = BADGE_COLOR[text] || 'b-gray';
  return `<span class="badge ${cls}">${e(text || '—')}</span>`;
}

export function labelBadge(map, value) {
  return badge(map[value] ?? '—');
}



function MISSIONS_HTML(m) {
  const items = m.missions
    .map((x, i) => {
      const state = x.done ? 'done' : x.current ? 'current' : 'todo';
      return `<div class="ms-item ${state}">
        <span class="ms-no">${x.done ? '✓' : i + 1}</span>
        <span class="ms-body"><b>${e(x.title)}</b><span class="kv">${e(x.desc)}</span></span>
        ${state === 'current' ? `<a class="btn small" href="${x.href}">开始：${e(x.title)} →</a>` : state === 'done' ? '<a class="btn small ghost" href="' + x.href + '">查看</a>' : ''}
      </div>`;
    })
    .join('');
  const doneCount = m.missions.filter((x) => x.done).length;
  return `<div class="card missions-card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="margin:0">🚀 快速上手：${doneCount}/${m.missions.length} 完成</h2>
      <span class="kv">跟着做，最快 ${doneCount >= 2 ? '10' : '15'} 分钟跑通 GEO 最小闭环（每完成一步自动打勾）</span>
    </div>
    ${items}
  </div>`;
}

const WELCOME_HTML = `<div id="geo-welcome" class="modal-mask" style="display:none">
  <div class="modal">
    <h2>👋 欢迎使用 GEO 营销平台</h2>
    <p class="kv">这是你的生成式引擎优化（GEO）运营系统：让 AI 在用户提问时准确认识你、推荐你、引用你。</p>
    <ol class="tour">
      <li><b>存事实：</b>公司 → GEO 项目 → 品牌知识库（六模块）。AI 只能用库里已确认的事实写作，绝不编造。</li>
      <li><b>选问题：</b>一键生成 50 个消费者真实会问 AI 的问题，精简为标准 40 问。</li>
      <li><b>做内容：</b>AI 答案卡 / 品牌优化文章 / 产品推荐文章，过三道审核后发布。</li>
      <li><b>看结果：</b>上榜监测告诉你「AI 引用了你没有」，沉淀信源资产，逐轮优化。</li>
    </ol>
    <p class="kv">💡 两种玩法：在网页上按 <b>新手引导横幅</b> 一步步点；或在 Codex / Claude Code 里对 AI 说
    「<b>我是新学员，帮我选择合适模式并跑一个 GEO 项目</b>」让 AI 帮你操作（写操作都会先给你确认摘要）。</p>
    <div style="margin-top:14px;text-align:right">
      <a href="javascript:void(0)" class="kv" style="margin-right:12px" onclick="geoWelcomeClose()">跳过</a>
      <a class="btn" href="/companies?tour=companies" onclick="geoWelcomeClose()">🚀 开始快速上手（6 步跑通最小闭环）</a>
      <a class="btn ghost" href="javascript:void(0)" onclick="geoWelcomeClose();setTimeout(function(){geoTour.start()},250)">先看功能地图</a>
    </div>
  </div>
</div>`;

export function layout({ title, user, active = '', projId = '', projNav = '', body }) {
  const projOptions = user
    ? global.__userProjects.map(
        (p) => `<option value="${p.id}" ${p.id === projId ? 'selected' : ''}>${e(p.name)}</option>`
      ).join('')
    : '';
  const P = projId && user ? projectNav(projId, active) : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} · GEO 平台</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2222%22 fill=%22%234f46e5%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2252%22 text-anchor=%22middle%22 fill=%22white%22 font-family=%22sans-serif%22%3EG%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css">
</head><body>
${user ? `<div class="shell">
<aside class="sidebar">
  <div class="logo">GEO 营销平台</div>
  <div class="proj">当前项目
    <select onchange="if(this.value)location='/projects/'+this.value">
      <option value="">选择项目…</option>${projOptions}
    </select>
  </div>
  <a class="nav ${active === 'dashboard' ? 'active' : ''}" href="/dashboard">十步工作台</a>
  <a class="nav ${active === 'auto-geo' ? 'active' : ''}" href="/auto-geo" style="color:var(--brand);font-weight:600">🚀 一键 GEO</a>
  <div class="group">基础建设</div>
  <a class="nav ${active === 'companies' ? 'active' : ''}" href="/companies">公司管理</a>
  <a class="nav ${active === 'projects' ? 'active' : ''}" href="/projects">GEO 项目</a>
  ${P}
  <div class="group">系统</div>
  <a class="nav ${active === 'changepwd' ? 'active' : ''}" href="/change-password">修改密码</a>
  <a class="nav ${['keys','config','audit','licenses'].includes(active) ? 'active' : ''}" href="/settings/keys">系统设置</a>
  <a class="nav ${active === 'team' ? 'active' : ''}" href="/team">团队成员</a>
  <div class="foot">
    ${e(user.email)}<br>
    <a href="/logout" style="color:#7c86a0">退出登录</a><br><br>
    <span class="mono">v1.0 · mock 演示版</span>
  </div>
</aside>
<main class="main">
      ${active === 'dashboard' && global.__missions && !global.__missions.allDone ? MISSIONS_HTML(global.__missions) : ''}
      ${active === 'dashboard' && global.__missions && global.__missions.allDone ? '<div class="notice ns-banner">🎉 快速上手已完成——进入持续运营循环：每轮只做一个优化动作，第 3/7/14 天用同一问题复测。<a class="btn small" href="/dashboard" style="margin-left:8px">去工作台</a></div>' : ''}
      ${body}
      ${user ? WELCOME_HTML : ''}
      ${user ? '<a class="geo-fab" href="javascript:void(0)" title="功能地图：带你认全 13 个入口" onclick="geoTour.finish(false);geoTour.start()">🗺️ 功能地图</a>' : ''}
    </main>
    ${user ? `<script>window.GEO_TOUR_STEPS = ${JSON.stringify(global.__tourSteps || [])};window.GEO_PAGE_TOURS = ${JSON.stringify(PAGE_TOURS)};</script><script src="/tour.js"></script>` : ''}
    <script>
      function dismissStep(){
        try{ const b=document.getElementById('ns-banner'); const k='geo_ns_done_'+b.dataset.href; localStorage.setItem(k,'1'); b.remove(); }catch(e){}
      }
      (function(){
        const b=document.getElementById('ns-banner');
        if(b && localStorage.getItem('geo_ns_done_'+b.dataset.href)==='1'){ b.remove(); }
        try{
          if(!localStorage.getItem('geo_welcome_v1')){
            document.getElementById('geo-welcome').style.display='flex';
          }
        }catch(e){}
        function closeW(){ document.getElementById('geo-welcome').style.display='none'; localStorage.setItem('geo_welcome_v1','1'); }
        window.geoWelcomeClose=closeW;
      })();
    </script>
</div>` : `<main class="main">
      ${active === 'dashboard' && global.__missions && !global.__missions.allDone ? MISSIONS_HTML(global.__missions) : ''}
      ${active === 'dashboard' && global.__missions && global.__missions.allDone ? '<div class="notice ns-banner">🎉 快速上手已完成——进入持续运营循环：每轮只做一个优化动作，第 3/7/14 天用同一问题复测。<a class="btn small" href="/dashboard" style="margin-left:8px">去工作台</a></div>' : ''}
      ${body}
      ${user ? WELCOME_HTML : ''}
      ${user ? '<a class="geo-fab" href="javascript:void(0)" title="功能地图：带你认全 13 个入口" onclick="geoTour.finish(false);geoTour.start()">🗺️ 功能地图</a>' : ''}
    </main>
    ${user ? `<script>window.GEO_TOUR_STEPS = ${JSON.stringify(global.__tourSteps || [])};window.GEO_PAGE_TOURS = ${JSON.stringify(PAGE_TOURS)};</script><script src="/tour.js"></script>` : ''}
    <script>
      function dismissStep(){
        try{ const b=document.getElementById('ns-banner'); const k='geo_ns_done_'+b.dataset.href; localStorage.setItem(k,'1'); b.remove(); }catch(e){}
      }
      (function(){
        const b=document.getElementById('ns-banner');
        if(b && localStorage.getItem('geo_ns_done_'+b.dataset.href)==='1'){ b.remove(); }
        try{
          if(!localStorage.getItem('geo_welcome_v1')){
            document.getElementById('geo-welcome').style.display='flex';
          }
        }catch(e){}
        function closeW(){ document.getElementById('geo-welcome').style.display='none'; localStorage.setItem('geo_welcome_v1','1'); }
        window.geoWelcomeClose=closeW;
      })();
    </script>`}

    <!-- 全站异步加载层 -->
    <div id="geo-loading" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(15,20,35,.65);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;flex-direction:column">
      <div style="background:#fff;border-radius:16px;padding:36px 48px;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.2);max-width:400px">
        <div class="geo-spinner" style="width:48px;height:48px;margin:0 auto 16px;border:4px solid var(--brand-soft);border-top-color:var(--brand);border-radius:50%;animation:geo-spin .8s linear infinite"></div>
        <div id="geo-loading-text" style="font-size:15px;font-weight:600;color:var(--ink);margin-bottom:6px">处理中…</div>
        <div id="geo-loading-sub" style="font-size:13px;color:var(--muted)">请稍候，页面将自动跳转</div>
      </div>
    </div>
    <style>
      @keyframes geo-spin { to { transform: rotate(360deg); } }
      #geo-loading.show { display: flex !important; }
      #geo-loading .geo-spinner { animation: geo-spin .8s linear infinite; }
      body.geo-loading * { pointer-events: none !important; }
      body.geo-loading #geo-loading { pointer-events: auto !important; }
    </style>
    <script>
    (function() {
      // 操作类型 → 状态文本映射
      var STATUS_MAP = [
        { pattern: /kb\/organize/, text: 'AI 正在整理知识库六模块…', sub: '真实 AI 分析中，需要 10-30 秒' },
        { pattern: /questions\/generate/, text: 'AI 正在生成问题…', sub: '真实 AI 生成中，需要 5-15 秒' },
        { pattern: /content\/create/, text: 'AI 正在创作内容…', sub: '真实 AI 写作中，需要 15-60 秒' },
        { pattern: /articles.*audit/, text: '正在执行三道审核…', sub: '知识库一致性 / 媒体标准 / GEO 可信度' },
        { pattern: /monitor\/create/, text: '正在创建上榜监测…', sub: 'AI 正在回答监测问题，需要 10-30 秒' },
        { pattern: /monitor.*runnext|monitor.*runNext/, text: '正在执行复测…', sub: 'AI 正在回答监测问题' },
        { pattern: /publish\/create/, text: '正在生成发布包…', sub: '整理七字段发布确认清单' },
        { pattern: /publish.*confirm/, text: '正在确认发布…', sub: '任务已提交，异步处理中' },
        { pattern: /auto-geo\/run/, text: '🚀 一键 GEO 执行中…', sub: 'AI 正在分析项目并创建全部资产，需要 1-3 分钟' },
        { pattern: /reports\/create/, text: '正在生成报告…', sub: '基于监测数据分析中' },
        { pattern: /sources\/collect/, text: '正在沉淀信源资产…', sub: '从监测结果归类四状态' },
        { pattern: /team\/invite/, text: '正在邀请成员…', sub: '' },
        { pattern: /licenses\/generate/, text: '正在生成卡密…', sub: '' },
        { pattern: /settings\/config\/save/, text: '正在保存系统配置…', sub: '' },
        { pattern: /login/, text: '正在登录…', sub: '' },
        { pattern: /register/, text: '正在创建账号…', sub: '' },
      ];
            function getCookie(name) {
        var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return m ? m[2] : '';
      }
      var shown = false;

      function showLoading(text, sub) {
        if (shown) return;
        shown = true;
        var el = document.getElementById('geo-loading');
        if (!el) return;
        document.getElementById('geo-loading-text').textContent = text || '处理中…';
        document.getElementById('geo-loading-sub').textContent = sub || '请稍候';
        el.classList.add('show');
        document.body.classList.add('geo-loading');
        // 禁用所有提交按钮
        document.querySelectorAll('button[type="submit"], button:not([type])').forEach(function(b) { b.disabled = true; });
      }

      function hideLoading() {
        shown = false;
        var el = document.getElementById('geo-loading');
        if (el) el.classList.remove('show');
        document.body.classList.remove('geo-loading');
        document.querySelectorAll('button[disabled]').forEach(function(b) { b.disabled = false; });
      }

      // 拦截所有表单提交
      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (form.tagName !== 'FORM') return;
        var action = form.getAttribute('action') || '';
        // 找到匹配的状态文本
        var entry = STATUS_MAP.find(function(s) { return s.pattern.test(action); });
        if (entry) {
          showLoading(entry.text, entry.sub);
        } else if (action && action !== '#') {
          showLoading('处理中…', '请稍候');
        }
        // 不 preventDefault——让表单正常提交，覆盖层在服务器响应前一直显示
      }, true); // capture phase，确保在任何 handler 之前

      // 页面加载时隐藏（从其他页面跳转过来时）
      window.addEventListener('pageshow', function() { hideLoading(); });
    })();
    </script>
\n</body></html>`;
}

function projectNav(pid, active) {
  const items = [
    ['overview', '项目概览', `/projects/${pid}`],
    ['kb', '知识库', `/projects/${pid}/kb`],
    ['questions', '问题拓展 / 搜索问题库', `/projects/${pid}/questions`],
    ['content', '内容创作', `/projects/${pid}/content`],
    ['articles', '文章管理', `/projects/${pid}/articles`],
    ['materials', '资源中心', `/projects/${pid}/materials`],
    ['accounts', '授权账号', `/projects/${pid}/accounts`],
    ['publish', '内容发布 / 自媒体发布', `/projects/${pid}/publish`],
    ['paid', '付费媒体', `/projects/${pid}/paid`],
    ['monitor', '上榜监测', `/projects/${pid}/monitor`],
    ['sites', '收录站点', `/projects/${pid}/sites`],
    ['wom', '口碑监测', `/projects/${pid}/wom`],
    ['sources', '信源资产', `/projects/${pid}/sources`],
    ['reports', '诊断报告 / 监测报告', `/projects/${pid}/reports`],
  ];
  return `<div class="group">本项目</div>` + items.map(
    ([key, name, href]) => `<a class="nav ${active === key ? 'active' : ''}" href="${href}">${name}</a>`
  ).join('');
}

export function pageHead(title, sub = '', right = '') {
  return `<div class="page-head"><div><h1>${e(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div>${right}</div></div>`;
}

export function card(title, body, extra = '') {
  return `<div class="card">${title ? `<h2>${title}</h2>` : ''}${body}</div>${extra}`;
}

export function table(headers, rowsHtml, emptyHtml) {
  if (Array.isArray(rowsHtml)) rowsHtml = rowsHtml.join('');
  if (!rowsHtml || !rowsHtml.trim()) return emptyHtml || `<div class="empty">暂无数据</div>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

export function emptyCta(text, href, cta = '去完成') {
  return `<div class="empty">${e(text)}<div style="margin-top:10px"><a class="btn" href="${href}">${e(cta)}</a></div></div>`;
}

export function empty(text = '暂无数据') {
  return `<div class="empty">${e(text)}</div>`;
}

export function sel(name, options, value = '', allowEmpty = '', required = false) {
  return `<select name="${e(name)}" ${required ? 'required' : ''}>${allowEmpty ? `<option value="">${e(allowEmpty)}</option>` : ''}${options
    .map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${e(t)}</option>`)
    .join('')}</select>`;
}

export const ENUMS = {
  ARTICLE_STATUS, ARTICLE_TYPE, QUESTION_CATEGORY, QUESTION_STAGE, QUESTION_PRIORITY, QUESTION_STATUS,
  KB_TYPE, KB_MODULE, PUBLISH_PLATFORM, PUBLISH_TASK_STATUS, AI_PLATFORM, MONITOR_MODE, MONITOR_TASK_STATUS,
  CHECKPOINT_STATUS, RECOMMEND_LEVEL, HIT_STATUS, SOURCE_ASSET_STATUS, SOURCE_CONTROLLABILITY,
  SOURCE_PAGE_STATUS, EVIDENCE_TYPE, PUBLISHER_TYPE, ACCOUNT_TYPE, ACCOUNT_AUTH_STATUS, REPORT_TYPE,
  AUDIT_GATE, AUDIT_VERDICT, MATERIAL_TYPE,
};
