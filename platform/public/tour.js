// GEO 新手聚光灯引导引擎（零依赖）
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
