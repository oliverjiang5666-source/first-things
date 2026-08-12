// ============ state, persistence, dates, stats ============

const KEY = 'yaoshi.v1';

export const AREAS = ['工作', '学习', '健康', '关系', '生活', '其他'];
export const HORIZONS = ['本月', '本季度', '今年', '长期'];

export const DEFAULT_PRINCIPLES = `1. 重要 = 服务于我的目标；紧急 ≠ 重要。
2. 先给重要不紧急的事（和睡眠、运动）预留时间，再安排其余。
3. 每天最多 3 件要事，落到具体时间块；做完比做多重要。
4. 晚上复盘 2 分钟，周日规划 15 分钟，不断链。`;

export function defaultState() {
  return {
    version: 1,
    profile: { aboutMe: '', principles: DEFAULT_PRINCIPLES, wake: '07:00', sleep: '23:30', exercise: '' },
    goals: [],
    weeks: {},   // "2026-W33" -> { priorities:[{id,title,goalId,done}], budgets:{goalId:hours}, plannedAt, review:{summary,reviewedAt} }
    days: {},    // "2026-08-11" -> { tasks:[...], reflection, aiComment, plannedAt, reviewedAt }
    months: {},  // "2026-08" -> { review:{summary,reviewedAt} }
    inbox: [],   // [{id,title,createdAt}]
    settings: { apiKey: '', model: 'openai/gpt-5.6-sol', effort: 'max', theme: 'auto', lastExportAt: null },
  };
}

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return migrate(s);
  } catch (e) {
    console.error('load failed', e);
    return defaultState();
  }
}

function migrate(s) {
  const d = defaultState();
  s.version = s.version || 1;
  s.profile = { ...d.profile, ...(s.profile || {}) };
  s.settings = { ...d.settings, ...(s.settings || {}) };
  if (s.settings.model && !s.settings.model.includes('/')) s.settings.model = d.settings.model;
  if (!['max', 'xhigh', 'high', 'medium', 'low'].includes(s.settings.effort)) s.settings.effort = d.settings.effort;
  s.goals = s.goals || []; s.weeks = s.weeks || {}; s.days = s.days || {};
  s.months = s.months || {}; s.inbox = s.inbox || [];
  for (const g of s.goals) { g.milestones = g.milestones || []; }
  return s;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('save failed', e); }
}

let listeners = [];
export function subscribe(fn) { listeners.push(fn); }
export function update(fn) {
  if (fn) fn(state);
  save();
  listeners.forEach((l) => l());
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
}

// ---------- dates (all local-time; toISOString would shift the day in non-UTC zones) ----------

const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k, n) {
  const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d);
}
export function todayKey() { return dateKey(new Date()); }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function fmtDay(k, withWeekday = true) {
  const d = parseKey(k);
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeekday ? `${base} · ${WEEKDAYS[d.getDay()]}` : base;
}
export function fmtShort(k) {
  const d = parseKey(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function weekdayOf(k) { return WEEKDAYS[parseKey(k).getDay()]; }

function isoWeekParts(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Thu = new Date(isoYear, 0, 4 - jan4DayNum + 3);
  const week = 1 + Math.round((d - week1Thu) / (7 * 86400000));
  return { year: isoYear, week };
}
export function weekKeyOf(d = new Date()) {
  const { year, week } = isoWeekParts(d);
  return `${year}-W${pad(week)}`;
}
export function thisWeekKey() { return weekKeyOf(new Date()); }

export function weekStart(weekKey) {
  const [y, w] = weekKey.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const mondayW1 = new Date(y, 0, 4 - jan4DayNum);
  mondayW1.setDate(mondayW1.getDate() + (w - 1) * 7);
  return mondayW1;
}
export function weekDays(weekKey) {
  const start = weekStart(weekKey);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i); return dateKey(d);
  });
}
export function weekLabel(weekKey) {
  const [, w] = weekKey.split('-W');
  const days = weekDays(weekKey);
  return `第${Number(w)}周 · ${fmtShort(days[0])} – ${fmtShort(days[6])}`;
}
export function shiftWeek(weekKey, n) {
  const start = weekStart(weekKey);
  start.setDate(start.getDate() + n * 7);
  return weekKeyOf(start);
}
export function monthKeyOf(k = todayKey()) { return k.slice(0, 7); }
export function fmtMonth(mk) {
  const [y, m] = mk.split('-');
  return `${y}年${Number(m)}月`;
}

// ---------- accessors ----------

export function ensureDay(k) {
  if (!state.days[k]) state.days[k] = { tasks: [], reflection: '', aiComment: '', plannedAt: null, reviewedAt: null };
  return state.days[k];
}
export function ensureWeek(wk) {
  if (!state.weeks[wk]) state.weeks[wk] = { priorities: [], budgets: {}, plannedAt: null, review: null };
  return state.weeks[wk];
}
export function activeGoals() {
  return state.goals.filter((g) => g.status === 'active');
}
export function goalById(id) {
  return state.goals.find((g) => g.id === id) || null;
}
export function goalColor(g) {
  return `var(--g${(g.colorIdx ?? 0) % 6})`;
}
export function currentMilestone(g) {
  return (g.milestones || []).find((m) => !m.done) || null;
}

// quadrant: importance is structural (linked to a goal), urgency is a flag
export function quadrantOf(task) {
  const important = !!task.goalId;
  if (important && task.urgent) return 1;
  if (important && !task.urgent) return 2;
  if (!important && task.urgent) return 3;
  return 4;
}
export const QUAD_LABEL = { 1: '重要·紧急', 2: '重要·不紧急', 3: '紧急·不重要', 4: '其他' };

export function newTask(title, extra = {}) {
  return {
    id: uid(), title: title.trim(), goalId: null, urgent: false, mit: false,
    done: false, estMin: 30, actMin: null, blockStart: null,
    createdAt: Date.now(), ...extra,
  };
}

export function taskMinutes(t) { return t.actMin ?? t.estMin ?? 30; }

// ---------- stats ----------

export function dayStats(k) {
  const day = state.days[k];
  if (!day || !day.tasks.length) return { total: 0, done: 0, doneMin: 0, q2Min: 0, q1Min: 0, q2Share: null };
  let done = 0, doneMin = 0, q2Min = 0, q1Min = 0;
  for (const t of day.tasks) {
    if (t.dropped) continue;
    if (t.done) {
      done++;
      const min = taskMinutes(t);
      doneMin += min;
      const q = quadrantOf(t);
      if (q === 2) q2Min += min;
      if (q === 1) q1Min += min;
    }
  }
  const total = day.tasks.filter((t) => !t.dropped).length;
  return { total, done, doneMin, q2Min, q1Min, q2Share: doneMin > 0 ? q2Min / doneMin : null };
}

export function weekGoalMinutes(weekKey) {
  const byGoal = {};
  for (const k of weekDays(weekKey)) {
    const day = state.days[k];
    if (!day) continue;
    for (const t of day.tasks) {
      if (t.done && t.goalId) byGoal[t.goalId] = (byGoal[t.goalId] || 0) + taskMinutes(t);
    }
  }
  return byGoal; // minutes
}

export function weekStats(weekKey) {
  const wk = state.weeks[weekKey];
  let doneMin = 0, q2Min = 0, daysReviewed = 0, tasksDone = 0, tasksTotal = 0;
  for (const k of weekDays(weekKey)) {
    const s = dayStats(k);
    doneMin += s.doneMin; q2Min += s.q2Min; tasksDone += s.done; tasksTotal += s.total;
    if (state.days[k]?.reviewedAt) daysReviewed++;
  }
  const prios = wk ? wk.priorities : [];
  return {
    q2Share: doneMin > 0 ? q2Min / doneMin : null,
    doneMin, q2Min, tasksDone, tasksTotal, daysReviewed,
    priosDone: prios.filter((p) => p.done).length, priosTotal: prios.length,
    goalMinutes: weekGoalMinutes(weekKey),
  };
}

export function reviewStreak() {
  let streak = 0;
  let k = todayKey();
  if (!state.days[k]?.reviewedAt) k = addDays(k, -1); // today not yet reviewed doesn't break the chain
  while (state.days[k]?.reviewedAt) { streak++; k = addDays(k, -1); }
  return streak;
}

export function hasAnyData() {
  return state.goals.length > 0 || Object.keys(state.days).length > 0 || state.inbox.length > 0;
}

// ---------- carry-over ----------

export function unfinishedYesterday() {
  const yk = addDays(todayKey(), -1);
  const day = state.days[yk];
  if (!day) return { key: yk, tasks: [] };
  return { key: yk, tasks: day.tasks.filter((t) => !t.done && !t.carried && !t.dropped) };
}

// ---------- behavior signals (local, deterministic, free) ----------
// 主动智能的第一层：不调用模型，纯靠数据规则发现模式。
// 这些信号既直接展示给用户，也作为素材喂给 AI 深度洞察。

export function computeSignals() {
  const signals = [];
  const twk = thisWeekKey();
  const lastWk = shiftWeek(twk, -1);
  const prevWk = shiftWeek(twk, -2);
  const tk = todayKey();

  // 1. 目标连续零投入
  const lastMin = weekGoalMinutes(lastWk);
  const prevMin = weekGoalMinutes(prevWk);
  const thisMin = weekGoalMinutes(twk);
  for (const g of activeGoals()) {
    const hadHistory = Object.keys(state.days).some((k) => k < weekDays(lastWk)[0]);
    if (!hadHistory) continue;
    if (!lastMin[g.id] && !prevMin[g.id] && !thisMin[g.id]) {
      signals.push({ level: 'warn', key: `zero-${g.id}`, text: `「${g.title}」已连续两周以上零投入——它还是你的目标吗？` });
    } else if (!lastMin[g.id] && !thisMin[g.id]) {
      signals.push({ level: 'info', key: `low-${g.id}`, text: `「${g.title}」上周和本周都还没有投入时间` });
    }
  }

  // 2. Q2 占比明显下滑
  const sThis = weekStats(twk), sLast = weekStats(lastWk);
  if (sThis.q2Share != null && sLast.q2Share != null && sLast.q2Share - sThis.q2Share > 0.15) {
    signals.push({ level: 'warn', key: 'q2-drop', text: `本周「重要不紧急」时间占比 ${(sThis.q2Share * 100).toFixed(0)}%，比上周下降了 ${((sLast.q2Share - sThis.q2Share) * 100).toFixed(0)} 个百分点——紧急的事在挤占重要的事` });
  }

  // 3. 要事被紧急事挤掉（昨天）
  const yk = addDays(tk, -1);
  const yday = state.days[yk];
  if (yday) {
    const mits = yday.tasks.filter((t) => t.mit && !t.dropped);
    const mitsDone = mits.filter((t) => t.done).length;
    const urgentDone = yday.tasks.filter((t) => t.done && t.urgent && !t.goalId).length;
    if (mits.length > 0 && mitsDone === 0 && urgentDone > 0) {
      signals.push({ level: 'warn', key: 'crowded-out', text: '昨天的要事一件都没完成，但完成了几件紧急琐事——要事正在被挤掉' });
    }
  }

  // 4. 复盘断链
  let noReviewDays = 0;
  for (let i = 1; i <= 5; i++) {
    const d = state.days[addDays(tk, -i)];
    if (d && d.tasks.length && !d.reviewedAt) noReviewDays++;
    else if (d?.reviewedAt) break;
  }
  if (noReviewDays >= 3) {
    signals.push({ level: 'info', key: 'no-review', text: `已经 ${noReviewDays} 天没有晚间复盘了——复盘是整个系统的记忆来源` });
  }

  // 5. 任务侵占睡眠
  const sleepT = state.profile.sleep;
  if (sleepT) {
    let lateCount = 0;
    for (let i = 0; i < 3; i++) {
      const d = state.days[addDays(tk, -i)];
      if (!d) continue;
      if (d.tasks.some((t) => t.blockStart && !t.dropped && t.blockStart >= addMinutes(sleepT, -60))) lateCount++;
    }
    if (lateCount >= 2) {
      signals.push({ level: 'warn', key: 'sleep', text: `最近 ${lateCount} 天都有任务排到就寝前 1 小时内——睡眠是地基，别拿它让路` });
    }
  }

  // 6. 本周还没规划（周二及以后）
  const dow = (new Date().getDay() + 6) % 7; // Mon=0
  if (dow >= 1 && !state.weeks[twk]?.plannedAt && hasAnyData()) {
    signals.push({ level: 'info', key: 'no-week-plan', text: '本周还没有做每周规划——10 分钟就够' });
  }

  // 7. 深度洞察节律：积累了数据却久未做第一性分析
  let latestIns = 0;
  for (const w of Object.values(state.weeks)) if (w.insight?.createdAt) latestIns = Math.max(latestIns, w.insight.createdAt);
  const dataDays = Object.values(state.days).filter((d) => d.tasks.length).length;
  if (dataDays >= 5 && (!latestIns || Date.now() - latestIns > 8 * 864e5)) {
    signals.push({
      level: 'info', key: 'insight-due',
      text: latestIns
        ? '距上次深度洞察已超过一周——到「回顾」让教练重新分析你的模式与瓶颈'
        : '数据已经足够——到「回顾」做第一次深度洞察，看看你的行为模式与最大瓶颈',
    });
  }

  const order = { warn: 0, info: 1 };
  return signals.sort((a, b) => order[a.level] - order[b.level]).slice(0, 4);
}

function addMinutes(hhmm, delta) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + delta + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------- export / import ----------

export function exportJSON() {
  const safe = { ...state, settings: { ...state.settings, apiKey: '' } }; // 备份文件不含 API key
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yaoshi-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  update((s) => { s.settings.lastExportAt = Date.now(); });
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.version || !parsed.days) {
    throw new Error('文件格式不对：这不是「要事」的备份文件');
  }
  const apiKey = state.settings.apiKey; // keep local key when restoring on a new device
  state = migrate(parsed);
  if (!state.settings.apiKey) state.settings.apiKey = apiKey;
  update();
}

export function wipeAll() {
  state = defaultState();
  update();
}

// ---------- demo data ----------

export function seedDemo() {
  const s = defaultState();
  s.profile.aboutMe = '示例：我是一名想做出真正作品的工程师。现阶段最重要的是完成我的开源项目 v1，并保持健康。固定日程：周二、周四 10:00–11:30 团队例会。晚上 10 点后效率低，适合读书。';
  s.profile.exercise = '慢跑 30 分钟，每周一、三、五，18:30';
  const mk = (title, why, area, horizon, hours, idx, milestones) => ({
    id: uid(), title, why, area, horizon, status: 'active',
    weeklyBudgetHours: hours, colorIdx: idx, createdAt: Date.now(),
    milestones: milestones.map((m, i) => ({ id: uid(), title: m, done: i === 0 })),
  });
  const g1 = mk('开源项目发布 v1', '做出被人真正使用的作品，是我今年最重要的事', '工作', '本季度', 10,
    0, ['完成核心功能设计', '9月底：跑通 MVP', '10月底：内测 10 个用户', '11月：公开发布 v1']);
  const g2 = mk('保持运动与好睡眠', '身体是所有目标的地基，垮了什么都做不了', '健康', '长期', 3,
    1, ['连续 4 周每周跑 3 次']);
  const g3 = mk('系统学习分布式系统', '为下一阶段的职业跃迁打底', '学习', '今年', 4,
    2, ['读完 DDIA 前 5 章', '完成 MIT 6.824 前 3 个 lab']);
  s.goals = [g1, g2, g3];

  const today = todayKey();
  const twk = thisWeekKey();
  const lastWk = shiftWeek(twk, -1);

  s.weeks[twk] = {
    priorities: [
      { id: uid(), title: '完成 MVP 的数据层与同步逻辑', goalId: g1.id, done: false },
      { id: uid(), title: '跑步 3 次', goalId: g2.id, done: false },
      { id: uid(), title: '读完 DDIA 第 3 章并做笔记', goalId: g3.id, done: false },
    ],
    budgets: { [g1.id]: 10, [g2.id]: 3, [g3.id]: 4 },
    plannedAt: Date.now(), review: null,
  };
  s.weeks[lastWk] = {
    priorities: [
      { id: uid(), title: '完成 MVP 技术选型', goalId: g1.id, done: true },
      { id: uid(), title: '跑步 3 次', goalId: g2.id, done: true },
      { id: uid(), title: '读完 DDIA 第 2 章', goalId: g3.id, done: false },
    ],
    budgets: { [g1.id]: 10, [g2.id]: 3, [g3.id]: 4 },
    plannedAt: Date.now() - 7 * 864e5,
    review: { summary: '完成了技术选型和原型验证，比预期顺利。DDIA 只读了一半——晚上被临时会议占掉两次。下周把学习时间挪到早晨，先做最重要的再开消息。', reviewedAt: Date.now() - 864e5 },
  };

  const mkTask = (title, goalId, opts = {}) => ({
    id: uid(), title, goalId, urgent: false, mit: false, done: true,
    estMin: 60, actMin: null, blockStart: null, createdAt: Date.now(), ...opts,
  });
  for (let i = 7; i >= 1; i--) {
    const k = addDays(today, -i);
    const tasks = [];
    tasks.push(mkTask('深度工作：MVP 开发', g1.id, { mit: true, estMin: 90, blockStart: '09:00' }));
    if (i % 2 === 1) tasks.push(mkTask('慢跑 30 分钟', g2.id, { estMin: 30, blockStart: '18:30' }));
    if (i % 3 === 0) tasks.push(mkTask('读 DDIA + 笔记', g3.id, { estMin: 45, blockStart: '21:00' }));
    tasks.push(mkTask('回复邮件和消息', null, { estMin: 20, done: i % 2 === 0 }));
    if (i === 2) tasks.push(mkTask('处理线上告警', null, { urgent: true, estMin: 40 }));
    s.days[k] = {
      tasks, reflection: i === 1 ? '早晨的 90 分钟深度工作效率最高，明天继续保护这个时段。' : (i === 3 ? '下午被消息打断太多，试试关通知。' : ''),
      aiComment: '', plannedAt: Date.now() - i * 864e5, reviewedAt: Date.now() - i * 864e5,
    };
  }
  s.days[today] = {
    tasks: [
      { id: uid(), title: '深度工作：完成数据同步模块', goalId: g1.id, urgent: false, mit: true, done: false, estMin: 90, actMin: null, blockStart: '09:00', createdAt: Date.now() },
      { id: uid(), title: '慢跑 30 分钟', goalId: g2.id, urgent: false, mit: false, done: false, estMin: 30, actMin: null, blockStart: '18:30', createdAt: Date.now() },
      { id: uid(), title: '读 DDIA 第 3 章 20 页', goalId: g3.id, urgent: false, mit: true, done: false, estMin: 45, actMin: null, blockStart: '21:00', createdAt: Date.now() },
      { id: uid(), title: '回复合作邮件', goalId: null, urgent: true, mit: false, done: false, estMin: 20, actMin: null, blockStart: null, createdAt: Date.now() },
    ],
    reflection: '', aiComment: '', plannedAt: Date.now(), reviewedAt: null,
  };
  s.inbox = [
    { id: uid(), title: '研究一下竞品的定价页', createdAt: Date.now() },
    { id: uid(), title: '给项目写 README', createdAt: Date.now() },
  ];
  s.settings = { ...s.settings, ...state.settings }; // keep key/model/theme
  state = s;
  update();
}
