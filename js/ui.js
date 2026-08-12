// ============ views, modals, actions ============

import {
  state, update, uid, newTask, ensureDay, ensureWeek,
  activeGoals, goalById, goalColor, currentMilestone, quadrantOf, QUAD_LABEL, taskMinutes,
  todayKey, addDays, fmtDay, fmtShort, weekLabel, weekDays, thisWeekKey, shiftWeek, weekStart,
  dayStats, weekStats, weekGoalMinutes, reviewStreak, unfinishedYesterday, hasAnyData,
  computeSignals, monthKeyOf, fmtMonth, exportJSON, importJSON, wipeAll, seedDemo,
  AREAS, HORIZONS, dateKey,
} from './store.js';
import {
  hasKey, MODELS, EFFORTS, aiPlanDay, planDayPrompt, aiPlanWeek, planWeekPrompt,
  aiDecomposeGoal, aiReviewDay, reviewDayPrompt, aiWeekSummary, weekSummaryPrompt,
  aiMonthSummary, aiInsight, insightPrompt, aiChat, testConnection,
} from './ai.js';
import { buildContext, contextMeta } from './context.js';
import { q2TrendChart } from './charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoursStr = (min) => {
  const h = min / 60;
  return (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)) + 'h';
};

let currentView = 'today';
let curWeek = thisWeekKey();
let focusQuickAdd = false;

// ---------- toast ----------

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- modal ----------

let modalRender = null;
let modalMount = null;

function openModal(renderFn, mountFn = null) {
  modalRender = renderFn;
  modalMount = mountFn;
  paintModal();
}
function refreshModal() { if (modalRender) paintModal(); }
function closeModal() {
  modalRender = null; modalMount = null;
  if (chatAbort) { chatAbort.abort(); chatAbort = null; }
  $('#modal-root').innerHTML = '';
}
function paintModal() {
  const root = $('#modal-root');
  if (!modalRender) { root.innerHTML = ''; return; }
  root.innerHTML = `<div class="overlay" data-action="overlay-close"><div class="modal">${modalRender()}</div></div>`;
  if (modalMount) modalMount();
}

// ---------- shared components ----------

function goalChip(task) {
  const g = task.goalId ? goalById(task.goalId) : null;
  if (!g) return `<button class="chip" data-action="open-task" data-id="${task.id}">○ 关联目标</button>`;
  return `<button class="chip" data-action="open-task" data-id="${task.id}" style="--gc:${goalColor(g)}"><span class="dot"></span>${esc(g.title.length > 12 ? g.title.slice(0, 12) + '…' : g.title)}</button>`;
}

function quadChip(task) {
  const q = quadrantOf(task);
  return `<span class="chip quad q${q}">${QUAD_LABEL[q]}</span>`;
}

function taskRow(t, dayKey) {
  const timeBits = [];
  if (t.blockStart) timeBits.push(t.blockStart);
  timeBits.push(`${taskMinutes(t)}分`);
  return `<div class="task ${t.done ? 'done' : ''}">
    <button class="check" data-action="toggle-task" data-day="${dayKey}" data-id="${t.id}" title="完成">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
    <div class="task-main">
      <div class="task-title" data-action="open-task" data-id="${t.id}" data-day="${dayKey}">${esc(t.title)}</div>
      <div class="task-meta">${goalChip(t)}${quadChip(t)}<span class="chip">${timeBits.join(' · ')}</span></div>
    </div>
    <button class="mit-star ${t.mit ? 'on' : ''}" data-action="toggle-mit" data-day="${dayKey}" data-id="${t.id}" title="今日要事（最多 3 件）">★</button>
  </div>`;
}

function signalChips(levelFilter = null, max = 2) {
  let sigs = computeSignals();
  if (levelFilter) sigs = sigs.filter((s) => s.level === levelFilter);
  sigs = sigs.slice(0, max);
  if (!sigs.length) return '';
  return sigs.map((s) => `<div class="banner ${s.level === 'warn' ? '' : 'calm'}"><span>${s.level === 'warn' ? '⚠' : '·'}</span><span>${esc(s.text)}</span></div>`).join('');
}

function aiGate(purpose, hint) {
  // 无 Key 时的优雅降级：复制完整上下文+指令，粘贴给任何 AI
  return `<div class="ai-card">
    <div class="ai-tag">✦ AI 助手</div>
    <div class="small" style="color:var(--ink-2)">${esc(hint)}还没有设置 API Key——你可以：</div>
    <div class="btn-row mt8">
      <button class="btn small" data-action="open-settings">去设置 Key</button>
      <button class="btn small" data-action="copy-prompt" data-purpose="${purpose}">复制上下文，粘贴给任意 AI</button>
    </div>
  </div>`;
}

function ctxPreview(promptText) {
  return `<details class="ctx-preview"><summary>查看将发送给 AI 的完整上下文（${contextMeta(promptText)}）</summary><pre>${esc(promptText)}</pre></details>`;
}

// ---------- render root ----------

export function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === currentView));
  const badge = $('.inbox-badge');
  if (badge) {
    badge.hidden = state.inbox.length === 0;
    badge.textContent = state.inbox.length;
  }
  const view = $('#view');
  if (currentView === 'today') view.innerHTML = renderToday();
  else if (currentView === 'week') view.innerHTML = renderWeek();
  else if (currentView === 'goals') view.innerHTML = renderGoals();
  else view.innerHTML = renderReview();

  if (focusQuickAdd) {
    focusQuickAdd = false;
    requestAnimationFrame(() => $('.quick-add input')?.focus());
  }
}

// ================= TODAY =================

function renderToday() {
  const tk = todayKey();
  const day = state.days[tk];
  const tasks = day ? day.tasks.filter((t) => !t.dropped) : [];
  const streak = reviewStreak();

  if (!hasAnyData()) return welcomeCard();

  let html = `<div class="page-head"><h1>${fmtDay(tk)}</h1><div class="sub">${streak > 0 ? `复盘连续 ${streak} 天` : '今天也从要事开始'}</div></div>`;

  html += signalChips('warn', 2);
  html += carryoverCard();

  if (!day?.plannedAt && tasks.length === 0) {
    html += `<div class="card"><div class="card-title">开始今天</div>
      <div class="small" style="color:var(--ink-2)">用 1 分钟把今天安排好：先定最多 3 件要事，落到时间块。</div>
      <div class="btn-row mt12">
        <button class="btn primary" data-action="plan-open">☀ 计划今天</button>
        <button class="btn" data-action="focus-quick-add">直接添加任务</button>
      </div></div>`;
  }

  // 时间轴
  const blocked = tasks.filter((t) => t.blockStart).sort((a, b) => a.blockStart.localeCompare(b.blockStart));
  if (blocked.length) {
    const rows = [];
    if (state.profile.wake) rows.push(`<div class="tl-row anchor"><span class="tl-time">${state.profile.wake}</span><span>起床</span></div>`);
    for (const t of blocked) {
      const g = t.goalId ? goalById(t.goalId) : null;
      rows.push(`<div class="tl-row ${t.done ? 'done' : ''}" data-action="open-task" data-id="${t.id}" data-day="${tk}"${g ? ` title="目标：${esc(g.title)}"` : ''}>
        <span class="tl-time">${t.blockStart}</span>
        ${g ? `<span class="dot" style="--gc:${goalColor(g)};background:${goalColor(g)}"></span>` : ''}
        <span class="tl-title">${esc(t.title)}</span>
        <span class="tl-dur">${taskMinutes(t)}分</span>
      </div>`);
    }
    if (state.profile.sleep) rows.push(`<div class="tl-row anchor"><span class="tl-time">${state.profile.sleep}</span><span>就寝</span></div>`);
    html += `<div class="card"><div class="card-title">今日时间轴</div><div class="timeline">${rows.join('')}</div></div>`;
  }

  // 任务
  const mits = tasks.filter((t) => t.mit);
  const others = tasks.filter((t) => !t.mit);
  const sortTasks = (arr) => [...arr].sort((a, b) => (a.done - b.done));
  html += `<div class="card">`;
  if (mits.length) {
    html += `<div class="section-label"><span class="star">★</span> 今日要事</div><div class="task-list">${sortTasks(mits).map((t) => taskRow(t, tk)).join('')}</div>`;
  }
  if (others.length) {
    html += `<div class="section-label">其他任务</div><div class="task-list">${sortTasks(others).map((t) => taskRow(t, tk)).join('')}</div>`;
  }
  if (!tasks.length) {
    html += `<div class="empty"><div class="empty-title">今天还没有任务</div>点右下输入框直接添加，或用「计划今天」</div>`;
  }
  html += `<div class="quick-add"><input type="text" placeholder="添加任务，回车确认" data-enter="qa-add">
    <button class="btn small" data-action="plan-open" title="让 AI 结合目标与作息安排今天">☀ AI 安排</button></div></div>`;

  // 晚间复盘
  html += reviewDayCard(tk);
  return html;
}

function welcomeCard() {
  return `<div class="card welcome">
    <h2>把时间花在重要的事上</h2>
    <ol>
      <li><b>定方向</b>：写下少数几个真正重要的目标，AI 帮你从伟大目标分解到里程碑。</li>
      <li><b>每周选要事</b>：周日 15 分钟，为每个目标预留时间（先付给重要不紧急的事）。</li>
      <li><b>每天三件事</b>：早上 1 分钟排进时间块，晚上 2 分钟复盘。复盘会成为系统的长期记忆。</li>
    </ol>
    <div class="btn-row">
      <button class="btn primary" data-action="goal-new">创建第一个目标</button>
      <button class="btn" data-action="demo-load">先看看示例数据</button>
      <button class="btn ghost" data-action="open-settings">设置 AI（可选）</button>
    </div>
  </div>`;
}

function carryoverCard() {
  const { key, tasks } = unfinishedYesterday();
  if (!tasks.length) return '';
  const rows = tasks.map((t) => `<div class="task" style="border:none;padding:6px 0">
    <div class="task-main"><div class="task-title">${esc(t.title)}</div></div>
    <div class="btn-row">
      <button class="btn small" data-action="carry-today" data-day="${key}" data-id="${t.id}">移到今天</button>
      <button class="btn small ghost" data-action="carry-inbox" data-day="${key}" data-id="${t.id}">收集箱</button>
      <button class="btn small ghost" data-action="carry-drop" data-day="${key}" data-id="${t.id}">放弃</button>
    </div></div>`).join('');
  return `<div class="card"><div class="card-title">昨天未完成 · ${tasks.length} 件</div>${rows}</div>`;
}

let reviewAIState = { loading: false, error: null };

function reviewDayCard(tk) {
  const day = state.days[tk];
  const s = dayStats(tk);
  const stats = s.total ? `完成 ${s.done}/${s.total}${s.q2Share != null ? ` · 重要不紧急占比 ${(s.q2Share * 100).toFixed(0)}%` : ''}${s.doneMin ? ` · 共 ${hoursStr(s.doneMin)}` : ''}` : '今天还没有记录';

  if (day?.reviewedAt) {
    return `<div class="card"><div class="card-title">今日复盘 ✓<span class="title-action">${stats}</span></div>
      ${day.reflection ? `<div style="font-size:14.5px">${esc(day.reflection)}</div>` : '<div class="muted small">（没有写反思）</div>'}
      ${day.aiComment ? `<div class="ai-card"><div class="ai-tag">✦ 教练点评</div><div style="font-size:14px;white-space:pre-wrap">${esc(day.aiComment)}</div></div>` : ''}
      <div class="btn-row mt12"><button class="btn small ghost" data-action="review-reopen">重新复盘</button></div>
    </div>`;
  }

  return `<div class="card"><div class="card-title">晚间复盘 · 2 分钟<span class="title-action">${stats}</span></div>
    <div class="field"><textarea data-change="set-reflection" data-day="${tk}" placeholder="今天最有进展的一件事是什么？有什么想留给明天的自己？"
      style="min-height:64px">${esc(day?.reflection || '')}</textarea></div>
    ${day?.aiComment ? `<div class="ai-card" style="margin-top:0;margin-bottom:12px"><div class="ai-tag">✦ 教练点评</div><div style="font-size:14px;white-space:pre-wrap">${esc(day.aiComment)}</div></div>` : ''}
    ${reviewAIState.error ? `<div class="ai-error">${esc(reviewAIState.error)}</div>` : ''}
    <div class="btn-row">
      <button class="btn primary" data-action="review-day-done">完成复盘</button>
      ${hasKey()
        ? `<button class="btn" data-action="review-day-ai" ${reviewAIState.loading ? 'disabled' : ''}>${reviewAIState.loading ? '<span class="spinner"></span> 思考中…' : '✦ 教练点评'}</button>`
        : `<button class="btn ghost small" data-action="copy-prompt" data-purpose="review-day">复制复盘上下文给 AI</button>`}
    </div>
  </div>`;
}

// ================= WEEK =================

function renderWeek() {
  const wk = curWeek;
  const isCurrent = wk === thisWeekKey();
  const week = state.weeks[wk];
  const st = weekStats(wk);

  let html = `<div class="page-head">
    <h1>${weekLabel(wk).split(' · ')[0]} <span class="sub">${weekLabel(wk).split(' · ')[1]}${isCurrent ? ' · 本周' : ''}</span></h1>
    <div class="week-nav">
      <button data-action="week-prev" title="上一周">‹</button>
      <button data-action="week-cur" title="回到本周" style="font-size:12px">今</button>
      <button data-action="week-next" title="下一周">›</button>
    </div></div>`;

  if (isCurrent) html += signalChips('info', 1);

  if (!week?.plannedAt) {
    html += `<div class="card"><div class="card-title">每周规划 · 15 分钟</div>
      <div class="small" style="color:var(--ink-2)">回顾上周 → 定 3-5 件本周要事 → 给每个目标预留时间。这是整个系统最重要的仪式。</div>
      <div class="btn-row mt12"><button class="btn primary" data-action="wiz-open">开始每周规划</button></div></div>`;
  } else {
    // 本周要事
    const prios = week.priorities.map((p) => {
      const g = p.goalId ? goalById(p.goalId) : null;
      return `<div class="task ${p.done ? 'done' : ''}">
        <button class="check" data-action="prio-toggle" data-week="${wk}" data-id="${p.id}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </button>
        <div class="task-main"><div class="task-title">${esc(p.title)}</div>
          <div class="task-meta">${g ? `<span class="chip" style="--gc:${goalColor(g)}"><span class="dot"></span>${esc(g.title)}</span>` : ''}</div></div>
        ${isCurrent && !p.done ? `<button class="btn small ghost" data-action="prio-today" data-week="${wk}" data-id="${p.id}">加到今天</button>` : ''}
      </div>`;
    }).join('');
    html += `<div class="card"><div class="card-title">本周要事 · ${st.priosDone}/${st.priosTotal}${isCurrent ? `<button class="title-action" data-action="wiz-open" style="cursor:pointer">重新规划</button>` : ''}</div><div class="task-list">${prios}</div></div>`;

    // 目标时间预算
    html += goalBudgetCard(wk);
  }

  // 数字摘要
  if (st.tasksTotal > 0) {
    html += `<div class="card"><div class="card-title">本周数字</div>
      <div class="kv"><span class="k">完成任务</span><span class="v">${st.tasksDone} / ${st.tasksTotal}</span></div>
      <div class="kv"><span class="k">投入总时长</span><span class="v">${hoursStr(st.doneMin)}</span></div>
      <div class="kv"><span class="k">重要不紧急占比</span><span class="v">${st.q2Share != null ? (st.q2Share * 100).toFixed(0) + '%' : '—'}</span></div>
      <div class="kv"><span class="k">复盘天数</span><span class="v">${st.daysReviewed} / 7</span></div>
    </div>`;
  }

  // 周复盘
  html += weekReviewCard(wk);
  return html;
}

function goalBudgetCard(wk) {
  const week = state.weeks[wk];
  const invested = weekGoalMinutes(wk);
  const budgets = week?.budgets || {};
  const goals = activeGoals().filter((g) => budgets[g.id] || invested[g.id]);
  if (!goals.length) return '';
  const rows = goals.map((g) => {
    const inv = (invested[g.id] || 0) / 60;
    const bud = budgets[g.id] || 0;
    const pct = bud ? Math.min(1, inv / bud) : (inv > 0 ? 1 : 0);
    return `<div class="goal-bar-row">
      <div class="goal-bar-name"><span class="dot" style="background:${goalColor(g)};width:8px;height:8px;border-radius:50%;flex-shrink:0"></span><span>${esc(g.title)}</span></div>
      <div class="goal-bar-track"><div class="goal-bar-fill ${bud && inv > bud ? 'over' : ''}" style="width:${(pct * 100).toFixed(0)}%"></div>${bud ? `<div class="goal-bar-target" style="left:100%"></div>` : ''}</div>
      <div class="goal-bar-val">${inv.toFixed(1).replace(/\.0$/, '')}${bud ? ` / ${bud}` : ''}h</div>
    </div>`;
  }).join('');
  return `<div class="card"><div class="card-title">目标时间投入<span class="title-action">先付给重要的事</span></div>${rows}</div>`;
}

let weekReviewState = { loading: false, error: null };

function weekReviewCard(wk) {
  const week = state.weeks[wk];
  const rv = week?.review;
  if (rv?.summary) {
    return `<div class="card"><div class="card-title">本周复盘 ✓</div>
      <div style="font-size:14.5px;white-space:pre-wrap">${esc(rv.summary)}</div>
      <div class="btn-row mt12"><button class="btn small ghost" data-action="week-review-open" data-week="${wk}">修改</button></div></div>`;
  }
  const days = weekDays(wk);
  const hasData = days.some((k) => state.days[k]?.tasks.length);
  if (!hasData) return '';
  return `<div class="card"><div class="card-title">本周复盘</div>
    <div class="small" style="color:var(--ink-2)">写一段 80 字的摘要——它会成为系统的长期记忆，未来的每次 AI 建议都会引用它。</div>
    <div class="btn-row mt12"><button class="btn" data-action="week-review-open" data-week="${wk}">写本周复盘</button></div></div>`;
}

// ================= GOALS =================

function renderGoals() {
  const active = state.goals.filter((g) => g.status === 'active');
  const rest = state.goals.filter((g) => g.status !== 'active');
  let html = `<div class="page-head"><h1>目标</h1><button class="btn primary small" data-action="goal-new">＋ 新目标</button></div>`;

  if (active.length > 5) {
    html += `<div class="banner"><span>⚠</span><span>目标太多等于没有目标——考虑暂停一些，聚焦最重要的 3-5 个。</span></div>`;
  }
  if (!active.length && !rest.length) {
    html += `<div class="card"><div class="empty"><div class="empty-title">还没有目标</div>目标定义了什么是「重要」。<br>从一个真正想实现的伟大目标开始，AI 可以帮你分解。</div>
    <div class="btn-row" style="justify-content:center"><button class="btn primary" data-action="goal-new">创建第一个目标</button></div></div>`;
    return html;
  }

  const twk = thisWeekKey();
  const thisMin = weekGoalMinutes(twk);
  html += active.map((g) => goalCard(g, thisMin)).join('');

  if (rest.length) {
    html += `<details class="done-fold"><summary class="section-label" style="margin:16px 2px">已暂停 / 归档 · ${rest.length}</summary>
      ${rest.map((g) => goalCard(g, thisMin)).join('')}</details>`;
  }
  return html;
}

function goalCard(g, thisMin) {
  const ms = currentMilestone(g);
  const msDone = (g.milestones || []).filter((m) => m.done).length;
  const inv = (thisMin[g.id] || 0) / 60;
  const msList = (g.milestones || []).map((m) => `
    <div class="ms-item ${m.done ? 'done' : ''} ${!m.done && ms && m.id === ms.id ? 'current' : ''}" data-action="ms-toggle" data-goal="${g.id}" data-id="${m.id}">
      <span class="ms-check">${m.done ? '✓' : '○'}</span><span>${esc(m.title)}</span>
    </div>`).join('');
  return `<div class="card goal-card ${g.status !== 'active' ? 'paused' : ''}">
    <div class="goal-head">
      <span class="gdot" style="background:${goalColor(g)}"></span>
      <h3>${esc(g.title)}</h3>
      <button class="btn small ghost" data-action="goal-edit" data-id="${g.id}">编辑</button>
    </div>
    ${g.why ? `<div class="goal-why">${esc(g.why)}</div>` : ''}
    <div class="goal-meta">
      <span class="chip">${esc(g.area)}</span><span class="chip">${esc(g.horizon)}</span>
      ${g.weeklyBudgetHours ? `<span class="chip">预算 ${g.weeklyBudgetHours}h/周</span>` : ''}
      <span class="chip ${inv > 0 ? 'q2' : ''}">本周 ${inv.toFixed(1).replace(/\.0$/, '')}h</span>
      ${g.milestones?.length ? `<span class="chip">里程碑 ${msDone}/${g.milestones.length}</span>` : ''}
    </div>
    ${g.milestones?.length ? `<div class="ms-list">${msList}</div>` : ''}
  </div>`;
}

// ================= REVIEW =================

let insightState = { loading: false, error: null };
let monthAIState = { loading: false, error: null };

function renderReview() {
  const twk = thisWeekKey();
  const sThis = weekStats(twk);
  const sLast = weekStats(shiftWeek(twk, -1));
  const streak = reviewStreak();

  let html = `<div class="page-head"><h1>回顾</h1><div class="sub">看见进展，发现模式</div></div>`;

  // 信号
  const sigs = computeSignals();
  if (sigs.length) {
    html += `<div class="card"><div class="card-title">系统观察</div>${sigs.map((s) =>
      `<div class="signal ${s.level}"><span>${s.level === 'warn' ? '⚠' : '·'}</span><span>${esc(s.text)}</span></div>`).join('')}</div>`;
  }

  // 核心指标
  const pct = sThis.q2Share != null ? (sThis.q2Share * 100).toFixed(0) : null;
  const lastPct = sLast.q2Share != null ? (sLast.q2Share * 100).toFixed(0) : null;
  html += `<div class="card">
    <div class="card-title">重要不紧急时间占比<span class="title-action">这个系统的北极星指标</span></div>
    <div class="hero-stat">
      <span class="hero-num">${pct != null ? pct + '%' : '—'}</span>
      <span class="hero-label">本周</span>
      ${lastPct != null ? `<span class="hero-delta">上周 ${lastPct}%${pct != null ? (pct - lastPct >= 0 ? ` · ↑${pct - lastPct}` : ` · ↓${lastPct - pct}`) : ''}</span>` : ''}
    </div>
    <div class="chart-wrap mt12">${q2TrendChart(14)}</div>
    <div class="chart-note">柱高 = 当天完成时长中投给「重要不紧急」的比例。守住它，目标就在推进。</div>
  </div>`;

  // 复盘连续
  const dots = Array.from({ length: 14 }, (_, i) => {
    const k = addDays(todayKey(), -(13 - i));
    return `<span class="sdot ${state.days[k]?.reviewedAt ? 'on' : ''}" title="${fmtShort(k)}"></span>`;
  }).join('');
  html += `<div class="card"><div class="card-title">复盘连续 ${streak} 天</div><div class="streak-dots">${dots}</div></div>`;

  // 目标投入
  html += goalBudgetCard(twk);

  // AI 深度洞察
  html += insightCard();

  // 周复盘历史
  const weekKeys = Object.keys(state.weeks).sort().reverse().slice(0, 8);
  const rvs = weekKeys.filter((wk) => state.weeks[wk]?.review?.summary || state.weeks[wk]?.plannedAt);
  if (rvs.length) {
    html += `<div class="card"><div class="card-title">周复盘历史<span class="title-action">系统的长期记忆</span></div>
      ${rvs.map((wk) => {
        const rv = state.weeks[wk].review;
        return `<div class="review-item"><div class="rw"><span>${weekLabel(wk)}</span>
          <button class="btn small ghost" data-action="week-review-open" data-week="${wk}">${rv?.summary ? '改' : '写'}</button></div>
          <div class="rtext ${rv?.summary ? '' : 'empty-text'}">${rv?.summary ? esc(rv.summary) : '（还没写复盘）'}</div></div>`;
      }).join('')}</div>`;
  }

  // 月度
  html += monthCard();

  // 备份
  const last = state.settings.lastExportAt;
  const staleDays = last ? Math.floor((Date.now() - last) / 864e5) : null;
  html += `<div class="card"><div class="card-title">数据备份<span class="title-action">数据只在这台设备的浏览器里</span></div>
    <div class="small" style="color:var(--ink-2)">${last ? `上次导出：${staleDays === 0 ? '今天' : staleDays + ' 天前'}` : '还没有导出过备份'}${staleDays != null && staleDays > 14 ? ' · 建议每两周导出一次' : ''}</div>
    <div class="btn-row mt8">
      <button class="btn small" data-action="export-data">导出 JSON</button>
      <button class="btn small" data-action="import-pick">导入备份</button>
    </div></div>`;
  return html;
}

function insightCard() {
  const twk = thisWeekKey();
  const ins = findLatestInsight();
  let body = '';
  if (ins) {
    const i = ins.insight;
    body += `<div style="font-size:15px;font-weight:600;margin-bottom:10px">${esc(i.oneLine || '')}</div>`;
    if (i.patterns?.length) {
      body += `<div class="ins-sec"><div class="ins-h">观察到的模式</div>${i.patterns.map((p) =>
        `<div class="ins-item"><b>${esc(p.title)}</b><div class="muted small">${esc(p.evidence)}</div></div>`).join('')}</div>`;
    }
    if (i.bottleneck) {
      body += `<div class="ins-sec"><div class="ins-h">最大瓶颈</div><div class="ins-item"><b>${esc(i.bottleneck.title)}</b><div class="small" style="color:var(--ink-2)">${esc(i.bottleneck.analysis)}</div></div></div>`;
    }
    if (i.leverage?.length) {
      body += `<div class="ins-sec"><div class="ins-h">杠杆点</div>${i.leverage.map((l) => `<div class="ins-item">· ${esc(l)}</div>`).join('')}</div>`;
    }
    if (i.experiment) {
      body += `<div class="ins-sec"><div class="ins-h">下周实验</div><div class="ins-item"><b>${esc(i.experiment.title)}</b><div class="small" style="color:var(--ink-2)">${esc(i.experiment.how)}</div></div></div>`;
    }
    body += `<div class="muted small mt8">生成于 ${new Date(ins.insight.createdAt).toLocaleDateString('zh-CN')} · ${weekLabel(ins.week)}</div>`;
  } else {
    body += `<div class="small" style="color:var(--ink-2)">让 AI 基于你的全部数据做一次第一性原理分析：行为模式 → 最大瓶颈 → 杠杆点 → 下周实验。建议每周做一次。</div>`;
  }
  return `<div class="card"><div class="card-title">✦ 深度洞察</div>${body}
    ${insightState.error ? `<div class="ai-error">${esc(insightState.error)}</div>` : ''}
    <div class="btn-row mt12">
      ${hasKey()
        ? `<button class="btn ${ins ? '' : 'primary'}" data-action="insight-gen" ${insightState.loading ? 'disabled' : ''}>${insightState.loading ? '<span class="spinner"></span> 深度分析中，约需一分钟…' : (ins ? '重新生成本周洞察' : '生成深度洞察')}</button>`
        : `<button class="btn small" data-action="copy-prompt" data-purpose="insight">复制分析上下文给 AI</button>`}
    </div></div>`;
}

function findLatestInsight() {
  const keys = Object.keys(state.weeks).sort().reverse();
  for (const wk of keys) if (state.weeks[wk]?.insight) return { week: wk, insight: state.weeks[wk].insight };
  return null;
}

function monthCard() {
  const mk = monthKeyOf();
  const weekSums = [];
  for (const [wk, w] of Object.entries(state.weeks)) {
    if (w.review?.summary && dateKey(weekStart(wk)).startsWith(mk)) weekSums.push(`- ${weekLabel(wk)}：${w.review.summary}`);
  }
  const cur = state.months[mk]?.review?.summary || '';
  const past = Object.keys(state.months).sort().reverse().filter((k) => k !== mk && state.months[k]?.review?.summary);
  if (!weekSums.length && !cur && !past.length) return '';
  return `<div class="card"><div class="card-title">月度总结 · ${fmtMonth(mk)}</div>
    ${weekSums.length ? `<div class="small muted" style="white-space:pre-wrap;margin-bottom:10px">${esc(weekSums.join('\n'))}</div>` : ''}
    <div class="field"><textarea data-change="month-sum" data-mk="${mk}" placeholder="这个月最重要的进展、反复出现的问题、值得延续的做法（100 字以内）">${esc(cur)}</textarea></div>
    ${monthAIState.error ? `<div class="ai-error">${esc(monthAIState.error)}</div>` : ''}
    <div class="btn-row">
      ${hasKey() && weekSums.length ? `<button class="btn small" data-action="month-ai" data-mk="${mk}" ${monthAIState.loading ? 'disabled' : ''}>${monthAIState.loading ? '<span class="spinner"></span> 生成中…' : '✦ AI 草拟'}</button>` : ''}
    </div>
    ${past.length ? past.map((k) => `<div class="review-item"><div class="rw"><span>${fmtMonth(k)}</span></div><div class="rtext">${esc(state.months[k].review.summary)}</div></div>`).join('') : ''}
  </div>`;
}

// ================= MODALS =================

// ----- settings -----

let testState = { loading: false, result: null, error: null };

function settingsModal() {
  const s = state.settings;
  const p = state.profile;
  const isCustomModel = !MODELS.some((m) => m.id === s.model);
  return `<h2>设置</h2><div class="modal-sub">API Key 只保存在这台设备的浏览器里，只发往 openrouter.ai</div>

  <div class="field"><label>OpenRouter API Key</label>
    <input type="password" value="${esc(s.apiKey)}" data-change="set-api-key" placeholder="sk-or-v1-…" autocomplete="off">
    <div class="hint">在 <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai/settings/keys</a> 创建，一个 key 可用所有模型</div></div>

  <div class="field"><label>模型</label>
    <select data-change="set-model">
      ${MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
      <option value="__custom" ${isCustomModel ? 'selected' : ''}>自定义…</option>
    </select>
    ${isCustomModel ? `<input class="mt8" type="text" value="${esc(s.model)}" data-change="set-model-custom" placeholder="例如 anthropic/claude-opus-5">` : ''}
    <div class="hint">主模型出错时自动回退到 Claude Opus 5 重试</div>
  </div>

  <div class="field"><label>思考深度</label>
    <div class="seg">${EFFORTS.map((e) => `<button data-action="set-effort" data-id="${e.id}" class="${s.effort === e.id ? 'active' : ''}">${e.label}</button>`).join('')}</div>
    <div class="hint">「最深思考」对应 GPT-5.6 的 max 推理档，质量最好但更慢更贵；日常「深」通常够用</div></div>

  <div class="btn-row">
    <button class="btn small" data-action="test-conn" ${testState.loading ? 'disabled' : ''}>${testState.loading ? '<span class="spinner"></span> 测试中…' : '测试连接'}</button>
    ${testState.result ? `<span class="small" style="color:var(--accent-ink)">✓ ${esc(testState.result)}</span>` : ''}
    ${testState.error ? `<span class="small" style="color:var(--danger)">${esc(testState.error)}</span>` : ''}
  </div>

  <div class="divider"></div>

  <div class="field"><label>关于我（AI 会始终参考）</label>
    <textarea data-change="set-about" placeholder="例：我是一名工程师，现阶段最重要的是完成 X。固定日程：周二四 10:00-11:30 例会。晚上 10 点后效率低。">${esc(p.aboutMe)}</textarea></div>

  <div style="display:flex;gap:12px">
    <div class="field" style="flex:1"><label>起床</label><input type="time" value="${esc(p.wake)}" data-change="set-wake"></div>
    <div class="field" style="flex:1"><label>就寝</label><input type="time" value="${esc(p.sleep)}" data-change="set-sleep"></div>
  </div>
  <div class="field"><label>运动习惯</label>
    <input type="text" value="${esc(p.exercise)}" data-change="set-exercise" placeholder="例：慢跑 30 分钟，每周一三五，18:30"></div>

  <div class="field"><label>我的时间原则</label>
    <textarea data-change="set-principles">${esc(p.principles)}</textarea></div>

  <div class="field"><label>外观</label>
    <div class="seg">
      ${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) => `<button data-action="set-theme" data-id="${v}" class="${s.theme === v ? 'active' : ''}">${l}</button>`).join('')}
    </div></div>

  <div class="divider"></div>
  <div class="btn-row">
    <button class="btn small" data-action="export-data">导出数据</button>
    <button class="btn small" data-action="import-pick">导入备份</button>
    <button class="btn small" data-action="demo-load">加载示例数据</button>
    <button class="btn small danger" data-action="wipe-data">清空所有数据</button>
  </div>
  <div class="muted small mt12">要事 First Things v1 · 数据存储在本机浏览器 · <a href="https://github.com/oliverjiang5666-source/first-things" target="_blank" rel="noreferrer">GitHub</a></div>
  <div class="modal-actions"><button class="btn" data-action="modal-close">完成</button></div>`;
}

// ----- inbox -----

function inboxModal() {
  const items = state.inbox.map((it) => `<div class="task">
    <div class="task-main"><div class="task-title">${esc(it.title)}</div></div>
    <div class="btn-row">
      <button class="btn small" data-action="inbox-today" data-id="${it.id}">→ 今天</button>
      <button class="btn small ghost danger" data-action="inbox-del" data-id="${it.id}">删除</button>
    </div></div>`).join('');
  return `<h2>收集箱</h2><div class="modal-sub">随手记下冒出来的想法，每周规划时统一整理</div>
  <div class="quick-add" style="margin:0 0 12px"><input type="text" placeholder="记一条，回车确认" data-enter="inbox-add"></div>
  <div class="task-list">${items || '<div class="empty">空空如也</div>'}</div>
  <div class="modal-actions"><button class="btn" data-action="modal-close">关闭</button></div>`;
}

// ----- chat -----

let chatHistory = [];
let chatAbort = null;
let chatBusy = false;

function chatModal() {
  const msgs = chatHistory.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('');
  return `<h2>问问教练</h2><div class="modal-sub">教练了解你的目标、本周计划和最近的复盘</div>
  <div class="chat-box">
    <div class="chat-log" id="chat-log">${msgs || '<div class="empty">可以问：「我现在最该做什么？」「帮我看看这周的安排合理吗？」<br>「我总是坚持不下来，怎么办？」</div>'}</div>
    ${hasKey() ? `<div class="chat-input-row">
      <textarea placeholder="输入消息，回车发送" data-enter="chat-send" id="chat-input"></textarea>
      <button class="btn primary" data-action="chat-send" ${chatBusy ? 'disabled' : ''}>发送</button>
    </div>` : `<div class="mt12">${aiGate('chat', '')}</div>`}
  </div>
  ${hasKey() ? ctxPreview(buildContext('chat')) : ''}`;
}

function appendChatDOM(role, text) {
  const log = $('#chat-log');
  if (!log) return null;
  if (log.querySelector('.empty')) log.innerHTML = '';
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// ----- plan day -----

let planState = { dump: '', loading: false, error: null, proposal: null, checked: {} };

function planModal() {
  const p = planState.proposal;
  let proposalHTML = '';
  if (p) {
    const item = (t, idx, group) => `<div class="ai-item">
      <input type="checkbox" data-change="plan-check" data-key="${group}-${idx}" ${planState.checked[`${group}-${idx}`] !== false ? 'checked' : ''}>
      <div><div class="ai-item-title">${group === 'mits' ? '★ ' : ''}${esc(t.title)}</div>
      <div class="ai-item-meta">${[t.goalId && goalById(t.goalId) ? goalById(t.goalId).title : null, t.blockStart ? t.blockStart + ' 开始' : null, t.estMin + '分'].filter(Boolean).join(' · ')}</div></div>
    </div>`;
    proposalHTML = `<div class="ai-card">
      <div class="ai-tag">✦ 建议方案</div>
      <div class="ai-rationale">${esc(p.rationale || '')}</div>
      ${p.mits.map((t, i) => item(t, i, 'mits')).join('')}
      ${p.others.map((t, i) => item(t, i, 'others')).join('')}
      ${p.defer?.length ? `<div class="section-label" style="margin-top:10px">建议推迟 / 放弃</div>${p.defer.map((d) => `<div class="ai-item"><div><div class="ai-item-title" style="color:var(--muted)">${esc(d.title)}</div><div class="ai-item-meta">${esc(d.reason)}</div></div></div>`).join('')}` : ''}
      <div class="btn-row mt12">
        <button class="btn primary" data-action="plan-adopt">采纳所选</button>
        <button class="btn" data-action="plan-ai" ${planState.loading ? 'disabled' : ''}>重新生成</button>
      </div>
    </div>`;
  }
  return `<h2>计划今天</h2><div class="modal-sub">把脑子里的事倒出来，AI 结合你的目标、本周要事和作息来安排</div>
  <div class="field"><textarea data-change="plan-dump" placeholder="今天要做什么？有什么固定日程（几点开会）？状态如何？都可以写，也可以留空直接生成。" style="min-height:96px">${esc(planState.dump)}</textarea></div>
  ${planState.error ? `<div class="ai-error">${esc(planState.error)}</div>` : ''}
  ${proposalHTML}
  ${!p ? `<div class="btn-row">
    ${hasKey()
      ? `<button class="btn primary" data-action="plan-ai" ${planState.loading ? 'disabled' : ''}>${planState.loading ? '<span class="spinner"></span> 正在深度思考安排…' : '✦ AI 帮我安排'}</button>`
      : ''}
    <button class="btn" data-action="plan-manual">手动添加</button>
  </div>${hasKey() ? '' : aiGate('plan-day', '')}` : ''}
  ${hasKey() ? ctxPreview(planDayPrompt(planState.dump)) : ''}
  <div class="modal-actions"><button class="btn ghost" data-action="modal-close">关闭</button></div>`;
}

// ----- task edit -----

let editTask = { day: null, id: null };

function taskModal() {
  const day = state.days[editTask.day];
  const t = day?.tasks.find((x) => x.id === editTask.id);
  if (!t) return '<div class="empty">任务不存在</div>';
  const goals = activeGoals();
  return `<h2>编辑任务</h2>
  <div class="field"><label>内容</label><input type="text" value="${esc(t.title)}" data-change="task-title"></div>
  <div class="field"><label>关联目标（决定它是否「重要」）</label>
    <select data-change="task-goal">
      <option value="">不关联（琐事）</option>
      ${goals.map((g) => `<option value="${g.id}" ${t.goalId === g.id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
    </select></div>
  <div class="field"><label>属性</label>
    <div class="btn-row">
      <button class="chip urgent-toggle ${t.urgent ? 'on' : ''}" data-action="task-urgent">⚡ 紧急</button>
      <button class="chip ${t.mit ? 'q2' : ''}" data-action="task-mit">★ 今日要事</button>
      <span class="chip quad q${quadrantOf(t)}">${QUAD_LABEL[quadrantOf(t)]}</span>
    </div></div>
  <div style="display:flex;gap:12px">
    <div class="field" style="flex:1"><label>开始时间</label><input type="time" value="${esc(t.blockStart || '')}" data-change="task-block"></div>
    <div class="field" style="flex:1"><label>预计（分钟）</label><input type="number" min="5" step="5" value="${t.estMin}" data-change="task-est"></div>
    <div class="field" style="flex:1"><label>实际（分钟）</label><input type="number" min="0" step="5" value="${t.actMin ?? ''}" placeholder="默认=预计" data-change="task-act"></div>
  </div>
  <div class="btn-row"><span class="muted small">预计时长快捷：</span>${[30, 45, 60, 90, 120].map((m) => `<button class="chip" data-action="task-est-quick" data-min="${m}">${m}分</button>`).join('')}</div>
  <div class="modal-actions">
    <button class="btn ghost danger left" data-action="task-del">删除</button>
    <button class="btn small ghost" data-action="task-tomorrow">移到明天</button>
    <button class="btn primary" data-action="modal-close">完成</button>
  </div>`;
}

function mutTask(fn) {
  update(() => {
    const day = state.days[editTask.day];
    const t = day?.tasks.find((x) => x.id === editTask.id);
    if (t) fn(t);
  });
  refreshModal();
}

// ----- goal form -----

let goalDraft = null; // {id?, title, why, area, horizon, weeklyBudgetHours, milestonesText, status, ai:{loading,error,firstActions}}

function goalModal() {
  const d = goalDraft;
  const isNew = !d.id;
  return `<h2>${isNew ? '新目标' : '编辑目标'}</h2>
  <div class="modal-sub">目标定义了什么是「重要」。写下它，然后分解到里程碑。</div>
  <div class="field"><label>目标</label><input type="text" value="${esc(d.title)}" data-change="gf-title" placeholder="例：出版我的第一本书 / 跑完全马 / 发布产品 v1"></div>
  <div class="field"><label>为什么重要（未来的你会感谢这句话）</label><textarea data-change="gf-why" style="min-height:60px">${esc(d.why)}</textarea></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div class="field" style="flex:1;min-width:130px"><label>领域</label><select data-change="gf-area">${AREAS.map((a) => `<option ${d.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="field" style="flex:1;min-width:130px"><label>期限</label><select data-change="gf-horizon">${HORIZONS.map((h) => `<option ${d.horizon === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
    <div class="field" style="flex:1;min-width:130px"><label>每周预算（小时）</label><input type="number" min="0" step="0.5" value="${d.weeklyBudgetHours || ''}" data-change="gf-budget" placeholder="如 5"></div>
  </div>
  <div class="field"><label>里程碑（一行一个，按时间顺序，带时间点）</label>
    <textarea data-change="gf-ms" placeholder="9月底：完成文献综述\n10月底：完成初稿\n12月：投稿" style="min-height:84px">${esc(d.milestonesText)}</textarea></div>

  ${d.ai.error ? `<div class="ai-error">${esc(d.ai.error)}</div>` : ''}
  ${d.ai.firstActions?.length ? `<div class="ai-card"><div class="ai-tag">✦ 本周就能开始的第一步</div>
    ${d.ai.firstActions.map((a, i) => `<div class="ai-item"><div style="flex:1"><div class="ai-item-title">${esc(a)}</div></div><button class="btn small" data-action="gf-first-today" data-idx="${i}">加到今天</button></div>`).join('')}
  </div>` : ''}

  <div class="btn-row">
    ${hasKey() ? `<button class="btn" data-action="gf-ai" ${d.ai.loading ? 'disabled' : ''}>${d.ai.loading ? '<span class="spinner"></span> 第一性原理分解中…' : '✦ AI 帮我分解这个目标'}</button>` : `<button class="btn small ghost" data-action="copy-prompt" data-purpose="decompose">复制分解指令给 AI</button>`}
  </div>

  ${!isNew ? `<div class="field mt12"><label>状态</label><div class="seg">
    ${[['active', '进行中'], ['paused', '暂停'], ['archived', '归档']].map(([v, l]) => `<button data-action="gf-status" data-id="${v}" class="${d.status === v ? 'active' : ''}">${l}</button>`).join('')}
  </div></div>` : ''}

  <div class="modal-actions">
    ${!isNew ? `<button class="btn ghost danger left" data-action="gf-del">删除目标</button>` : ''}
    <button class="btn ghost" data-action="modal-close">取消</button>
    <button class="btn primary" data-action="gf-save">保存</button>
  </div>`;
}

function newGoalDraft(g = null) {
  return g ? {
    id: g.id, title: g.title, why: g.why || '', area: g.area, horizon: g.horizon,
    weeklyBudgetHours: g.weeklyBudgetHours || 0, status: g.status,
    milestonesText: (g.milestones || []).map((m) => m.title).join('\n'),
    ai: { loading: false, error: null, firstActions: null },
  } : {
    id: null, title: '', why: '', area: '工作', horizon: '本季度', weeklyBudgetHours: 0, status: 'active',
    milestonesText: '', ai: { loading: false, error: null, firstActions: null },
  };
}

// ----- week wizard -----

let wiz = null; // {step, lastWk, summary, sumLoading, sumError, chosen:[], sugLoading, sugError, suggestions:[], budgets:{}, manual:''}

function wizardModal() {
  const w = wiz;
  const stepsBar = `<div class="wizard-steps">${[1, 2, 3].map((i) => `<div class="wstep ${w.step >= i ? 'on' : ''}"></div>`).join('')}</div>`;

  if (w.step === 1) {
    const lastSt = weekStats(w.lastWk);
    const hasLast = lastSt.tasksTotal > 0 || state.weeks[w.lastWk]?.plannedAt;
    if (!hasLast) { w.step = 2; return wizardModal(); }
    return `<h2>每周规划 · 回顾上周</h2><div class="modal-sub">${weekLabel(w.lastWk)}</div>${stepsBar}
    <div class="kv"><span class="k">上周要事完成</span><span class="v">${lastSt.priosDone} / ${lastSt.priosTotal}</span></div>
    <div class="kv"><span class="k">投入总时长</span><span class="v">${hoursStr(lastSt.doneMin)}</span></div>
    <div class="kv"><span class="k">重要不紧急占比</span><span class="v">${lastSt.q2Share != null ? (lastSt.q2Share * 100).toFixed(0) + '%' : '—'}</span></div>
    <div class="kv"><span class="k">复盘天数</span><span class="v">${lastSt.daysReviewed} / 7</span></div>
    <div class="field mt12"><label>上周复盘摘要（80 字以内，会成为长期记忆）</label>
      <textarea data-change="wiz-summary" placeholder="主要完成了什么？没完成的原因？下周最该注意什么？">${esc(w.summary)}</textarea></div>
    ${w.sumError ? `<div class="ai-error">${esc(w.sumError)}</div>` : ''}
    <div class="btn-row">
      ${hasKey() ? `<button class="btn small" data-action="wiz-ai-summary" ${w.sumLoading ? 'disabled' : ''}>${w.sumLoading ? '<span class="spinner"></span> 草拟中…' : '✦ AI 草拟'}</button>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn ghost" data-action="modal-close">取消</button>
      <button class="btn primary" data-action="wiz-next">下一步</button>
    </div>`;
  }

  if (w.step === 2) {
    const chosen = w.chosen.map((c, i) => {
      const g = c.goalId ? goalById(c.goalId) : null;
      return `<div class="task"><div class="task-main"><div class="task-title">${esc(c.title)}</div>
        <div class="task-meta">${g ? `<span class="chip" style="--gc:${goalColor(g)}"><span class="dot"></span>${esc(g.title)}</span>` : '<span class="chip">未关联</span>'}</div></div>
        <button class="btn small ghost" data-action="wiz-unpick" data-idx="${i}">移除</button></div>`;
    }).join('');
    const sugs = (w.suggestions || []).map((sg, i) => {
      const g = sg.goalId ? goalById(sg.goalId) : null;
      return `<button class="suggest-chip" data-action="wiz-pick" data-idx="${i}" title="${esc(sg.reason || '')}">＋ ${esc(sg.title)}${g ? ` <span class="muted">· ${esc(g.title)}</span>` : ''}</button>`;
    }).join('');
    return `<h2>每周规划 · 本周要事</h2><div class="modal-sub">3-5 件，每件是本周结束时「可检验的结果」</div>${stepsBar}
    <div class="task-list">${chosen || '<div class="empty">还没选，从下面的建议里挑，或手动添加</div>'}</div>
    <div class="quick-add" style="margin-top:8px"><input type="text" placeholder="手动添加一件要事，回车确认" data-enter="wiz-manual-add"></div>
    <div class="field mt12"><label>建议来源</label>
      ${w.sugError ? `<div class="ai-error">${esc(w.sugError)}</div>` : ''}
      <div>${sugs || '<span class="muted small">点下方按钮获取建议</span>'}</div>
      <div class="btn-row mt8">
        ${hasKey() ? `<button class="btn small" data-action="wiz-ai-suggest" ${w.sugLoading ? 'disabled' : ''}>${w.sugLoading ? '<span class="spinner"></span> 思考中…' : '✦ AI 建议本周要事'}</button>` : `<button class="btn small ghost" data-action="copy-prompt" data-purpose="plan-week">复制上下文给 AI</button>`}
        <button class="btn small ghost" data-action="wiz-local-suggest">用上周未完成 + 收集箱</button>
      </div></div>
    <div class="modal-actions">
      <button class="btn ghost left" data-action="wiz-back">上一步</button>
      <button class="btn ghost" data-action="modal-close">取消</button>
      <button class="btn primary" data-action="wiz-next" ${w.chosen.length ? '' : 'disabled'}>下一步</button>
    </div>`;
  }

  // step 3
  const goals = activeGoals();
  const total = goals.reduce((sum, g) => sum + (Number(w.budgets[g.id]) || 0), 0);
  return `<h2>每周规划 · 时间预算</h2><div class="modal-sub">先付给重要不紧急的事——给每个目标预留本周小时数</div>${stepsBar}
  ${goals.map((g) => `<div class="goal-bar-row">
    <div class="goal-bar-name" style="flex-basis:180px"><span class="dot" style="background:${goalColor(g)};width:8px;height:8px;border-radius:50%"></span><span>${esc(g.title)}</span></div>
    <input type="number" min="0" step="0.5" value="${w.budgets[g.id] ?? ''}" data-change="wiz-budget" data-goal="${g.id}" style="width:80px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card-2)"> <span class="muted small">小时</span>
  </div>`).join('')}
  <div class="kv mt12"><span class="k">本周为目标预留合计</span><span class="v"><b>${total}</b> 小时</span></div>
  <div class="modal-actions">
    <button class="btn ghost left" data-action="wiz-back">上一步</button>
    <button class="btn primary" data-action="wiz-finish">完成规划</button>
  </div>`;
}

// ----- week review (standalone) -----

let wr = null; // {week, text, loading, error}

function weekReviewModal() {
  return `<h2>周复盘</h2><div class="modal-sub">${weekLabel(wr.week)} · 80 字以内，会成为长期记忆</div>
  <div class="field"><textarea data-change="wr-text" style="min-height:100px" placeholder="主要完成了什么？没完成的原因？下周最该注意什么？">${esc(wr.text)}</textarea></div>
  ${wr.error ? `<div class="ai-error">${esc(wr.error)}</div>` : ''}
  <div class="btn-row">
    ${hasKey() ? `<button class="btn small" data-action="wr-ai" ${wr.loading ? 'disabled' : ''}>${wr.loading ? '<span class="spinner"></span> 草拟中…' : '✦ AI 草拟'}</button>` : ''}
  </div>
  <div class="modal-actions">
    <button class="btn ghost" data-action="modal-close">取消</button>
    <button class="btn primary" data-action="wr-save">保存</button>
  </div>`;
}

function weekContextFor(wk) {
  const days = weekDays(wk);
  const lines = [`${weekLabel(wk)} 的数据：`];
  const w = state.weeks[wk];
  if (w?.priorities?.length) {
    lines.push('本周要事：');
    for (const p of w.priorities) lines.push(`- ${p.done ? '[完成]' : '[未完成]'} ${p.title}`);
  }
  for (const k of days) {
    const day = state.days[k];
    if (!day?.tasks.length) continue;
    const s = dayStats(k);
    lines.push(`${fmtShort(k)}：完成 ${s.done}/${s.total}${day.reflection ? `，反思：${day.reflection}` : ''}`);
  }
  return lines.join('\n');
}

// ================= ACTIONS =================

async function withAI(stateObj, refreshFn, fn) {
  stateObj.loading = true; stateObj.error = null; refreshFn();
  try { await fn(); }
  catch (e) {
    if (e.name !== 'AbortError') stateObj.error = e.message || String(e);
  }
  stateObj.loading = false; refreshFn();
}

export const Actions = {
  // --- nav ---
  'nav': (el) => { currentView = el.dataset.view; if (currentView === 'week') curWeek = thisWeekKey(); render(); },
  'go-today': () => { currentView = 'today'; render(); },
  'overlay-close': (el, ev) => { if (ev.target === el) closeModal(); },
  'modal-close': () => { closeModal(); render(); },

  // --- header ---
  'open-settings': () => { testState = { loading: false, result: null, error: null }; openModal(settingsModal); },
  'open-inbox': () => openModal(inboxModal, () => $('.modal input')?.focus()),
  'open-chat': () => openModal(chatModal, () => $('#chat-input')?.focus()),

  // --- settings ---
  'set-effort': (el) => { update((s) => { s.settings.effort = el.dataset.id; }); refreshModal(); },
  'set-theme': (el) => {
    update((s) => { s.settings.theme = el.dataset.id; });
    applyTheme(); refreshModal();
  },
  'test-conn': () => withAI(testState, refreshModal, async () => {
    testState.result = null;
    const reply = await testConnection();
    testState.result = reply.slice(0, 40) || '连接成功';
  }),
  'export-data': () => { exportJSON(); toast('已导出备份文件'); refreshModal(); },
  'import-pick': () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try { importJSON(await f.text()); closeModal(); render(); toast('导入成功'); }
      catch (e) { toast(e.message || '导入失败'); }
    };
    input.click();
  },
  'demo-load': () => {
    if (hasAnyData() && !confirm('加载示例数据会覆盖当前数据（API Key 会保留），确定吗？')) return;
    seedDemo(); closeModal(); currentView = 'today'; render(); toast('示例数据已加载，可在设置里清空');
  },
  'wipe-data': () => {
    if (!confirm('确定清空所有数据？此操作不可恢复。')) return;
    if (!confirm('再次确认：目标、任务、复盘将全部删除。建议先导出备份。')) return;
    wipeAll(); closeModal(); render(); toast('已清空');
  },

  // --- inbox ---
  'inbox-add': (el) => {
    const v = el.value.trim();
    if (!v) return;
    update((s) => s.inbox.unshift({ id: uid(), title: v, createdAt: Date.now() }));
    el.value = ''; refreshModal();
    requestAnimationFrame(() => $('.modal input')?.focus());
  },
  'inbox-today': (el) => {
    const it = state.inbox.find((x) => x.id === el.dataset.id);
    if (!it) return;
    update((s) => {
      ensureDay(todayKey()).tasks.push(newTask(it.title));
      s.inbox = s.inbox.filter((x) => x.id !== it.id);
    });
    refreshModal(); toast('已加到今天');
  },
  'inbox-del': (el) => {
    update((s) => { s.inbox = s.inbox.filter((x) => x.id !== el.dataset.id); });
    refreshModal();
  },

  // --- chat ---
  'chat-send': async () => {
    const input = $('#chat-input');
    const text = input?.value.trim();
    if (!text || chatBusy) return;
    input.value = '';
    chatBusy = true;
    chatHistory.push({ role: 'user', content: text });
    appendChatDOM('user', text);
    const div = appendChatDOM('assistant', '…');
    chatAbort = new AbortController();
    try {
      const reply = await aiChat(chatHistory, (_, full) => {
        if (div) { div.textContent = full; $('#chat-log').scrollTop = $('#chat-log').scrollHeight; }
      }, chatAbort.signal);
      chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      if (e.name !== 'AbortError' && div) div.textContent = `（出错了：${e.message}）`;
    }
    chatBusy = false; chatAbort = null;
  },

  // --- today ---
  'focus-quick-add': () => { focusQuickAdd = true; render(); },
  'qa-add': (el) => {
    const v = el.value.trim();
    if (!v) return;
    update(() => ensureDay(todayKey()).tasks.push(newTask(v)));
    focusQuickAdd = true; render();
  },
  'toggle-task': (el) => {
    update(() => {
      const t = state.days[el.dataset.day]?.tasks.find((x) => x.id === el.dataset.id);
      if (t) t.done = !t.done;
    });
    render();
  },
  'toggle-mit': (el) => {
    const day = state.days[el.dataset.day];
    const t = day?.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (!t.mit && day.tasks.filter((x) => x.mit && !x.done && !x.dropped).length >= 3) {
      toast('今日要事最多 3 件——少即是多'); return;
    }
    update(() => { t.mit = !t.mit; });
    render();
  },
  'open-task': (el) => {
    editTask = { day: el.dataset.day || todayKey(), id: el.dataset.id };
    openModal(taskModal);
  },
  'carry-today': (el) => {
    update(() => {
      const t = state.days[el.dataset.day]?.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      t.carried = true;
      ensureDay(todayKey()).tasks.push(newTask(t.title, { goalId: t.goalId, urgent: t.urgent, estMin: t.estMin }));
    });
    render();
  },
  'carry-inbox': (el) => {
    update((s) => {
      const t = state.days[el.dataset.day]?.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      t.carried = true;
      s.inbox.unshift({ id: uid(), title: t.title, createdAt: Date.now() });
    });
    render();
  },
  'carry-drop': (el) => {
    update(() => {
      const t = state.days[el.dataset.day]?.tasks.find((x) => x.id === el.dataset.id);
      if (t) t.dropped = true;
    });
    render();
  },

  // --- plan day ---
  'plan-open': () => {
    planState = { dump: '', loading: false, error: null, proposal: null, checked: {} };
    openModal(planModal, () => $('.modal textarea')?.focus());
  },
  'plan-ai': () => withAI(planState, refreshModal, async () => {
    planState.proposal = null;
    const plan = await aiPlanDay(planState.dump);
    planState.proposal = plan;
    planState.checked = {};
  }),
  'plan-adopt': () => {
    const p = planState.proposal;
    if (!p) return;
    update(() => {
      const day = ensureDay(todayKey());
      const exists = (title) => day.tasks.some((t) => !t.dropped && t.title.trim() === title.trim());
      const existingMits = day.tasks.filter((t) => t.mit && !t.done && !t.dropped).length;
      let mitCount = existingMits;
      p.mits.forEach((t, i) => {
        if (planState.checked[`mits-${i}`] === false || exists(t.title)) return;
        day.tasks.push(newTask(t.title, {
          goalId: t.goalId, estMin: t.estMin || 30, blockStart: t.blockStart,
          mit: mitCount < 3 ? (mitCount++, true) : false,
        }));
      });
      p.others.forEach((t, i) => {
        if (planState.checked[`others-${i}`] === false || exists(t.title)) return;
        day.tasks.push(newTask(t.title, { goalId: t.goalId, estMin: t.estMin || 30, blockStart: t.blockStart }));
      });
      day.plannedAt = Date.now();
    });
    closeModal(); render(); toast('今天安排好了，从第一件要事开始');
  },
  'plan-manual': () => { closeModal(); update(() => { ensureDay(todayKey()).plannedAt = Date.now(); }); focusQuickAdd = true; render(); },

  // --- review day ---
  'review-day-done': () => {
    update(() => { ensureDay(todayKey()).reviewedAt = Date.now(); });
    render(); toast(`复盘完成，连续 ${reviewStreak()} 天`);
  },
  'review-reopen': () => {
    update(() => { ensureDay(todayKey()).reviewedAt = null; });
    render();
  },
  'review-day-ai': () => withAI(reviewAIState, render, async () => {
    const reflection = state.days[todayKey()]?.reflection || '';
    const comment = await aiReviewDay(reflection);
    update(() => { ensureDay(todayKey()).aiComment = comment.trim(); });
  }),

  // --- task edit ---
  'task-urgent': () => mutTask((t) => { t.urgent = !t.urgent; }),
  'task-mit': () => mutTask((t) => { t.mit = !t.mit; }),
  'task-est-quick': (el) => mutTask((t) => { t.estMin = Number(el.dataset.min); }),
  'task-del': () => {
    update(() => {
      const day = state.days[editTask.day];
      if (day) day.tasks = day.tasks.filter((x) => x.id !== editTask.id);
    });
    closeModal(); render();
  },
  'task-tomorrow': () => {
    update(() => {
      const day = state.days[editTask.day];
      const t = day?.tasks.find((x) => x.id === editTask.id);
      if (!t) return;
      day.tasks = day.tasks.filter((x) => x.id !== editTask.id);
      ensureDay(addDays(editTask.day, 1)).tasks.push({ ...t, blockStart: null });
    });
    closeModal(); render(); toast('已移到明天');
  },

  // --- week ---
  'week-prev': () => { curWeek = shiftWeek(curWeek, -1); render(); },
  'week-next': () => { curWeek = shiftWeek(curWeek, 1); render(); },
  'week-cur': () => { curWeek = thisWeekKey(); render(); },
  'prio-toggle': (el) => {
    update(() => {
      const p = state.weeks[el.dataset.week]?.priorities.find((x) => x.id === el.dataset.id);
      if (p) p.done = !p.done;
    });
    render();
  },
  'prio-today': (el) => {
    const p = state.weeks[el.dataset.week]?.priorities.find((x) => x.id === el.dataset.id);
    if (!p) return;
    update(() => {
      const day = ensureDay(todayKey());
      const mits = day.tasks.filter((t) => t.mit && !t.done && !t.dropped).length;
      day.tasks.push(newTask(p.title, { goalId: p.goalId, mit: mits < 3, estMin: 60 }));
    });
    toast('已加到今天'); render();
  },

  // --- wizard ---
  'wiz-open': () => {
    const lastWk = shiftWeek(thisWeekKey(), -1);
    const existing = state.weeks[thisWeekKey()];
    wiz = {
      step: 1, lastWk,
      summary: state.weeks[lastWk]?.review?.summary || '',
      sumLoading: false, sumError: null,
      chosen: existing?.priorities?.map((p) => ({ title: p.title, goalId: p.goalId })) || [],
      suggestions: [], sugLoading: false, sugError: null,
      budgets: { ...(existing?.budgets || {}) },
      rationale: '',
    };
    if (!Object.keys(wiz.budgets).length) {
      for (const g of activeGoals()) if (g.weeklyBudgetHours) wiz.budgets[g.id] = g.weeklyBudgetHours;
    }
    openModal(wizardModal);
  },
  'wiz-back': () => { wiz.step = Math.max(1, wiz.step - 1); refreshModal(); },
  'wiz-next': () => {
    if (wiz.step === 1 && wiz.summary.trim()) {
      update(() => { ensureWeek(wiz.lastWk).review = { summary: wiz.summary.trim(), reviewedAt: Date.now() }; });
    }
    wiz.step = Math.min(3, wiz.step + 1); refreshModal();
  },
  'wiz-ai-summary': () => withAI({ set loading(v) { wiz.sumLoading = v; }, set error(v) { wiz.sumError = v; } }, refreshModal, async () => {
    wiz.summary = (await aiWeekSummary(weekContextFor(wiz.lastWk))).trim();
  }),
  'wiz-ai-suggest': () => withAI({ set loading(v) { wiz.sugLoading = v; }, set error(v) { wiz.sugError = v; } }, refreshModal, async () => {
    const plan = await aiPlanWeek();
    wiz.suggestions = plan.priorities;
    wiz.rationale = plan.rationale;
  }),
  'wiz-local-suggest': () => {
    const sugs = [];
    const lastW = state.weeks[wiz.lastWk];
    if (lastW) for (const p of lastW.priorities.filter((x) => !x.done)) sugs.push({ title: p.title, goalId: p.goalId, reason: '上周未完成' });
    for (const it of state.inbox.slice(0, 5)) sugs.push({ title: it.title, goalId: null, reason: '来自收集箱' });
    for (const g of activeGoals()) {
      const ms = currentMilestone(g);
      if (ms) sugs.push({ title: `推进：${ms.title}`, goalId: g.id, reason: '当前里程碑' });
    }
    wiz.suggestions = sugs; refreshModal();
  },
  'wiz-pick': (el) => {
    const sg = wiz.suggestions[Number(el.dataset.idx)];
    if (!sg) return;
    if (wiz.chosen.length >= 5) { toast('最多 5 件——聚焦'); return; }
    wiz.chosen.push({ title: sg.title, goalId: sg.goalId });
    wiz.suggestions.splice(Number(el.dataset.idx), 1);
    refreshModal();
  },
  'wiz-unpick': (el) => { wiz.chosen.splice(Number(el.dataset.idx), 1); refreshModal(); },
  'wiz-manual-add': (el) => {
    const v = el.value.trim();
    if (!v) return;
    if (wiz.chosen.length >= 5) { toast('最多 5 件——聚焦'); return; }
    wiz.chosen.push({ title: v, goalId: null });
    el.value = ''; refreshModal();
  },
  'wiz-finish': () => {
    update(() => {
      const wk = ensureWeek(thisWeekKey());
      const old = wk.priorities || [];
      wk.priorities = wiz.chosen.map((c) => {
        const prev = old.find((p) => p.title === c.title);
        return { id: prev?.id || uid(), title: c.title, goalId: c.goalId, done: prev?.done || false };
      });
      const budgets = {};
      for (const [gid, v] of Object.entries(wiz.budgets)) if (Number(v) > 0) budgets[gid] = Number(v);
      wk.budgets = budgets;
      wk.plannedAt = Date.now();
    });
    closeModal(); curWeek = thisWeekKey(); currentView = 'week'; render();
    toast('本周计划完成');
  },

  // --- week review ---
  'week-review-open': (el) => {
    const wk = el.dataset.week;
    wr = { week: wk, text: state.weeks[wk]?.review?.summary || '', loading: false, error: null };
    openModal(weekReviewModal, () => $('.modal textarea')?.focus());
  },
  'wr-ai': () => withAI(wr, refreshModal, async () => {
    wr.text = (await aiWeekSummary(weekContextFor(wr.week))).trim();
  }),
  'wr-save': () => {
    update(() => { ensureWeek(wr.week).review = { summary: wr.text.trim(), reviewedAt: Date.now() }; });
    closeModal(); render(); toast('周复盘已保存');
  },

  // --- goals ---
  'goal-new': () => { goalDraft = newGoalDraft(); openModal(goalModal, () => $('.modal input')?.focus()); },
  'goal-edit': (el) => {
    const g = goalById(el.dataset.id);
    if (!g) return;
    goalDraft = newGoalDraft(g);
    openModal(goalModal);
  },
  'gf-status': (el) => { goalDraft.status = el.dataset.id; refreshModal(); },
  'gf-ai': () => withAI(goalDraft.ai, refreshModal, async () => {
    if (!goalDraft.title.trim()) { goalDraft.ai.error = '先写下目标'; return; }
    const r = await aiDecomposeGoal(goalDraft.title, goalDraft.why);
    if (r.why && !goalDraft.why.trim()) goalDraft.why = r.why;
    if (r.milestones?.length) goalDraft.milestonesText = r.milestones.join('\n');
    if (r.weeklyHours && !goalDraft.weeklyBudgetHours) goalDraft.weeklyBudgetHours = r.weeklyHours;
    goalDraft.ai.firstActions = r.firstActions || [];
  }),
  'gf-first-today': (el) => {
    const a = goalDraft.ai.firstActions?.[Number(el.dataset.idx)];
    if (!a) return;
    update(() => {
      const day = ensureDay(todayKey());
      const mits = day.tasks.filter((t) => t.mit && !t.done && !t.dropped).length;
      day.tasks.push(newTask(a, { goalId: goalDraft.id, mit: mits < 3, estMin: 60 }));
    });
    toast('已加到今天');
  },
  'gf-save': () => {
    const d = goalDraft;
    if (!d.title.trim()) { toast('目标不能为空'); return; }
    update((s) => {
      const msLines = d.milestonesText.split('\n').map((x) => x.trim()).filter(Boolean);
      if (d.id) {
        const g = goalById(d.id);
        if (!g) return;
        Object.assign(g, {
          title: d.title.trim(), why: d.why.trim(), area: d.area, horizon: d.horizon,
          weeklyBudgetHours: Number(d.weeklyBudgetHours) || 0, status: d.status,
        });
        const oldMs = g.milestones || [];
        g.milestones = msLines.map((line) => {
          const prev = oldMs.find((m) => m.title === line);
          return prev || { id: uid(), title: line, done: false };
        });
      } else {
        s.goals.push({
          id: uid(), title: d.title.trim(), why: d.why.trim(), area: d.area, horizon: d.horizon,
          weeklyBudgetHours: Number(d.weeklyBudgetHours) || 0, status: 'active',
          colorIdx: s.goals.length % 6, createdAt: Date.now(),
          milestones: msLines.map((line) => ({ id: uid(), title: line, done: false })),
        });
      }
    });
    closeModal(); currentView = 'goals'; render(); toast('目标已保存');
  },
  'gf-del': () => {
    if (!confirm('删除这个目标？历史任务会保留但不再关联。')) return;
    update((s) => { s.goals = s.goals.filter((g) => g.id !== goalDraft.id); });
    closeModal(); render();
  },
  'ms-toggle': (el) => {
    update(() => {
      const g = goalById(el.dataset.goal);
      const m = g?.milestones.find((x) => x.id === el.dataset.id);
      if (m) m.done = !m.done;
    });
    render();
  },

  // --- insight ---
  'insight-gen': () => withAI(insightState, render, async () => {
    const data = await aiInsight();
    update(() => {
      ensureWeek(thisWeekKey()).insight = { ...data, createdAt: Date.now() };
    });
  }),

  // --- month ---
  'month-ai': (el) => withAI(monthAIState, render, async () => {
    const mk = el.dataset.mk;
    const sums = [];
    for (const [wk, w] of Object.entries(state.weeks)) {
      if (w.review?.summary && dateKey(weekStart(wk)).startsWith(mk)) sums.push(`- ${weekLabel(wk)}：${w.review.summary}`);
    }
    const text = await aiMonthSummary(fmtMonth(mk), sums.join('\n'));
    update((s) => { s.months[mk] = { review: { summary: text.trim(), reviewedAt: Date.now() } }; });
  }),

  // --- copy prompt fallback ---
  'copy-prompt': async (el) => {
    const purpose = el.dataset.purpose;
    let text;
    if (purpose === 'plan-day') text = planDayPrompt(planState?.dump || '');
    else if (purpose === 'plan-week') text = planWeekPrompt();
    else if (purpose === 'insight') text = insightPrompt();
    else if (purpose === 'review-day') text = reviewDayPrompt(state.days[todayKey()]?.reflection || '');
    else if (purpose === 'decompose') text = `${buildContext('chat')}\n\n请帮我用第一性原理分解这个目标：「${goalDraft?.title || ''}」，给出：为什么重要、3-6 个带时间点的里程碑、每周建议投入小时数、本周就能开始的 2-3 个具体动作。`;
    else text = buildContext('chat');
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制，粘贴给任意 AI 助手即可');
    } catch {
      toast('复制失败，请检查浏览器权限');
    }
  },
};

export const Changes = {
  'set-api-key': (el) => update((s) => { s.settings.apiKey = el.value.trim(); }),
  'set-model': (el) => {
    if (el.value === '__custom') { update((s) => { s.settings.model = ''; }); refreshModal(); }
    else update((s) => { s.settings.model = el.value; });
  },
  'set-model-custom': (el) => update((s) => { s.settings.model = el.value.trim(); }),
  'set-about': (el) => update((s) => { s.profile.aboutMe = el.value; }),
  'set-wake': (el) => update((s) => { s.profile.wake = el.value; }),
  'set-sleep': (el) => update((s) => { s.profile.sleep = el.value; }),
  'set-exercise': (el) => update((s) => { s.profile.exercise = el.value; }),
  'set-principles': (el) => update((s) => { s.profile.principles = el.value; }),
  'set-reflection': (el) => update(() => { ensureDay(el.dataset.day).reflection = el.value; }),
  'plan-dump': (el) => { planState.dump = el.value; },
  'plan-check': (el) => { planState.checked[el.dataset.key] = el.checked; },
  'task-title': (el) => mutTask((t) => { t.title = el.value.trim() || t.title; }),
  'task-goal': (el) => mutTask((t) => { t.goalId = el.value || null; }),
  'task-block': (el) => mutTask((t) => { t.blockStart = el.value || null; }),
  'task-est': (el) => mutTask((t) => { t.estMin = Math.max(5, Number(el.value) || 30); }),
  'task-act': (el) => mutTask((t) => { t.actMin = el.value === '' ? null : Math.max(0, Number(el.value)); }),
  'gf-title': (el) => { goalDraft.title = el.value; },
  'gf-why': (el) => { goalDraft.why = el.value; },
  'gf-area': (el) => { goalDraft.area = el.value; },
  'gf-horizon': (el) => { goalDraft.horizon = el.value; },
  'gf-budget': (el) => { goalDraft.weeklyBudgetHours = Number(el.value) || 0; },
  'gf-ms': (el) => { goalDraft.milestonesText = el.value; },
  'wiz-summary': (el) => { wiz.summary = el.value; },
  'wiz-budget': (el) => { wiz.budgets[el.dataset.goal] = el.value; },
  'wr-text': (el) => { wr.text = el.value; },
  'month-sum': (el) => update((s) => {
    s.months[el.dataset.mk] = { review: { summary: el.value.trim(), reviewedAt: Date.now() } };
  }),
};

// ---------- theme ----------

export function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
