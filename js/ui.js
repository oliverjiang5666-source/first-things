// ============ views, modals, actions ============

import {
  state, update, uid, newTask, ensureDay, ensureWeek,
  activeGoals, goalById, goalColor, currentMilestone, quadrantOf, QUAD_LABEL, taskMinutes,
  todayKey, addDays, fmtDay, fmtShort, weekLabel, weekDays, thisWeekKey, shiftWeek, weekStart,
  dayStats, weekStats, weekGoalMinutes, reviewStreak, unfinishedYesterday, hasAnyData,
  computeSignals, monthKeyOf, fmtMonth, exportJSON, importJSON, wipeAll, seedDemo,
  AREAS, HORIZONS, dateKey, beijingDateOf,
  snapshot, restoreSnapshot, startTimer, stopTimer, timerElapsedMin,
} from './store.js';
import {
  hasKey, MODELS, EFFORTS, aiPlanDay, planDayPrompt, aiPlanWeek, planWeekPrompt,
  aiDecomposeGoal, aiReviewDay, reviewDayPrompt, aiWeekSummary, weekSummaryPrompt,
  aiMonthSummary, aiInsight, insightPrompt, aiCoach, testConnection,
} from './ai.js';
import { applyOps } from './apply.js';
import { refreshBrief, autoComment } from './auto.js';
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

// 教练对话应用改动后的单步撤销快照
let lastSnapshot = null;
let briefLoading = false;

// ---------- toast ----------

// opts: { label, action, ms } —— 带动作按钮的 toast（如「撤销」）
export function toast(msg, opts = null) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts?.label && opts?.action) {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = opts.label;
    b.dataset.action = opts.action;
    el.appendChild(b);
  }
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), opts?.ms || 2600);
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
  if (coachAbort) { coachAbort.abort(); coachAbort = null; }
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

// v2 设计系统：字形符号统一为内联线性 SVG（stroke 1.8–2，尺寸见设计交付 §3）；
// ✦ 是 AI 的唯一记号，出现在非 accent 底色上时用 AI_MARK 着 accent 绿。
const SVG_STAR = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const SVG_STAR_SM = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align:-1px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const SVG_PLAY = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const SVG_STOP = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
const SVG_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const WARN_ICON = '<span style="color:var(--q3);flex-shrink:0;display:inline-flex;margin-top:3px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>';
const SPARK = '<span class="spark">✦</span>';
const AI_MARK = '<span style="color:var(--accent)">✦</span>';

function taskRow(t, dayKey) {
  const running = state.timer?.taskId === t.id;
  const timeBits = [];
  if (t.blockStart) timeBits.push(t.blockStart);
  if (running) timeBits.push(`⏱ 已 ${timerElapsedMin()} 分`);
  else timeBits.push(t.actMin != null ? `实际 ${t.actMin} 分` : `${taskMinutes(t)}分`);
  const timerBtn = t.done ? '' : (running
    ? `<button class="timer-btn on" data-action="timer-stop" title="停止计时并记入实际用时">${SVG_STOP}</button>`
    : `<button class="timer-btn" data-action="timer-start" data-day="${dayKey}" data-id="${t.id}" title="开始计时">${SVG_PLAY}</button>`);
  return `<div class="task ${t.done ? 'done' : ''} ${running ? 'timing' : ''}">
    <button class="check" data-action="toggle-task" data-day="${dayKey}" data-id="${t.id}" title="完成">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
    <div class="task-main">
      <div class="task-title" data-action="open-task" data-id="${t.id}" data-day="${dayKey}">${esc(t.title)}</div>
      <div class="task-meta">${goalChip(t)}${quadChip(t)}<span class="chip">${timeBits.join(' · ')}</span></div>
    </div>
    ${timerBtn}
    <button class="mit-star ${t.mit ? 'on' : ''}" data-action="toggle-mit" data-day="${dayKey}" data-id="${t.id}" title="今日要事（最多 3 件）">${SVG_STAR}</button>
  </div>`;
}

function signalChips(levelFilter = null, max = 2) {
  let sigs = computeSignals();
  if (levelFilter) sigs = sigs.filter((s) => s.level === levelFilter);
  sigs = sigs.slice(0, max);
  if (!sigs.length) return '';
  return sigs.map((s) => `<div class="banner ${s.level === 'warn' ? '' : 'calm'}">${s.level === 'warn' ? WARN_ICON : '<span>·</span>'}<span>${esc(s.text)}</span></div>`).join('');
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

  // 教练入口：这里说的话直接进对话框，教练自己理解、自己动手
  if (hasKey()) {
    html += `<div class="card nl-card">
      <div class="nl-bar">
        <span class="nl-icon">✦</span>
        <input type="text" placeholder="一句话交给教练：完成了跑步用40分 / 下午3点加牙医 / 今晚复盘…" data-enter="coach-bar">
        <button class="btn primary small" data-action="coach-bar">发送</button>
      </div>
    </div>`;
  }

  // 计时中横幅
  if (state.timer) {
    const curT = state.days[state.timer.day]?.tasks.find((x) => x.id === state.timer.taskId);
    if (curT) {
      html += `<div class="banner timer-banner"><span>⏱</span><span>正在做「${esc(curT.title)}」 · 已 ${timerElapsedMin()} 分钟</span><button class="btn small" data-action="timer-stop" style="margin-left:auto">停止</button></div>`;
    }
  }

  html += signalChips('warn', 2);
  html += briefCard();
  html += carryoverCard();

  if (!day?.plannedAt && tasks.length === 0) {
    html += `<div class="card"><div class="card-title">开始今天</div>
      <div class="small" style="color:var(--ink-2)">用 1 分钟把今天安排好：先定最多 3 件要事，落到时间块。</div>
      <div class="btn-row mt12">
        <button class="btn primary" data-action="plan-open">✦ 计划今天</button>
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
    html += `<div class="section-label"><span class="star">${SVG_STAR_SM}</span> 今日要事</div><div class="task-list">${sortTasks(mits).map((t) => taskRow(t, tk)).join('')}</div>`;
  }
  if (others.length) {
    html += `<div class="section-label">其他任务</div><div class="task-list">${sortTasks(others).map((t) => taskRow(t, tk)).join('')}</div>`;
  }
  if (!tasks.length) {
    html += `<div class="empty"><div class="empty-title">今天还没有任务</div>点右下输入框直接添加，或用「计划今天」</div>`;
  }
  html += `<div class="quick-add"><input type="text" placeholder="添加任务，回车确认" data-enter="qa-add">
    <button class="btn small" data-action="plan-open" title="让 AI 结合目标与作息安排今天">${AI_MARK} AI 安排</button></div></div>`;

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

// 教练观察卡：后台自动刷新（auto.js），↻ 手动立即刷新
function briefCard() {
  if (!hasKey()) return '';
  const b = state.assistant?.brief;
  if (!b || state.assistant.briefDate !== todayKey()) return '';
  const mins = Math.max(0, Math.round((Date.now() - (b.at || 0)) / 60000));
  const when = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : `${Math.floor(mins / 60)} 小时前`;
  return `<div class="card brief-card">
    <div class="ai-tag">✦ 教练观察<span class="muted" style="font-weight:400;margin-left:6px">${when}</span>
      <button class="title-action brief-refresh" data-action="brief-refresh" title="立即重新观察" ${briefLoading ? 'disabled' : ''}>${briefLoading ? '<span class="spinner"></span>' : SVG_REFRESH}</button></div>
    <div class="brief-headline">${esc(b.headline)}</div>
    ${b.suggestion ? `<div class="brief-sub">${esc(b.suggestion)}</div>` : ''}
  </div>`;
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
        ? `<button class="btn" data-action="review-day-ai" ${reviewAIState.loading ? 'disabled' : ''}>${reviewAIState.loading ? '<span class="spinner"></span> 思考中…' : `${AI_MARK} 教练点评`}</button>`
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
    html += `<div class="banner">${WARN_ICON}<span>目标太多等于没有目标——考虑暂停一些，聚焦最重要的 3-5 个。</span></div>`;
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
      `<div class="signal ${s.level}">${s.level === 'warn' ? WARN_ICON : '<span>·</span>'}<span>${esc(s.text)}</span></div>`).join('')}</div>`;
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
    body += `<div class="muted small mt8">生成于 ${fmtDay(dateKey(beijingDateOf(ins.insight.createdAt)), false)} · ${weekLabel(ins.week)}</div>`;
  } else {
    body += `<div class="small" style="color:var(--ink-2)">让 AI 基于你的全部数据做一次第一性原理分析：行为模式 → 最大瓶颈 → 杠杆点 → 下周实验。建议每周做一次。</div>`;
  }
  return `<div class="card"><div class="card-title"><span>${AI_MARK} 深度洞察</span></div>${body}
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
      ${hasKey() && weekSums.length ? `<button class="btn small" data-action="month-ai" data-mk="${mk}" ${monthAIState.loading ? 'disabled' : ''}>${monthAIState.loading ? '<span class="spinner"></span> 生成中…' : `${AI_MARK} AI 草拟`}</button>` : ''}
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

  <div class="field"><label>后台智能</label>
    <div class="seg">
      <button data-action="set-autoai" data-id="on" class="${s.autoAI !== false ? 'active' : ''}">开（推荐）</button>
      <button data-action="set-autoai" data-id="off" class="${s.autoAI === false ? 'active' : ''}">关</button>
    </div>
    <div class="hint">开启后教练会在后台自动工作：数据变化时刷新「教练观察」（每天 ≤10 次、轻量档位）、按需生成每周深度洞察、完成复盘后自动点评</div></div>

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
  <div class="muted small mt12">要事 First Things v1.4 · 数据存储在本机浏览器 · 「今天」按北京时间（UTC+8）判定 · <a href="https://github.com/oliverjiang5666-source/first-things" target="_blank" rel="noreferrer">GitHub</a></div>
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

// ----- 教练对话框 -----
// 一个入口装下所有事：安排/调整/记录 → AI 输出 ops 立即执行（可撤销）；
// 复盘一段话 → AI 整理成反思并标记完成；纯提问 → 只回答。
// 历史保存在内存（数据修改本身已持久化）；每轮调用都重建最新上下文。

let coachLog = [];   // {role:'user'|'assistant', text, applied?, skipped?, canUndo?, undone?, error?}
let coachAbort = null;
let coachBusy = false;

function coachMsgHTML(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  let receipts = '';
  if (m.applied?.length || m.skipped?.length) {
    receipts = `<div class="coach-ops${m.undone ? ' undone' : ''}">
      ${(m.applied || []).map((t) => `<div class="coach-op">✓ ${esc(t)}</div>`).join('')}
      ${(m.skipped || []).map((t) => `<div class="coach-op skip">✕ ${esc(t)}</div>`).join('')}
      ${m.undone ? '<div class="coach-op skip noline">这批修改已撤销</div>'
        : (m.canUndo ? '<button class="coach-undo" data-action="coach-undo">撤销这批修改</button>' : '')}
    </div>`;
  }
  return `<div class="msg assistant${m.error ? ' err' : ''}">${esc(m.text)}${receipts}</div>`;
}

function coachModal() {
  const msgs = coachLog.map(coachMsgHTML).join('');
  const pending = coachBusy ? `<div class="msg assistant pending">${SPARK} 正在理解并处理…</div>` : '';
  const emptyHint = `<div class="empty">安排、调整、记录、复盘，都直接说——<br>
    「明天上午 10 点安排 90 分钟写论文」<br>
    「跑步完成了，用时 40 分钟」<br>
    「今天复盘：上午很专注，下午被会议打散了…」<br>
    「我现在最该做什么？」</div>`;
  return `<h2>教练</h2><div class="modal-sub">直接说，教练自己理解、自己动手；改动立即生效，可一键撤销</div>
  <div class="chat-box">
    <div class="chat-log" id="chat-log">${msgs || (coachBusy ? '' : emptyHint)}${pending}</div>
    ${hasKey() ? `<div class="chat-input-row">
      <textarea placeholder="输入消息，回车发送" data-enter="coach-send" id="chat-input"></textarea>
      <button class="btn primary" data-action="coach-send" ${coachBusy ? 'disabled' : ''}>发送</button>
    </div>` : `<div class="mt12">${aiGate('chat', '')}</div>`}
  </div>
  ${hasKey() ? ctxPreview(buildContext('coach')) : ''}`;
}

function coachMount() {
  const log = $('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  $('#chat-input')?.focus();
}

// 发给模型的对话历史：带上执行回执，模型才知道自己上一轮做了什么、有没有被撤销
function coachApiMessages() {
  return coachLog.slice(-16).map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    let c = m.text;
    if (m.applied?.length) c += `\n[已执行] ${m.applied.join('；')}`;
    if (m.skipped?.length) c += `\n[已跳过] ${m.skipped.join('；')}`;
    if (m.undone) c += '\n[用户其后撤销了这批修改]';
    return { role: 'assistant', content: c };
  });
}

async function coachSend(text) {
  coachLog.push({ role: 'user', text });
  coachBusy = true;
  refreshModal();
  coachAbort = new AbortController();
  try {
    const r = await aiCoach(coachApiMessages(), coachAbort.signal);
    const msg = { role: 'assistant', text: r.reply || '好的。' };
    if (r.ops.length) {
      const snap = snapshot();
      const { applied, skipped } = applyOps(r.ops);
      msg.applied = applied;
      msg.skipped = skipped;
      if (applied.length) {
        lastSnapshot = snap;
        for (const m of coachLog) m.canUndo = false; // 单步撤销：只有最新一批可撤
        msg.canUndo = true;
      }
    }
    coachLog.push(msg);
  } catch (e) {
    if (e.name !== 'AbortError') coachLog.push({ role: 'assistant', text: `出错了：${e.message}`, error: true });
  }
  coachBusy = false; coachAbort = null;
  if (coachLog.length > 60) coachLog = coachLog.slice(-60);
  refreshModal();
}

// ----- plan day -----
// 交互设计（用户定的）：打开即 AI 从上层目标自动分解草案 → 用户说一段话 →
// AI 按话做最小调整（带上一轮草案）→ 采纳。采纳只增不删，已有任务永远保留。

let planState = { feedback: '', loading: false, error: null, proposal: null, checked: {} };

// 把当前草案序列化成文字，作为下一轮的「上一轮草案」传给 AI
function priorDayText(p) {
  const gname = (id) => (id && goalById(id) ? goalById(id).title : null);
  const line = (t, star) => `${star ? '★' : '-'} ${t.title}（${[t.blockStart || '未定时间', `${t.estMin || 30}分`, gname(t.goalId)].filter(Boolean).join('，')}）`;
  const parts = [...(p.mits || []).map((t) => line(t, true)), ...(p.others || []).map((t) => line(t, false))];
  for (const d of p.defer || []) parts.push(`建议推迟/放弃：${d.title}——${d.reason}`);
  if (p.rationale) parts.push(`草案思路：${p.rationale}`);
  return parts.join('\n');
}

function planModal() {
  const p = planState.proposal;
  const loading = planState.loading;
  let body = '';

  if (p) {
    const item = (t, idx, group) => `<div class="ai-item">
      <input type="checkbox" data-change="plan-check" data-key="${group}-${idx}" ${planState.checked[`${group}-${idx}`] !== false ? 'checked' : ''}>
      <div><div class="ai-item-title">${group === 'mits' ? `${SVG_STAR_SM} ` : ''}${esc(t.title)}</div>
      <div class="ai-item-meta">${[t.goalId && goalById(t.goalId) ? goalById(t.goalId).title : null, t.blockStart ? t.blockStart + ' 开始' : null, t.estMin + '分'].filter(Boolean).join(' · ')}</div></div>
    </div>`;
    body = `<div class="ai-card">
      <div class="ai-tag">✦ 今日草案<span class="muted" style="font-weight:400;margin-left:6px">从目标与本周要事分解</span></div>
      <div class="ai-rationale">${esc(p.rationale || '')}</div>
      ${p.mits.map((t, i) => item(t, i, 'mits')).join('')}
      ${p.others.map((t, i) => item(t, i, 'others')).join('')}
      ${p.defer?.length ? `<div class="section-label" style="margin-top:10px">建议推迟 / 放弃（不会自动执行）</div>${p.defer.map((d) => `<div class="ai-item"><div><div class="ai-item-title" style="color:var(--muted)">${esc(d.title)}</div><div class="ai-item-meta">${esc(d.reason)}</div></div></div>`).join('')}` : ''}
    </div>
    <div class="field mt12"><label>想调整？直接说一段话</label>
      <textarea data-change="plan-feedback" placeholder="例：10:00-11:30 有例会；跑步挪到晚上；再加一件「给妈妈打电话」；写作只留 60 分钟" style="min-height:56px">${esc(planState.feedback)}</textarea></div>
    <div class="btn-row">
      <button class="btn primary" data-action="plan-adopt" ${loading ? 'disabled' : ''}>采纳所选</button>
      <button class="btn" data-action="plan-adjust" ${loading ? 'disabled' : ''}>${loading ? '<span class="spinner"></span> 调整中…' : `${AI_MARK} 按我的话调整`}</button>
      <button class="btn ghost small" data-action="plan-ai" ${loading ? 'disabled' : ''}>重新生成</button>
    </div>`;
  } else if (loading) {
    body = `<div class="ai-card"><div class="ai-loading">${SPARK} 正在从你的目标、本周要事、昨日未完成与作息分解今天的草案…通常几十秒；若网络连不上 openrouter.ai，最多 150 秒会明确报错</div></div>`;
  } else if (hasKey()) {
    body = `<div class="field"><label>可以先说点什么（也可以留空，AI 直接从目标分解）</label>
      <textarea data-change="plan-feedback" placeholder="固定日程（几点开会）、今天的状态、特别想做的事…" style="min-height:72px">${esc(planState.feedback)}</textarea></div>
    <div class="btn-row">
      <button class="btn primary" data-action="plan-ai">✦ 生成今日草案</button>
      <button class="btn" data-action="plan-manual">手动添加</button>
    </div>`;
  } else {
    body = `${aiGate('plan-day', '')}<div class="btn-row mt8"><button class="btn" data-action="plan-manual">手动添加</button></div>`;
  }

  return `<h2>计划今天</h2><div class="modal-sub">AI 先从上层目标分解草案 → 你一句话调整 → 采纳。你已有的任务不会被动过。</div>
  ${planState.error ? `<div class="ai-error">${esc(planState.error)}</div>` : ''}
  ${body}
  ${hasKey() ? ctxPreview(planDayPrompt(planState.feedback || '')) : ''}
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
      <button class="chip ${t.mit ? 'q2' : ''}" data-action="task-mit">${SVG_STAR_SM} 今日要事</button>
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
    ${hasKey() ? `<button class="btn" data-action="gf-ai" ${d.ai.loading ? 'disabled' : ''}>${d.ai.loading ? '<span class="spinner"></span> 第一性原理分解中…' : `${AI_MARK} AI 帮我分解这个目标`}</button>` : `<button class="btn small ghost" data-action="copy-prompt" data-purpose="decompose">复制分解指令给 AI</button>`}
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
      ${hasKey() ? `<button class="btn small" data-action="wiz-ai-summary" ${w.sumLoading ? 'disabled' : ''}>${w.sumLoading ? '<span class="spinner"></span> 草拟中…' : `${AI_MARK} AI 草拟`}</button>` : ''}
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
    return `<h2>每周规划 · 本周要事</h2><div class="modal-sub">AI 从目标与里程碑分解建议 → 你一句话调整 → 点「＋」挑进本周。已选的不会被动过。</div>${stepsBar}
    <div class="task-list">${chosen || '<div class="empty">还没选：从下面 AI 建议里点「＋」挑，或手动添加</div>'}</div>
    <div class="quick-add" style="margin-top:8px"><input type="text" placeholder="手动添加一件要事，回车确认" data-enter="wiz-manual-add"></div>
    <div class="field mt12"><label>AI 建议（点「＋」加入本周）</label>
      ${w.sugError ? `<div class="ai-error">${esc(w.sugError)}</div>` : ''}
      ${w.sugLoading && !sugs ? `<div class="small" style="color:var(--ink-2)"><span class="spinner"></span> 正在从目标与里程碑分解本周要事…</div>` : ''}
      ${w.rationale && sugs ? `<div class="ai-rationale" style="margin-bottom:6px">${esc(w.rationale)}</div>` : ''}
      <div>${sugs || (w.sugLoading ? '' : '<span class="muted small">点下方按钮获取建议</span>')}</div>
      <div class="btn-row mt8">
        ${hasKey() ? `<button class="btn small" data-action="wiz-ai-suggest" ${w.sugLoading ? 'disabled' : ''}>${w.sugLoading ? '<span class="spinner"></span> 思考中…' : sugs ? `${SVG_REFRESH} 重新生成` : `${AI_MARK} AI 建议本周要事`}</button>` : `<button class="btn small ghost" data-action="copy-prompt" data-purpose="plan-week">复制上下文给 AI</button>`}
        <button class="btn small ghost" data-action="wiz-local-suggest">用上周未完成 + 收集箱</button>
      </div>
      ${hasKey() && sugs ? `<div class="field mt8" style="margin-bottom:0"><label>对建议不满意？直接说</label>
        <textarea data-change="wiz-feedback" placeholder="例：MVP 那条太大，拆小一点；再加一条恢复跑步；健康类只留一条" style="min-height:44px">${esc(w.feedback || '')}</textarea>
        <div class="btn-row mt8"><button class="btn small" data-action="wiz-ai-adjust" ${w.sugLoading ? 'disabled' : ''}>${w.sugLoading ? '<span class="spinner"></span> 调整中…' : `${AI_MARK} 按我的话调整`}</button></div></div>` : ''}
    </div>
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
    ${hasKey() ? `<button class="btn small" data-action="wr-ai" ${wr.loading ? 'disabled' : ''}>${wr.loading ? '<span class="spinner"></span> 草拟中…' : `${AI_MARK} AI 草拟`}</button>` : ''}
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
  'open-chat': () => openModal(coachModal, coachMount),

  // --- settings ---
  'set-effort': (el) => { update((s) => { s.settings.effort = el.dataset.id; }); refreshModal(); },
  'set-autoai': (el) => { update((s) => { s.settings.autoAI = el.dataset.id === 'on'; }); refreshModal(); },
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

  // --- 教练对话框 ---
  'coach-send': () => {
    const input = $('#chat-input');
    const text = input?.value.trim();
    if (!text || coachBusy) return;
    input.value = '';
    coachSend(text);
  },
  // 今天页的输入条：写了字就带着这句话进对话框，空着点开也行
  'coach-bar': () => {
    const inp = $('.nl-bar input');
    const text = inp?.value.trim();
    if (inp) inp.value = '';
    openModal(coachModal, coachMount);
    if (text && !coachBusy) coachSend(text);
  },
  'coach-undo': () => {
    if (!lastSnapshot) { toast('没有可撤销的修改'); return; }
    restoreSnapshot(lastSnapshot);
    lastSnapshot = null;
    const m = [...coachLog].reverse().find((x) => x.canUndo);
    if (m) { m.canUndo = false; m.undone = true; }
    render(); refreshModal(); toast('已撤销');
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
    // 若正在给这件事计时，先停表把实际用时记进去，再标记完成
    if (state.timer?.taskId === el.dataset.id) {
      const r = stopTimer();
      if (r) toast(`「${r.task.title}」记入 ${r.minutes} 分钟`);
    }
    update(() => {
      const t = state.days[el.dataset.day]?.tasks.find((x) => x.id === el.dataset.id);
      if (t) t.done = !t.done;
    });
    render();
  },

  // --- 计时 ---
  'timer-start': (el) => {
    startTimer(el.dataset.day, el.dataset.id);
    render();
  },
  'timer-stop': () => {
    const r = stopTimer();
    if (r) toast(`「${r.task.title}」记入 ${r.minutes} 分钟`);
    render();
  },

  // --- 教练观察 ---
  'brief-refresh': async () => {
    if (briefLoading) return;
    briefLoading = true; render();
    await refreshBrief();
    briefLoading = false; render();
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
    planState = { feedback: '', loading: false, error: null, proposal: null, checked: {} };
    // 打开先给输入框：想法可以先说（也可以留空），点「生成」才开始——
    // 不再自动起跑，用户对时机有掌控，也不会一打开就压上一次 AI 调用
    openModal(planModal, () => $('.modal textarea')?.focus());
  },
  'plan-ai': () => withAI(planState, refreshModal, async () => {
    planState.proposal = null;
    const plan = await aiPlanDay(planState.feedback || '');
    planState.proposal = plan;
    planState.checked = {};
    planState.feedback = '';
  }),
  // 带上一轮草案 + 用户的一段话 → 最小调整
  'plan-adjust': () => withAI(planState, refreshModal, async () => {
    if (!planState.proposal) return;
    const prior = priorDayText(planState.proposal);
    const plan = await aiPlanDay(planState.feedback || '', prior);
    planState.proposal = plan;
    planState.checked = {};
    planState.feedback = '';
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
    // 后台自动请教练点评（完成后随 update 自动重绘出现）
    if (hasKey() && state.settings.autoAI !== false) autoComment();
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
    if (state.timer?.taskId === editTask.id) stopTimer();
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
      rationale: '', feedback: '',
    };
    if (!Object.keys(wiz.budgets).length) {
      for (const g of activeGoals()) if (g.weeklyBudgetHours) wiz.budgets[g.id] = g.weeklyBudgetHours;
    }
    // 上周没数据会直接跳到第 2 步：此时立刻让 AI 从目标分解本周要事
    const lastSt = weekStats(lastWk);
    const hasLast = lastSt.tasksTotal > 0 || state.weeks[lastWk]?.plannedAt;
    openModal(wizardModal);
    if (!hasLast && hasKey() && !wiz.suggestions.length) Actions['wiz-ai-suggest']();
  },
  'wiz-back': () => { wiz.step = Math.max(1, wiz.step - 1); refreshModal(); },
  'wiz-next': () => {
    if (wiz.step === 1 && wiz.summary.trim()) {
      update(() => { ensureWeek(wiz.lastWk).review = { summary: wiz.summary.trim(), reviewedAt: Date.now() }; });
    }
    wiz.step = Math.min(3, wiz.step + 1); refreshModal();
    // 进入第 2 步时自动分解（AI 先给，人再调）
    if (wiz.step === 2 && hasKey() && !wiz.suggestions.length && !wiz.sugLoading) Actions['wiz-ai-suggest']();
  },
  'wiz-ai-summary': () => withAI({ set loading(v) { wiz.sumLoading = v; }, set error(v) { wiz.sumError = v; } }, refreshModal, async () => {
    wiz.summary = (await aiWeekSummary(weekContextFor(wiz.lastWk))).trim();
  }),
  'wiz-ai-suggest': () => withAI({ set loading(v) { wiz.sugLoading = v; }, set error(v) { wiz.sugError = v; } }, refreshModal, async () => {
    const plan = await aiPlanWeek(wiz.feedback || '');
    wiz.suggestions = plan.priorities;
    wiz.rationale = plan.rationale;
    wiz.feedback = '';
  }),
  // 带当前建议草案 + 用户的一段话 → 最小调整（已挑进本周的不动）
  'wiz-ai-adjust': () => withAI({ set loading(v) { wiz.sugLoading = v; }, set error(v) { wiz.sugError = v; } }, refreshModal, async () => {
    const prior = [
      ...wiz.chosen.map((c) => `已选定（不要改动）：${c.title}`),
      ...(wiz.suggestions || []).map((s) => `- ${s.title}${s.goalId && goalById(s.goalId) ? `（${goalById(s.goalId).title}）` : ''}${s.reason ? `：${s.reason}` : ''}`),
      wiz.rationale ? `草案思路：${wiz.rationale}` : null,
    ].filter(Boolean).join('\n');
    const plan = await aiPlanWeek(wiz.feedback || '', prior);
    wiz.suggestions = plan.priorities;
    wiz.rationale = plan.rationale;
    wiz.feedback = '';
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
    if (purpose === 'plan-day') text = planDayPrompt(planState?.feedback || '');
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
  'plan-feedback': (el) => { planState.feedback = el.value; },
  'plan-check': (el) => { planState.checked[el.dataset.key] = el.checked; },
  'wiz-feedback': (el) => { wiz.feedback = el.value; },
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
