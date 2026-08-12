// ============ hierarchical context builder ============
// 分层记忆：今天全量 → 近 7 天单行摘要 → 近 4 周复盘 → 月度浓缩。
// 复盘仪式本身就是压缩机制：旧的细节永远不进上下文，只有蒸馏后的摘要进。

import {
  state, activeGoals, goalById, currentMilestone, quadrantOf, taskMinutes,
  todayKey, addDays, fmtDay, fmtShort, weekLabel, weekDays, thisWeekKey, shiftWeek,
  dayStats, weekStats, weekGoalMinutes, unfinishedYesterday, fmtMonth, QUAD_LABEL,
  computeSignals, nowBeijing,
} from './store.js';

const BUDGET_CHARS = 9000;

const hours = (min) => (min / 60).toFixed(1).replace(/\.0$/, '');

function nowLine() {
  const d = nowBeijing();
  const pad = (n) => String(n).padStart(2, '0');
  return `【当前时间】${todayKey()} ${fmtDay(todayKey())} ${pad(d.getHours())}:${pad(d.getMinutes())}（北京时间，所有日期与时间块均以此为准）`;
}

function profileSection() {
  const p = state.profile;
  const lines = [];
  if (p.aboutMe?.trim()) lines.push(`【关于我】\n${p.aboutMe.trim()}`);
  const body = [];
  if (p.wake) body.push(`起床 ${p.wake}`);
  if (p.sleep) body.push(`就寝 ${p.sleep}`);
  if (p.exercise?.trim()) body.push(`运动：${p.exercise.trim()}`);
  if (body.length) lines.push(`【作息与运动】${body.join('；')}`);
  if (p.principles?.trim()) lines.push(`【我的时间原则】\n${p.principles.trim()}`);
  return lines.join('\n\n');
}

function goalsSection() {
  const goals = activeGoals();
  if (!goals.length) return '【目标清单】（还没有目标）';
  const twk = thisWeekKey();
  const thisMin = weekGoalMinutes(twk);
  const lastMin = weekGoalMinutes(shiftWeek(twk, -1));
  const lines = goals.map((g) => {
    const parts = [`- [id:${g.id}] ${g.title}（${g.area}·${g.horizon}${g.weeklyBudgetHours ? `，预算 ${g.weeklyBudgetHours}h/周` : ''}）`];
    if (g.why) parts.push(`  为什么重要：${g.why}`);
    const ms = currentMilestone(g);
    if (ms) parts.push(`  当前里程碑：${ms.title}（已完成 ${g.milestones.filter((m) => m.done).length}/${g.milestones.length} 个里程碑）`);
    parts.push(`  投入：本周 ${hours(thisMin[g.id] || 0)}h，上周 ${hours(lastMin[g.id] || 0)}h`);
    return parts.join('\n');
  });
  return `【目标清单】（进行中）\n${lines.join('\n')}`;
}

function taskLine(t) {
  const g = t.goalId ? goalById(t.goalId) : null;
  const bits = [t.done ? '[完成]' : '[待办]', t.title];
  const meta = [];
  if (g) meta.push(`目标:${g.title}`);
  meta.push(QUAD_LABEL[quadrantOf(t)]);
  if (t.blockStart) meta.push(`${t.blockStart}起`);
  meta.push(`${taskMinutes(t)}分`);
  if (t.mit) meta.push('今日要事');
  return `  - ${bits.join(' ')}（${meta.join('，')}）`;
}

function weekSection() {
  const twk = thisWeekKey();
  const wk = state.weeks[twk];
  const head = `【本周计划】${weekLabel(twk)}`;
  if (!wk || !wk.plannedAt) return `${head}\n（本周还未规划）`;
  const st = weekStats(twk);
  const lines = wk.priorities.map((p) => {
    const g = p.goalId ? goalById(p.goalId) : null;
    return `  - ${p.done ? '[完成]' : '[进行]'} ${p.title}${g ? `（${g.title}）` : ''}`;
  });
  const budget = Object.entries(wk.budgets || {})
    .map(([gid, h]) => {
      const g = goalById(gid);
      return g ? `${g.title} ${hours(st.goalMinutes[gid] || 0)}/${h}h` : null;
    }).filter(Boolean).join('；');
  return [
    head, '本周要事：', ...lines,
    budget ? `时间预算（已投入/预算）：${budget}` : '',
    st.q2Share != null ? `本周已完成时长中「重要不紧急」占比 ${(st.q2Share * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('\n');
}

function todaySection(purpose) {
  const tk = todayKey();
  const day = state.days[tk];
  const lines = [`【今天】${fmtDay(tk)}`];
  if (!day || !day.tasks.length) lines.push('（今天还没有任务）');
  else {
    for (const t of day.tasks) if (!t.dropped) lines.push(taskLine(t));
    if (day.reflection) lines.push(`今日反思：${day.reflection}`);
  }
  if (purpose === 'plan-day' || purpose === 'plan-week') {
    const un = unfinishedYesterday();
    if (un.tasks.length) {
      lines.push(`【昨天未完成】`);
      for (const t of un.tasks) lines.push(`  - ${t.title}${t.goalId && goalById(t.goalId) ? `（${goalById(t.goalId).title}）` : ''}`);
    }
    if (state.inbox.length) {
      lines.push(`【收集箱】（未整理的想法）`);
      for (const it of state.inbox.slice(0, 12)) lines.push(`  - ${it.title}`);
    }
  }
  return lines.join('\n');
}

function recentDaysSection(n = 7) {
  const lines = [];
  for (let i = 1; i <= n; i++) {
    const k = addDays(todayKey(), -i);
    const day = state.days[k];
    if (!day || !day.tasks.length) continue;
    const s = dayStats(k);
    const bits = [`完成 ${s.done}/${s.total}`];
    if (s.q2Share != null) bits.push(`重要不紧急占比 ${(s.q2Share * 100).toFixed(0)}%`);
    if (day.reflection) bits.push(`反思：${day.reflection.slice(0, 60)}`);
    lines.push(`- ${fmtShort(k)} ${fmtDay(k).split('· ')[1]}：${bits.join('，')}`);
  }
  if (!lines.length) return '';
  return `【最近 ${n} 天】\n${lines.join('\n')}`;
}

function weeklyReviewsSection(n = 4) {
  const lines = [];
  let wk = shiftWeek(thisWeekKey(), -1);
  for (let i = 0; i < n; i++) {
    const w = state.weeks[wk];
    if (w?.review?.summary) lines.push(`- ${weekLabel(wk)}：${w.review.summary}`);
    wk = shiftWeek(wk, -1);
  }
  if (!lines.length) return '';
  return `【近几周复盘】\n${lines.join('\n')}`;
}

function monthsSection(n = 2) {
  const keys = Object.keys(state.months).sort().reverse().slice(0, n);
  const lines = keys
    .filter((mk) => state.months[mk]?.review?.summary)
    .map((mk) => `- ${fmtMonth(mk)}：${state.months[mk].review.summary}`);
  if (!lines.length) return '';
  return `【月度摘要】\n${lines.join('\n')}`;
}

function signalsSection() {
  const sigs = computeSignals();
  if (!sigs.length) return '';
  return `【系统观察到的信号】（由应用根据数据自动计算）\n${sigs.map((s) => `- ${s.level === 'warn' ? '⚠ ' : ''}${s.text}`).join('\n')}`;
}

function lastInsightSection() {
  const keys = Object.keys(state.weeks).sort().reverse();
  for (const wk of keys) {
    const ins = state.weeks[wk]?.insight;
    if (ins) {
      return `【上次深度洞察】（${weekLabel(wk)} 生成）\n瓶颈：${ins.bottleneck?.title || ''}\n定下的实验：${ins.experiment?.title || ''}（${ins.experiment?.how || ''}）`;
    }
  }
  return '';
}

// Assemble under a char budget. Sections are ordered by importance;
// when over budget we drop from the tail (oldest, most-compressed tiers first).
export function buildContext(purpose = 'chat') {
  const core = [nowLine(), profileSection(), goalsSection(), weekSection(), todaySection(purpose), signalsSection()]
    .filter(Boolean);
  let optional = [recentDaysSection(7), lastInsightSection(), weeklyReviewsSection(4), monthsSection(2)].filter(Boolean);

  let text = [...core, ...optional].join('\n\n');
  while (text.length > BUDGET_CHARS && optional.length) {
    optional.pop();
    text = [...core, ...optional].join('\n\n');
  }
  if (text.length > BUDGET_CHARS) {
    // last resort: trim recent-days detail
    text = core.join('\n\n').slice(0, BUDGET_CHARS);
  }
  return text;
}

export function contextMeta(text) {
  return `${text.length} 字符 ≈ ${Math.round(text.length / 2.2)} tokens`;
}
