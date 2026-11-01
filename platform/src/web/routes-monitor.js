// Web 路由：上榜监测 / 收录站点 / 口碑监测 / 信源资产 / 报告 / 系统设置 Open Key
import { q, q1, run, insert, id, audit } from '../db.js';
import { nowIso, parseJsonSafe, e, fmtTime as ft } from '../util.js';
import * as svc from '../services.js';
import { pageHead, card, table, badge, empty, emptyCta, sel, ENUMS, safeUrl } from './ui.js';
import { CONFIG_SCHEMA, GROUP_META, loadSettings, saveSettings, settingsValue, maskSecret } from '../settings.js';
import { e as esc } from './ui.js';
import { primaryOrgId, memberRole, ensurePrimaryOrg } from '../db.js';
import { generateLicenseKeys, redeemLicenseKey, PLANS } from '../services.js';
import {
  AI_PLATFORM, HIT_STATUS, RECOMMEND_LEVEL, SOURCE_ASSET_STATUS, SOURCE_CONTROLLABILITY,
  SOURCE_PAGE_STATUS, EVIDENCE_TYPE, PUBLISHER_TYPE, ACCOUNT_TYPE, REPORT_TYPE,
} from '../enums.js';

export const monitorRoutes = [];
function route(method, pattern, handler) {
  monitorRoutes.push({ method, pattern, handler });
}

// ============ 上榜监测 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/monitor$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  await svc.runDueCheckpoints(p.id); // 执行到期的 3/7/14 天复测
  const questions = q('SELECT * FROM questions WHERE projectId=? ORDER BY priority, createdAt', p.id);
  const tasks = q('SELECT * FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC', p.id);
  c.body =
    pageHead('上榜监测', '固定问题版本、AI 平台、提问时间和监测周期；保存 AI 回答全文和引用来源。') +
    card('创建监测任务', questions.length ? `
      <form method="post" action="/projects/${p.id}/monitor/create">
        <div class="row">
          <div style="flex:2"><label class="f">问题（可多选）*</label>
            <select name="questionIds" multiple size="6" required>${questions.map((x) => `<option value="${x.id}">${e(x.text)}</option>`).join('')}</select>
            <div class="kv">按住 Cmd/Ctrl 多选。品牌认知问题（带品牌名）与产品推荐问题（不带品牌名）可分别建任务。</div>
          </div>
          <div><label class="f">AI 平台（可多选）*</label>
            <select name="platforms" multiple size="6" required>${Object.entries(ENUMS.AI_PLATFORM).map(([k, v]) => `<option value="${k}" ${k === '1' ? 'selected' : ''}>${e(v)}</option>`).join('')}</select>
          </div>
          <div><label class="f">监测模式</label>${sel('mode', [[1, '一次性监测（仅一次）'], [2, '周期复测（3/7/14 天）']])}</div>
        </div>
        <div style="margin-top:10px"><button class="btn">创建并立即执行首轮</button></div>
      </form>` : '<div class="notice warn">请先建立问题库</div>') +
    (tasks.length ? '' : emptyCta('还没有监测任务——创建后系统立即执行首轮，并告诉你 AI 是否引用了你', `javascript:void(0)`, '↑ 往上看创建表单')) +
    card('监测任务', table(['创建时间', '模式', '平台', '状态', ''], tasks.map((t) => {
      const qids = parseJsonSafe(t.questionIds, []);
      const plats = parseJsonSafe(t.platforms, []);
      const cps = q('SELECT * FROM monitorCheckpoints WHERE taskId=? ORDER BY day', t.id);
      return `<tr><td>${ft(t.createdAt)}<div class="kv">${qids.length} 个问题</div></td>
      <td>${badge(ENUMS.MONITOR_MODE[t.mode])}</td>
      <td>${plats.map((x) => badge(ENUMS.AI_PLATFORM[x])).join(' ')}</td>
      <td>${badge(ENUMS.MONITOR_TASK_STATUS[t.status])}<div class="kv">${cps.map((cp) => `第${cp.day}天:${cp.status === 2 ? '✓' : '…'}`).join(' ')}</div></td>
      <td>
        <a class="btn small" href="/monitor/${t.id}">查看结果</a>
        ${cps.some((cp) => cp.status === 1) ? `<form method="post" action="/monitor/${t.id}/runnext" class="inline"><button class="btn small ghost">执行下个复测点</button></form>` : ''}
      </td></tr>`;
    })));
  c.render('上榜监测', 'monitor', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/monitor\/create$/, async (req, res, c) => {
  const body = c.body;
  const questionIds = [].concat(body.questionIds || []).filter(Boolean);
  const platforms = [].concat(body.platforms || [1]).filter(Boolean).map(Number);
  const scheduleDays = Number(body.mode) === 2 ? [3, 7, 14] : [];
  await svc.createMonitorTask(c.params[0], {
    questionIds,
    platforms,
    mode: Number(body.mode),
    scheduleDays,
    runNow: true,
  });
  res.writeHead(302, { Location: `/projects/${c.params[0]}/monitor` });
  res.end();
});

route('GET', /^\/monitor\/([a-f0-9-]+)$/, async (req, res, c) => {
  const t = q1('SELECT * FROM monitorTasks WHERE id=?', c.params[0]);
  if (!t) return c.notFound();
  const p = svc.getProjectSafe(c.user.id, t.projectId);
  if (!p) return c.notFound();
  const results = q('SELECT * FROM monitorResults WHERE taskId=? ORDER BY ranAt', t.id);
  await svc.runDueCheckpoints(t.projectId);
  const rowsHtml = results
    .map((r) => {
      const citations = parseJsonSafe(r.citations, []);
      const competitors = parseJsonSafe(r.competitors, []);
      return `<tr><td class="wrap">
        <div class="kv">${ft(r.ranAt)} · ${badge(ENUMS.AI_PLATFORM[r.platform])}</div>
        <div class="answer" style="margin-top:6px">${e(r.answerText)}</div>
        <div class="cite">引用来源：${citations.map((x) => `${x.own ? '🟢' : '⚪'} <a href="${safeUrl(x.url)}">${e(x.title)}</a>(${e(x.domain)})`).join('　') || '—'}</div>
      </td>
      <td>${r.brandMentioned ? badge('已上榜') : badge('未命中')}<div class="kv">${e(r.mentionPosition)}</div>
        <div class="kv">推荐级别：${ENUMS.RECOMMEND_LEVEL[r.recommendLevel]}</div>
        ${r.brandAccurate !== null && r.brandAccurate !== undefined ? `<div class="kv">描述${r.brandAccurate ? '准确' : '<b style="color:var(--bad)">不准确</b>'}</div>` : ''}
        ${competitors.length ? `<div class="kv">竞品：${competitors.map((x) => e(x.name)).join('、')}</div>` : ''}
      </td>
      <td>${badge(ENUMS.HIT_STATUS[r.hitStatus])}${r.exactUrlHit ? '<div class="badge b-ok" style="margin-top:4px">exact_url_hit</div>' : ''}${r.dataSource && r.dataSource !== 'mock' ? `<div class="badge b-info" style="margin-top:4px">${r.dataSource === 'real-llm' ? 'LLM 监测' : '平台监测'}</div>` : r.dataSource === 'mock' ? '<div class="badge b-gray" style="margin-top:4px">演示数据</div>' : ''}</td>
      <td class="wrap kv">${e(r.nextStep || '')}<br>下一步优化：${e(r.nextOptimize || '')}</td></tr>`;
    })
    .join('');
  const qids = parseJsonSafe(t.questionIds, []);
  const questionTexts = qids.map((qid) => q1('SELECT text FROM questions WHERE id=?', qid)?.text).filter(Boolean);
  c.body =
    pageHead('监测结果', `${questionTexts.map(e).join(' / ')}`, `<a class="btn ghost" href="/projects/${p.id}/monitor">返回</a>`) +
    card(`AI 回答与引用记录（${results.length} 条）`, table(['AI 回答全文 + 引用来源', '品牌表现', '监测状态', '下一步'], rowsHtml)) +
    card('从本任务沉淀信源 / 生成报告', `
      <div class="row">
        <form method="post" action="/projects/${p.id}/sources/collect" class="inline">
          <input type="hidden" name="taskId" value="${t.id}">
          <button class="btn">沉淀为信源资产</button>
        </form>
        <form method="post" action="/projects/${p.id}/reports/create" class="inline">
          <input type="hidden" name="taskIdA" value="${t.id}">
          <input type="hidden" name="type" value="1">
          <button class="btn ghost">生成品牌诊断报告</button>
        </form>
        <form method="post" action="/projects/${p.id}/reports/create" class="inline">
          <input type="hidden" name="taskIdA" value="${t.id}">
          <input type="hidden" name="type" value="2">
          <button class="btn ghost">生成产品推荐诊断报告</button>
        </form>
      </div>`);
  c.render('监测结果', 'monitor', p.id);
});

route('POST', /^\/monitor\/([a-f0-9-]+)\/runnext$/, async (req, res, c) => {
  try {
    await svc.forceRunNextCheckpoint(c.params[0]);
  } catch {}
  const t = q1('SELECT projectId FROM monitorTasks WHERE id=?', c.params[0]);
  res.writeHead(302, { Location: `/monitor/${c.params[0]}` });
  res.end();
});

// ============ 收录站点 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/sites$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM monitorResults WHERE projectId=?', p.id);
  const sites = {};
  for (const r of rows) {
    for (const cit of parseJsonSafe(r.citations, [])) {
      const s = (sites[cit.domain] = sites[cit.domain] || { domain: cit.domain, count: 0, own: 0, titles: [] });
      s.count++;
      if (cit.own) s.own++;
      if (s.titles.length < 3) s.titles.push(cit.title);
    }
  }
  const list = Object.values(sites).sort((a, b) => b.count - a.count);
  c.body =
    pageHead('收录站点', 'AI 实际引用了什么：从监测结果的引用来源聚合（🟢 = 我方内容）') +
    card('站点列表', table(['站点', '被引用次数', '我方内容', '示例标题'], list.map((s) => `
      <tr><td class="mono">${e(s.domain)}</td><td><b>${s.count}</b></td>
      <td>${s.own ? `<span class="badge b-ok">🟢 ${s.own} 次</span>` : '<span class="badge b-gray">0</span>'}</td>
      <td class="wrap kv">${s.titles.map(e).join('；')}</td></tr>`)));
  c.render('收录站点', 'sites', p.id);
});

// ============ 口碑监测（占位） ============
route('GET', /^\/projects\/([a-f0-9-]+)\/wom$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const tasks = q('SELECT * FROM monitorTasks WHERE projectId=?', p.id);
  const repTasks = tasks.filter((t) =>
    parseJsonSafe(t.questionIds, []).some((qid) => (q1('SELECT source FROM questions WHERE id=?', qid) || {}).source === '口碑监测')
  );
  const latest = repTasks[0];
  let summaryHtml = empty('还没有口碑监测数据——上方一键创建后自动执行首轮');
  if (latest) {
    const results = q('SELECT * FROM monitorResults WHERE taskId=?', latest.id);
    const rows = results.map((r) => {
      const NEG = ['投诉', '差评', '维权', '退款', '跑路', '暴雷', '避坑', '骗', '风险', '违规', '翻车', '不推荐', '慎选'];
      const text = String(r.answerText || '');
      const hits = NEG.filter((w) => text.includes(w));
      return `<tr><td class="wrap"><div class="kv">${ft(r.ranAt)} · ${badge(ENUMS.AI_PLATFORM[r.platform])}</div>
        <div class="answer" style="margin-top:6px">${e(text.length > 400 ? text.slice(0, 400) + '…' : text)}</div></td>
        <td>${hits.length ? `<span class="badge b-bad">${e(hits.join('、'))}</span>` : '<span class="badge b-ok">无负面信号</span>'}</td>
        <td>${badge(ENUMS.HIT_STATUS[r.hitStatus])}</td></tr>`;
    });
    summaryHtml = table(['AI 回答（口碑类问题）', '负面信号', '监测状态'], rows.join(''));
  }
  c.body =
    pageHead('口碑监测', '用「品牌名 + 差评/投诉/维权/跑路」等口碑问题持续探测全网负面信号（复用真实监测 Provider）') +
    (c.query.e ? `<div class="notice warn">${e(c.query.e)}</div>` : '') +
    card('一键创建口碑监测任务', `
      <form method="post" action="/projects/${p.id}/wom/create" class="row">
        <div><label class="f">AI 平台（可多选）*</label>
          <select name="platforms" multiple size="5">${Object.entries(ENUMS.AI_PLATFORM).map(([k, v]) => `<option value="${k}" selected>${e(v)}</option>`).join('')}</select>
        </div>
        <div><label class="f">监测模式</label>${sel('mode', [[2, '周期复测（3/7/14 天）'], [1, '一次性监测']])}</div>
        <div style="flex:0;align-self:flex-end"><button class="btn">创建并执行首轮</button></div>
      </form>
      <div class="kv" style="margin-top:8px">自动生成 8 个口碑探测问题（靠谱吗/投诉/差评/跑路/避坑…，风险判断类），与问题库独立标记。</div>`) +
    (repTasks.length ? card(`口碑任务（${repTasks.length}）`, table(['创建时间', '模式', '状态', ''], repTasks.map((t) => `
      <tr><td>${ft(t.createdAt)}</td><td>${badge(ENUMS.MONITOR_MODE[t.mode])}</td>
      <td>${badge(ENUMS.MONITOR_TASK_STATUS[t.status])}</td>
      <td><form method="post" action="/projects/${p.id}/reports/create" class="inline">
        <input type="hidden" name="type" value="6"><input type="hidden" name="taskIdA" value="${t.id}">
        <button class="btn small ghost">生成口碑摘要报告</button></form></td></tr>`))) : '') +
    card('最新一轮口碑结果', summaryHtml);
  c.render('口碑监测', 'wom', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/wom\/create$/, async (req, res, c) => {
  const platforms = [].concat(c.body.platforms || [1]).filter(Boolean).map(Number);
  try {
    await svc.createReputationMonitor(c.params[0], {
      platforms,
      mode: Number(c.body.mode),
      scheduleDays: [3, 7, 14],
    });
  } catch (err) {
    res.writeHead(302, { Location: `/projects/${c.params[0]}/wom?e=${encodeURIComponent(err.message)}` });
    return res.end();
  }
  res.writeHead(302, { Location: `/projects/${c.params[0]}/wom` });
  res.end();
});

// ============ 信源资产 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/sources$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM sourceAssets WHERE projectId=? ORDER BY updatedAt DESC', p.id);
  const byStatus = {};
  for (const s of SOURCE_ASSET_STATUS_ARRAY) byStatus[s] = 0;
  for (const r of rows) byStatus[ENUMS.SOURCE_ASSET_STATUS[r.status]] = (byStatus[ENUMS.SOURCE_ASSET_STATUS[r.status]] || 0) + 1;
  c.body =
    pageHead('信源资产', '按问题和 AI 平台分别记录，不能合并成一张媒体名单。三问分类：能证明什么 / 是谁发布的 / 在哪里发布、能不能影响。') +
    card('四状态统计', Object.entries(byStatus).map(([k, v]) => `<span class="badge ${k === '已引用信源' ? 'b-ok' : 'b-gray'}" style="margin-right:8px">${k}: ${v}</span>`).join('')) +
    (rows.length ? '' : emptyCta('信源资产库为空——完成一次上榜监测后点下方「一键沉淀」，或手动登记已知信源', `javascript:void(0)`, '↓ 往下看沉淀按钮')) +
    card('信源资产清单', table(
      ['文章标题 / URL', '问题 / AI平台', '证据类型 / 发布主体 / 账号类型', '引用次数 / 品牌表现', '可控性 / 页面状态', '状态', '下一步动作', ''],
      rows.map((r) => `
      <tr>
        <td class="wrap"><b>${e(r.articleTitle)}</b><div class="mono"><a href="${safeUrl(r.url)}">${e(r.url)}</a></div></td>
        <td class="wrap kv">${e(r.question || '—')}<div>${badge(ENUMS.AI_PLATFORM[r.aiPlatform])}</div></td>
        <td class="kv">${badge(ENUMS.EVIDENCE_TYPE[r.evidenceType])} ${badge(ENUMS.PUBLISHER_TYPE[r.publisher])}<div>${badge(ENUMS.ACCOUNT_TYPE[r.accountType])}</div></td>
        <td><b>${r.citedCount}</b><div class="kv wrap">${e(r.brandPerformance || '')}</div></td>
        <td class="kv">${badge(ENUMS.SOURCE_CONTROLLABILITY[r.controllability])}<div>${badge(ENUMS.SOURCE_PAGE_STATUS[r.pageStatus])}</div></td>
        <td>${badge(ENUMS.SOURCE_ASSET_STATUS[r.status])}</td>
        <td class="wrap kv">${e(r.nextAction || '')}</td>
        <td>
          <details><summary class="btn small ghost" style="cursor:pointer">调整</summary>
            <form method="post" action="/projects/${p.id}/sources/update" style="margin-top:8px">
              <input type="hidden" name="id" value="${r.id}">
              <label class="f">状态</label>${sel('status', Object.entries(ENUMS.SOURCE_ASSET_STATUS).map(([k, v]) => [k, v]), r.status)}
              <label class="f">可控性</label>${sel('controllability', Object.entries(ENUMS.SOURCE_CONTROLLABILITY).map(([k, v]) => [k, v]), r.controllability)}
              <label class="f">页面状态</label>${sel('pageStatus', Object.entries(ENUMS.SOURCE_PAGE_STATUS).map(([k, v]) => [k, v]), r.pageStatus)}
              <label class="f">下一步动作</label><input type="text" name="nextAction" value="${e(r.nextAction || '')}">
              <div style="margin-top:8px"><button class="btn small">保存</button></div>
            </form>
          </details>
        </td>
      </tr>`))) +
    card('从监测结果沉淀信源（区分已引用/潜在/可投放/观察）', `
      <form method="post" action="/projects/${p.id}/sources/collect" class="row">
        <div style="flex:0"><button class="btn">一键沉淀全部监测结果</button></div>
        <div class="kv" style="align-self:center">我方被引用的 URL → 已引用信源；竞品/第三方 → 观察信源；可后续人工调整。</div>
      </form>`);
  c.render('信源资产', 'sources', p.id);
});

const SOURCE_ASSET_STATUS_ARRAY = ['已引用信源', '潜在信源', '可投放信源', '观察信源'];

route('POST', /^\/projects\/([a-f0-9-]+)\/sources\/collect$/, async (req, res, c) => {
  await svc.collectSourceAssets(c.params[0], c.body.taskId || null);
  res.writeHead(302, { Location: `/projects/${c.params[0]}/sources` });
  res.end();
});

route('POST', /^\/projects\/([a-f0-9-]+)\/sources\/update$/, async (req, res, c) => {
  await svc.upsertSourceAsset(c.params[0], { id: c.body.id, status: Number(c.body.status), controllability: Number(c.body.controllability), pageStatus: Number(c.body.pageStatus), nextAction: c.body.nextAction });
  res.writeHead(302, { Location: `/projects/${c.params[0]}/sources` });
  res.end();
});

// ============ 系统配置（管理员专属）============

// 系统设置区导航条（keys/config/audit/licenses 四个子页共用）
function settingsNav(active, extra = '') {
  const tabs = [
    ['keys', 'API 密钥', '给 AI 助手（geo CLI / Skills）发放的平台接口密钥'],
    ['config', '服务集成', 'LLM / AI 监测四平台 / 图像生成 / 对象存储 / 发布模式'],
    ['licenses', '卡密管理', '生成套餐卡密，线下收款后交付客户兑换'],
    ['audit', '操作审计', '全部登录与写操作留痕'],
  ];
  return `<div class="notice" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
    <span class="kv" style="margin-right:4px">系统设置：</span>
    ${tabs.map(([k, name, desc]) => `<a class="btn small ${k === active ? '' : 'ghost'}" href="/settings/${k}" title="${desc}">${name}</a>`).join('')}
    ${extra}
  </div>`;
}

function requireAdmin(c) {
  if (!c.user || c.user.role !== 'admin') {
    c.notFound();
    return false;
  }
  return true;
}

function renderConfigPage(c, notices = '') {
  loadSettings();
  const groups = {};
  for (const item of CONFIG_SCHEMA) {
    (groups[item.group] = groups[item.group] || []).push(item);
  }
  const groupsHtml = Object.entries(groups)
    .map(([gid, items]) => {
      const meta = GROUP_META[gid] || { title: gid, desc: '' };
      const fields = items
        .map((item) => {
          const cur = settingsValue(item.key);
          let field;
          if (item.type === 'enum') {
            field = `<select name="${item.key}">${item.options
              .map(([k, v]) => `<option value="${k}" ${String(cur) === String(k) ? 'selected' : ''}>${esc(v)}</option>`)
              .join('')}</select>`;
          } else if (item.type === 'secret') {
            field = `<input type="password" name="${item.key}" value="" placeholder="${cur ? `已配置（${esc(maskSecret(cur))}）· 留空保持不变` : esc(item.placeholder || '未配置')}">`;
          } else {
            field = `<input type="text" name="${item.key}" value="${esc(cur)}" placeholder="${esc(item.placeholder || '')}">`;
          }
          return `<div class="row"><div style="flex:2"><label class="f">${esc(item.label)}${item.boot ? ' <span class="badge b-warn">重启生效</span>' : ''}</label>${field}</div></div>${item.desc ? `<div class="kv" style="margin:-4px 0 6px">${esc(item.desc)}</div>` : ''}`;
        })
        .join('');
      const testBtns =
        gid === 'llm'
          ? '<button class="btn ghost small" formaction="/settings/config/test" name="group" value="llm">测试 LLM 连通</button>'
          : '';
      const monitorTests =
        gid === 'monitor'
          ? [1, 2, 3, 4]
              .map(
                (p) =>
                  `<button class="btn ghost small" formaction="/settings/config/test" name="group" value="monitor:${p}">测试${['豆包', 'DeepSeek', '元宝', '通义'][p - 1]}</button>`
              )
              .join(' ')
          : '';
      const s3Test =
        gid === 'storage'
          ? '<button class="btn ghost small" formaction="/settings/config/test" name="group" value="s3">测试对象存储</button>'
          : '';
      return `<div class="card"><h2>${esc(meta.title)}</h2><div class="kv" style="margin-bottom:10px">${esc(meta.desc)}</div>
      <form method="post" action="/settings/config/save">${fields}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn">保存本组</button>
          ${testBtns}${monitorTests}${s3Test}
        </div>
      </form></div>`;
    })
    .join('');
  c.body =
    pageHead('服务集成（真实化开关）', '真实化能力的全部开关与凭证。保存后立即生效（标注「重启生效」的除外）。密钥脱敏显示，仅管理员可见。') +
    settingsNav('config') +
    notices +
    groupsHtml;
  c.render('系统配置', 'config');
}

route('GET', /^\/settings\/config$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  renderConfigPage(c);
});

route('POST', /^\/settings\/config\/save$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  const r = saveSettings(c.body);
  const msg = r.ok
    ? `?saved=${encodeURIComponent(r.saved.join('、') || '（无变更）')}`
    : `?error=${encodeURIComponent(r.errors.join('；'))}`;
  res.writeHead(302, { Location: `/settings/config${msg}` });
  res.end();
});

route('POST', /^\/settings\/config\/test$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  const group = String(c.body.group || '');
  try {
    let msg;
    if (group === 'llm') {
      const llm = await import('../providers/llm.js');
      msg = await llm.testLlm();
    } else if (group.startsWith('monitor:')) {
      const mon = await import('../providers/monitor.js');
      msg = await mon.testMonitor(group.split(':')[1]);
    } else if (group === 's3') {
      const st = await import('../providers/storage.js');
      msg = await st.testS3();
    } else {
      throw new Error('未知测试组');
    }
    res.writeHead(302, { Location: `/settings/config?test=${encodeURIComponent('✅ ' + msg)}` });
  } catch (err) {
    res.writeHead(302, { Location: `/settings/config?test=${encodeURIComponent('❌ ' + err.message)}` });
  }
  res.end();
});

route('GET', /^\/settings\/audit$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  const rows = q('SELECT * FROM auditLog ORDER BY createdAt DESC LIMIT 200');
  c.body =
    pageHead('操作审计日志', '全部登录与写操作留痕（保留 90 天，由每日运维脚本自动清理）。脱敏字段以 *** 显示。') +
    settingsNav('audit') +
    card('最近 200 条', table(['时间', '账号', '操作', '目标/内容', 'IP'], rows.map((r) => `
      <tr><td class="kv">${ft(r.createdAt)}</td><td>${e(r.email || '—')}</td>
      <td><b>${e(r.action)}</b></td><td class="wrap kv">${e(r.target || '')}</td><td class="kv mono">${e(r.ip || '')}</td></tr>`)));
  c.render('操作审计', 'config');
});

// ============ 团队（组织成员与配额，P1）============
const ROLE_NAMES = { owner: '所有者', manager: '管理者', operator: '操作员', viewer: '只读' };

route('GET', /^\/team$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  const role = memberRole(orgId, c.user.id);
  const members = q(
    `SELECT om.id, om.role, om.createdAt, u.email FROM orgMembers om JOIN users u ON om.userId=u.id WHERE om.orgId=? ORDER BY om.createdAt`,
    orgId
  );
  const org = q1('SELECT * FROM orgs WHERE id=?', orgId);
  const month = new Date().toISOString().slice(0, 7);
  const usage = q('SELECT type, SUM(count) as n FROM usageCounters WHERE orgId=? AND day LIKE ? GROUP BY type', orgId, `${month}%`);
  const isOwner = role === 'owner';
  c.body =
    pageHead('团队成员', `组织：${org.name} ｜ 你的角色：${ROLE_NAMES[role] || role}`) +
    (c.query.saved ? '<div class="notice">✅ 已保存</div>' : '') +
    (c.query.e ? `<div class="notice warn">${e(c.query.e)}</div>` : '') +
    card(`成员（${members.length}）`, table(['邮箱', '角色', '加入时间', ''], members.map((m) => `
      <tr><td>${e(m.email)}</td>
      <td>${badge(ROLE_NAMES[m.role] || m.role)}</td><td class="kv">${ft(m.createdAt)}</td>
      <td>${isOwner && m.role !== 'owner' ? `
        <form method="post" action="/team/role" class="inline" style="margin-right:6px">
          <input type="hidden" name="memberId" value="${m.id}">
          ${sel('role', Object.entries(ROLE_NAMES).filter(([k]) => k !== 'owner').map(([k, v]) => [k, v]), m.role)}
          <button class="btn small ghost">改角色</button>
        </form>
        <form method="post" action="/team/remove" class="inline" onsubmit="return confirm('确认移除该成员？')">
          <input type="hidden" name="memberId" value="${m.id}"><button class="btn small danger">移除</button>
        </form>` : ''}</td></tr>`))) +
    (isOwner
      ? card('邀请成员（须已注册）', `
        <form method="post" action="/team/invite" class="row">
          <div style="flex:2"><label class="f">成员邮箱（须已在本平台注册）</label><input type="email" name="email" required></div>
          <div><label class="f">角色</label>${sel('role', [['manager', '管理者'], ['operator', '操作员'], ['viewer', '只读']], 'operator')}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn">添加</button></div>
        </form>
        <div class="kv" style="margin-top:6px">角色说明：管理者=业务全部（不含成员/系统配置）；操作员=日常操作；只读=仅查看。注册关闭时先由管理员为成员开号。</div>`) +
        card('订阅套餐', (() => {
          const org = q1('SELECT * FROM orgs WHERE id=?', orgId);
          const active = org.planCode && org.planExpiresAt && new Date(org.planExpiresAt) > new Date();
          return `<div class="kv">当前套餐：<b>${active ? PLANS[org.planCode].name : '未订阅（自部署/不限量）'}</b>${active ? `，有效期至 ${org.planExpiresAt.slice(0, 10)}` : ''}</div>
          <form method="post" action="/team/redeem" class="row" style="margin-top:8px">
            <div style="flex:2"><label class="f">卡密兑换（线下收款后交付的卡密）</label><input type="text" name="key" placeholder="GEO-BASIC-XXXX-XXXX-XXXX" required></div>
            <div style="flex:0;align-self:flex-end"><button class="btn">兑换开通</button></div>
          </form>`;
        })()) +
        card('事件通知', `
          <div class="kv">监测完成、发布完成时推送到你的 Webhook（企微机器人/自建系统均可）。</div>
          <form method="post" action="/team/notify" class="row" style="margin-top:8px">
            <div style="flex:2"><label class="f">Webhook 地址</label><input type="text" name="notifyWebhook" value="${e(q1('SELECT notifyWebhook FROM orgs WHERE id=?', orgId)?.notifyWebhook || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"></div>
            <div style="flex:0;align-self:flex-end"><button class="btn">保存</button></div>
          </form>`) +
        card('用量与配额', `
          <table><tr><th>本月用量</th><th>次数</th></tr>
          ${usage.map((u) => `<tr><td>${e(u.type)}</td><td><b>${u.n}</b></td></tr>`).join('') || '<tr><td colspan="2" class="kv">本月暂无调用</td></tr>'}
          </table>
          <form method="post" action="/team/quota" class="row" style="margin-top:10px">
            <div><label class="f">监测调用月配额（0 = 不限制）</label><input type="number" name="quotaMonitorMonthly" value="${org.quotaMonitorMonthly}"></div>
            <div style="flex:0;align-self:flex-end"><button class="btn">保存配额</button></div>
          </form>`)
      : '');
  c.render('团队成员', 'team');
});

route('POST', /^\/team\/invite$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  const org0 = q1('SELECT * FROM orgs WHERE id=?', orgId);
  const memberCount = q1('SELECT COUNT(*) as n FROM orgMembers WHERE orgId=?', orgId).n;
  if (org0.planCode && Number(org0.planExpiresAt) > Date.now() && memberCount >= Number(PLANS[org0.planCode].maxMembers)) {
    res.writeHead(302, { Location: '/team?e=' + encodeURIComponent(`当前套餐（${PLANS[org0.planCode].name}）成员上限 ${PLANS[org0.planCode].maxMembers} 人，请升级套餐`) });
    return res.end();
  }
  const target = q1('SELECT id FROM users WHERE email=?', c.body.email);
  if (!target) {
    res.writeHead(302, { Location: '/team?e=' + encodeURIComponent(`邮箱 ${c.body.email} 尚未注册：请先由管理员为其创建账号，再邀请`) });
    return res.end();
  }
  if (q1('SELECT id FROM orgMembers WHERE orgId=? AND userId=?', orgId, target.id)) {
    res.writeHead(302, { Location: '/team?e=' + encodeURIComponent('该成员已在团队中') });
    return res.end();
  }
  insert('orgMembers', { id: id(), orgId, userId: target.id, role: ['manager', 'operator', 'viewer'].includes(c.body.role) ? c.body.role : 'operator', createdAt: nowIso() });
  audit(target.id, c.body.email, 'team.invite', `role=${c.body.role}`, c.ip);
  res.writeHead(302, { Location: '/team?saved=1' });
  res.end();
});

route('POST', /^\/team\/role$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  const m = q1('SELECT * FROM orgMembers WHERE id=? AND orgId=?', c.body.memberId, orgId);
  if (m && m.role !== 'owner' && ['manager', 'operator', 'viewer'].includes(c.body.role)) {
    run('UPDATE orgMembers SET role=? WHERE id=?', c.body.role, m.id);
    audit(m.userId, '', 'team.role', `-> ${c.body.role}`, c.ip);
  }
  res.writeHead(302, { Location: '/team?saved=1' });
  res.end();
});

route('POST', /^\/team\/remove$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  const m = q1('SELECT * FROM orgMembers WHERE id=? AND orgId=?', c.body.memberId, orgId);
  if (m && m.role !== 'owner') {
    run('DELETE FROM orgMembers WHERE id=?', m.id);
    audit(m.userId, '', 'team.remove', '', c.ip);
  }
  res.writeHead(302, { Location: '/team?saved=1' });
  res.end();
});

route('POST', /^\/team\/redeem$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  try {
    const r = redeemLicenseKey(orgId, c.user.id, c.body.key);
    res.writeHead(302, { Location: `/team?saved=${encodeURIComponent(`已开通 ${r.planName}，有效期至 ${r.planExpiresAt.slice(0, 10)}`)}` });
  } catch (e) {
    res.writeHead(302, { Location: `/team?e=${encodeURIComponent(e.message)}` });
  }
  res.end();
});

route('POST', /^\/team\/quota$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  run('UPDATE orgs SET quotaMonitorMonthly=? WHERE id=?', Math.max(0, Number(c.body.quotaMonitorMonthly) || 0), orgId);
  res.writeHead(302, { Location: '/team?saved=1' });
  res.end();
});

route('POST', /^\/team\/notify$/, async (req, res, c) => {
  const orgId = primaryOrgId(c.user.id, c.user.email);
  if (memberRole(orgId, c.user.id) !== 'owner') return c.notFound();
  run('UPDATE orgs SET notifyWebhook=?, notifyEvents=? WHERE id=?', c.body.notifyWebhook || '', JSON.stringify(['monitor.done', 'publish.done']), orgId);
  res.writeHead(302, { Location: '/team?saved=1' });
  res.end();
});

// 卡密管理（管理员）
route('GET', /^\/settings\/licenses$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  const keys = q('SELECT * FROM licenseKeys ORDER BY createdAt DESC LIMIT 100');
  const show = c.query.generated ? JSON.parse(decodeURIComponent(c.query.generated)) : null;
  c.body =
    pageHead('卡密管理', '生成套餐卡密 → 线下收款后交付客户 → 客户在「团队成员」页兑换开通。无需在线支付接口。') +
    settingsNav('licenses') +
    (show ? `<div class="notice"><b>新卡密（只显示这一次，请复制交付客户）：</b><div class="keybox" style="margin-top:8px">${show.map(e).join('<br>')}</div></div>` : '') +
    card('生成卡密', `
      <form method="post" action="/settings/licenses/generate" class="row">
        <div><label class="f">套餐</label>${sel('planCode', Object.entries(PLANS).map(([k, v]) => [k, `${v.name}（${v.price}，${v.durationDays} 天，监测 ${v.monitorQuotaMonthly} 次/月）`]))}</div>
        <div><label class="f">数量</label><input type="number" name="count" value="1" min="1" max="100"></div>
        <div><label class="f">备注</label><input type="text" name="note" placeholder="如：客户名称"></div>
        <div style="flex:0;align-self:flex-end"><button class="btn">生成</button></div>
      </form>`) +
    card('卡密列表（最近 100）', table(['卡密', '套餐', '状态', '使用组织', '备注'], keys.map((k) => `
      <tr><td class="mono">${e(k.key)}</td><td>${badge(PLANS[k.planCode]?.name || k.planCode)}</td>
      <td>${k.status === 'unused' ? '<span class="badge b-ok">未使用</span>' : k.status === 'used' ? '<span class="badge b-gray">已使用</span>' : '<span class="badge b-bad">已作废</span>'}</td>
      <td class="kv">${k.usedByOrg ? e((q1('SELECT name FROM orgs WHERE id=?', k.usedByOrg) || {}).name || '') : '—'}</td>
      <td class="kv">${e(k.note || '')}</td></tr>`)));
  c.render('卡密管理', 'config');
});

route('POST', /^\/settings\/licenses\/generate$/, async (req, res, c) => {
  if (!requireAdmin(c)) return;
  const keys = generateLicenseKeys(c.body.planCode, c.body.count, c.body.note);
  res.writeHead(302, { Location: `/settings/licenses?generated=${encodeURIComponent(JSON.stringify(keys))}` });
  res.end();
});

// ============ 报告导出（终局-B）============
route('GET', /^\/reports\/([a-f0-9-]+)\/export$/, async (req, res, c) => {
  const r = q1('SELECT * FROM reports WHERE id=?', c.params[0]);
  if (!r) return c.notFound();
  const p = svc.getProjectSafe(c.user.id, r.projectId);
  if (!p) return c.notFound();
  if (c.query.format === 'md') {
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${r.id.slice(0, 8)}.md"`,
    });
    return res.end(`# ${r.title}\n\n${r.content}\n`);
  }
  // 白标打印页：无平台品牌，含客户品牌与日期，浏览器打印即为 PDF
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(r.title)}</title>
  <style>body{font-family:-apple-system,"PingFang SC",sans-serif;max-width:820px;margin:0 auto;padding:40px;color:#1a2233;line-height:1.7}
  h1{font-size:22px;border-bottom:2px solid #4f46e5;padding-bottom:8px}.meta{color:#6b7280;font-size:13px;margin-bottom:24px}
  pre{white-space:pre-wrap;font-family:inherit;font-size:14px}.brand{position:fixed;top:16px;right:24px;font-weight:700;color:#4f46e5}
  @media print{.noprint{display:none}}</style></head><body>
  <div class="brand">${e(p.brandName || p.name)}</div>
  <h1>${e(r.title)}</h1>
  <div class="meta">报告日期：${r.createdAt.slice(0, 10)} ｜ 客户：${e(p.brandName || p.name)} ｜ 本报告由 GEO 优化系统生成，数据截至报告日期</div>
  <pre>${e(r.content)}</pre>
  <p class="noprint" style="margin-top:24px"><button onclick="print()" style="padding:8px 18px;border:0;border-radius:8px;background:#4f46e5;color:#fff;cursor:pointer">打印 / 另存为 PDF</button>
  <a href="/reports/${r.id}" style="margin-left:10px;color:#4f46e5">返回</a> ·
  <a href="/reports/${r.id}/export?format=md" style="color:#4f46e5">下载 Markdown</a></p>
  </body></html>`);
});

// ============ 报告 ============
route('GET', /^\/projects\/([a-f0-9-]+)\/reports$/, async (req, res, c) => {
  const p = svc.getProjectSafe(c.user.id, c.params[0]);
  if (!p) return c.notFound();
  const rows = q('SELECT * FROM reports WHERE projectId=? ORDER BY createdAt DESC', p.id);
  const tasks = q('SELECT * FROM monitorTasks WHERE projectId=? ORDER BY createdAt DESC', p.id);
  const questions = q('SELECT * FROM questions WHERE projectId=? AND withBrand=0 LIMIT 20', p.id);
  c.body =
    pageHead('诊断报告 / 监测报告', '分析品牌表现、平台偏好和引用源差距；关键词频次是逆向分析工具，不是 AI 平台公开的权重。') +
    card('生成报告', `
      <div class="row">
        <form method="post" action="/projects/${p.id}/reports/create" class="inline">
          <input type="hidden" name="type" value="1"><button class="btn">品牌诊断报告</button>
        </form>
        <form method="post" action="/projects/${p.id}/reports/create" class="inline">
          <input type="hidden" name="type" value="2"><button class="btn ghost">产品推荐诊断报告</button>
        </form>
        <form method="post" action="/projects/${p.id}/reports/create" class="inline">
          <input type="hidden" name="type" value="5"><button class="btn ghost">AI 现状一页纸诊断</button>
        </form>
      </div>
      <div class="row" style="margin-top:12px">
        <form method="post" action="/projects/${p.id}/reports/create" class="row" style="width:100%">
          <input type="hidden" name="type" value="3">
          <div><label class="f">优化前任务</label>${sel('taskIdA', tasks.map((t) => [t.id, `${ft(t.createdAt)} (${t.id.slice(0, 8)})`]), '', '— 选择 —')}</div>
          <div><label class="f">优化后任务</label>${sel('taskIdB', tasks.map((t) => [t.id, `${ft(t.createdAt)} (${t.id.slice(0, 8)})`]), '', '— 选择 —')}</div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">生成优化前后对比</button></div>
        </form>
      </div>
      <div class="row" style="margin-top:12px">
        <form method="post" action="/projects/${p.id}/reports/create" class="row" style="width:100%">
          <input type="hidden" name="type" value="4">
          <div style="flex:2"><label class="f">逆向分析问题</label>${sel('question', questions.map((x) => [x.text, x.text]), '', '— 选择不带品牌名的问题 —')}</div>
          <div><label class="f">平台</label>${sel('platform', Object.entries(ENUMS.AI_PLATFORM).map(([k, v]) => [k, v]), 1)}</div>
          <div><label class="f">重复次数</label><input type="number" name="times" value="10"></div>
          <div style="flex:0;align-self:flex-end"><button class="btn ghost">运行逆向分析（重复提问 N 次）</button></div>
        </form>
      </div>
      <div class="kv" style="margin-top:8px">对比必须保持同一问题、同一 AI 平台、相近监测条件；不同问题或平台的结果不能直接对比。</div>`) +
    (rows.length ? '' : emptyCta('还没有报告——生成品牌诊断或一页纸诊断（商务拜访直接可用）', `javascript:void(0)`, '↑ 往上看生成入口')) +
    card('报告列表', table(['时间', '类型', '标题', ''], rows.map((r) => `
      <tr><td>${ft(r.createdAt)}</td><td>${badge(ENUMS.REPORT_TYPE[r.type])}</td>
      <td class="wrap"><a href="/reports/${r.id}"><b>${e(r.title)}</b></a></td>
      <td><a class="btn small" href="/reports/${r.id}">查看</a></td></tr>`)));
  c.render('诊断报告', 'reports', p.id);
});

route('POST', /^\/projects\/([a-f0-9-]+)\/reports\/create$/, async (req, res, c) => {
  try {
    const report = await svc.createReport(c.params[0], c.body);
    res.writeHead(302, { Location: `/reports/${report.id}` });
  } catch (err) {
    res.writeHead(302, { Location: `/projects/${c.params[0]}/reports?e=` + encodeURIComponent(err.message) });
  }
  res.end();
});

route('GET', /^\/reports\/([a-f0-9-]+)$/, async (req, res, c) => {
  const r = q1('SELECT * FROM reports WHERE id=?', c.params[0]);
  if (!r) return c.notFound();
  const p = svc.getProjectSafe(c.user.id, r.projectId);
  if (!p) return c.notFound();
  c.body =
    pageHead(r.title, `${badge(ENUMS.REPORT_TYPE[r.type])} · ${ft(r.createdAt)}`, `<a class="btn" href="/reports/${r.id}/export" target="_blank">白标导出 / PDF</a> <a class="btn ghost" href="/reports/${r.id}/export?format=md">Markdown</a> <a class="btn ghost" href="/projects/${p.id}/reports">返回</a>`) +
    card('', `<div class="md-box md">${e(r.content)}</div>`);
  c.render('报告详情', 'reports', p.id);
});

// ============ 系统设置 → Open Key ============
route('GET', /^\/settings\/keys$/, async (req, res, c) => {
  const rows = q('SELECT * FROM openKeys WHERE userId=? ORDER BY createdAt DESC', c.user.id);
  const projects = q(
    `SELECT p.id, p.name FROM projects p JOIN companies c ON p.companyId=c.id WHERE c.ownerUserId=?`,
    c.user.id
  );
  c.body =
    pageHead('API 密钥（Open Key）', '接口密钥只写入本地配置，不要发到群里、聊天窗口或公开仓库。Skills 完成初始化后，还需确认默认公司和产品。') +
    settingsNav('keys') +
    (c.query.created ? `<div class="notice"><b>密钥只显示这一次，请立即复制：</b><div class="keybox" style="margin-top:8px">${e(c.query.created)}</div>请通过 <span class="mono">geo auth login</span> 在本机录入，不要在聊天中输出。</div>` : '') +
    card('创建接口密钥', `
      <form method="post" action="/settings/keys/create">
        <div class="row">
          <div><label class="f">密钥名称</label><input type="text" name="name" value="AI 助手密钥"></div>
          <div style="flex:2"><label class="f">授权项目（可多选）*</label>
            <select name="projectIds" multiple size="4" required>${projects.map((x) => `<option value="${x.id}">${e(x.name)}</option>`).join('')}</select>
          </div>
          <div style="flex:0;align-self:flex-end"><button class="btn">创建密钥</button></div>
        </div>
      </form>`) +
    card('我的密钥', table(['名称', '前缀', '授权项目数', '绑定设备', '最近使用', '状态', ''], rows.map((r) => `
      <tr><td>${e(r.name)}</td><td class="mono">${e(r.keyPrefix)}…</td>
      <td>${parseJsonSafe(r.authorizedProjectIds, []).length}</td>
      <td class="kv mono">${r.boundDeviceId ? e(r.boundDeviceId.slice(0, 8)) : '未绑定'}</td>
      <td class="kv">${r.lastUsedAt ? ft(r.lastUsedAt) : '从未使用'}</td>
      <td>${r.revokedAt ? badge('已过期') : badge('已授权')}</td>
      <td>${r.revokedAt ? '' : `<form method="post" action="/settings/keys/revoke" class="inline" onsubmit="return confirm('确认吊销该密钥？使用它的 Skills 将立即失效。')">
        <input type="hidden" name="keyId" value="${r.id}"><button class="btn small danger">吊销</button></form>`}</td></tr>`)));
  c.render('Open Key', 'keys');
});

route('POST', /^\/settings\/keys\/create$/, async (req, res, c) => {
  const ids = [].concat(c.body.projectIds || []).filter(Boolean);
  if (!ids.length) {
    res.writeHead(302, { Location: '/settings/keys' });
    return res.end();
  }
  const { key } = svc.createOpenKey(c.user.id, { name: c.body.name, authorizedProjectIds: ids });
  res.writeHead(302, { Location: `/settings/keys?created=${encodeURIComponent(key)}` });
  res.end();
});

route('POST', /^\/settings\/keys\/revoke$/, async (req, res, c) => {
  svc.revokeOpenKey(c.user.id, c.body.keyId);
  res.writeHead(302, { Location: '/settings/keys' });
  res.end();
});
