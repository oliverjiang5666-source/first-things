// ============ ops engine：AI 指令 → 数据修改 ============
// aiApply 返回的 ops（见 prompts.js 的 APPLY_SCHEMA）在这里落地：
// planOps 先把每个 op 解析成「人话描述 + 执行闭包」，UI 预览确认后 applyOps 在
// 一次 update() 里全部执行。找不到引用对象的 op 直接跳过并说明，绝不猜。
// 撤销：UI 在 applyOps 前拍 snapshot()，toast 上的「撤销」用 restoreSnapshot 还原。

import {
  state, update, ensureDay, ensureWeek, newTask, uid, goalById,
  todayKey, thisWeekKey, fmtDay, settleTimer,
} from './store.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 短 id 归一化：容忍 AI 把 "[t:xxxx]" 或 "t:xxxx" 原样塞进来
const norm = (v) => String(v || '').trim().replace(/^\[|\]$/g, '').replace(/^(t|i|p|m|id):/, '');

function findTask(ref) {
  const v = norm(ref);
  if (!v) return null;
  for (const day of Object.keys(state.days).sort().reverse()) {
    const task = state.days[day].tasks.find((t) => t.id.endsWith(v));
    if (task) return { day, task };
  }
  return null;
}
function findInbox(ref) {
  const v = norm(ref);
  return (v && state.inbox.find((it) => it.id.endsWith(v))) || null;
}
function findPriority(ref) {
  const v = norm(ref);
  if (!v) return null;
  for (const wk of Object.keys(state.weeks).sort().reverse()) {
    const p = state.weeks[wk].priorities.find((x) => x.id.endsWith(v));
    if (p) return p;
  }
  return null;
}
function findMilestone(ref) {
  const v = norm(ref);
  if (!v) return null;
  for (const g of state.goals) {
    const ms = (g.milestones || []).find((m) => m.id.endsWith(v));
    if (ms) return { goal: g, ms };
  }
  return null;
}
function findGoal(ref) {
  const v = norm(ref);
  return (v && state.goals.find((g) => g.id === v || g.id.endsWith(v))) || null;
}

function opDate(op) {
  if (op.date && DATE.test(op.date)) return op.date;
  return todayKey();
}
const dayLabel = (k) => (k === todayKey() ? '今天' : fmtDay(k));

const ok = (text, exec) => ({ ok: true, text, exec });
const skip = (text) => ({ ok: false, text, exec: null });

function mitCapText(day) {
  const mits = (state.days[day]?.tasks || []).filter((t) => t.mit && !t.dropped).length;
  return mits >= 3 ? '（今日要事已满 3 件，先作为普通任务加入）' : '';
}
// 执行时再查一次上限：同批可能已经加过要事
function applyMitCap(s, day, task) {
  if (!task.mit) return;
  const others = s.days[day].tasks.filter((t) => t !== task && t.mit && !t.dropped).length;
  if (others >= 3) task.mit = false;
}

function taskFromOp(op, { done = false } = {}) {
  const goal = op.goalId ? findGoal(op.goalId) : null;
  return newTask(op.title || '（未命名）', {
    goalId: goal ? goal.id : null,
    mit: !!op.mit, urgent: !!op.urgent, done,
    estMin: op.estMin ?? 30,
    actMin: op.actMin ?? null,
    blockStart: op.blockStart && HHMM.test(op.blockStart) ? op.blockStart : null,
  });
}

function describeNewTask(op, day) {
  const goal = op.goalId ? findGoal(op.goalId) : null;
  const bits = [`${dayLabel(day)}`];
  if (op.blockStart && HHMM.test(op.blockStart)) bits.push(op.blockStart);
  bits.push(`预计 ${op.estMin ?? 30} 分`);
  if (goal) bits.push(`关联「${goal.title}」`);
  return bits.join('，');
}

function planOp(op) {
  const t = op.type;

  if (t === 'add_task') {
    if (!op.title?.trim()) return skip('新任务缺少标题，已跳过');
    const day = opDate(op);
    const cap = op.mit ? mitCapText(day) : '';
    return ok(`新任务「${op.title}」→ ${describeNewTask(op, day)}${op.mit ? `，设为要事${cap}` : ''}`,
      (s) => {
        const task = taskFromOp(op);
        ensureDay(day).tasks.push(task);
        applyMitCap(s, day, task);
      });
  }

  if (t === 'complete_task') {
    const hit = op.taskId ? findTask(op.taskId) : null;
    if (hit) {
      const { day, task } = hit;
      return ok(`完成「${task.title}」${op.actMin != null ? `（实际 ${op.actMin} 分）` : ''}`,
        (s) => {
          if (s.timer?.taskId === task.id) settleTimer(s);
          task.done = true;
          if (op.actMin != null) task.actMin = op.actMin;
          void day;
        });
    }
    if (op.taskId) return skip(`找不到要完成的任务（${op.taskId}）`);
    if (!op.title?.trim()) return skip('完成操作缺少任务信息，已跳过');
    const day = opDate(op);
    return ok(`补记完成「${op.title}」→ ${dayLabel(day)}${op.actMin != null ? `，实际 ${op.actMin} 分` : ''}`,
      () => { ensureDay(day).tasks.push(taskFromOp(op, { done: true })); });
  }

  if (t === 'update_task') {
    const hit = findTask(op.taskId);
    if (!hit) return skip(`找不到要修改的任务（${op.taskId || '无 id'}）`);
    const { task } = hit;
    const changes = [];
    if (op.title?.trim() && op.title.trim() !== task.title) changes.push(`标题 →「${op.title.trim()}」`);
    if (op.estMin != null) changes.push(`预计 ${op.estMin} 分`);
    if (op.actMin != null) changes.push(`实际 ${op.actMin} 分`);
    if (op.blockStart && HHMM.test(op.blockStart)) changes.push(`时间块 ${op.blockStart}`);
    if (op.mit != null) changes.push(op.mit ? '设为要事' : '取消要事');
    if (op.urgent != null) changes.push(op.urgent ? '标记紧急' : '取消紧急');
    const goal = op.goalId ? findGoal(op.goalId) : null;
    if (goal) changes.push(`关联「${goal.title}」`);
    if (!changes.length) return skip(`「${task.title}」没有可修改的内容，已跳过`);
    return ok(`修改「${task.title}」：${changes.join('；')}`,
      (s) => {
        if (op.title?.trim()) task.title = op.title.trim();
        if (op.estMin != null) task.estMin = op.estMin;
        if (op.actMin != null) task.actMin = op.actMin;
        if (op.blockStart && HHMM.test(op.blockStart)) task.blockStart = op.blockStart;
        if (op.mit != null) { task.mit = op.mit; applyMitCap(s, hit.day, task); }
        if (op.urgent != null) task.urgent = op.urgent;
        if (goal) task.goalId = goal.id;
      });
  }

  if (t === 'reopen_task' || t === 'drop_task') {
    const hit = findTask(op.taskId);
    if (!hit) return skip(`找不到任务（${op.taskId || '无 id'}）`);
    const { task } = hit;
    if (t === 'reopen_task') return ok(`重新打开「${task.title}」`, () => { task.done = false; });
    return ok(`放弃「${task.title}」`, (s) => {
      if (s.timer?.taskId === task.id) settleTimer(s);
      task.dropped = true;
    });
  }

  if (t === 'move_task') {
    const hit = findTask(op.taskId);
    if (!hit) return skip(`找不到要移动的任务（${op.taskId || '无 id'}）`);
    if (!op.date || !DATE.test(op.date)) return skip(`移动「${hit.task.title}」缺少目标日期，已跳过`);
    const { day, task } = hit;
    if (day === op.date) return skip(`「${task.title}」已在${dayLabel(op.date)}，无需移动`);
    return ok(`把「${task.title}」挪到 ${dayLabel(op.date)}`,
      (s) => {
        if (s.timer?.taskId === task.id) settleTimer(s);
        const from = s.days[day];
        from.tasks = from.tasks.filter((x) => x.id !== task.id);
        ensureDay(op.date).tasks.push({ ...task, blockStart: HHMM.test(op.blockStart || '') ? op.blockStart : null });
      });
  }

  if (t === 'add_inbox') {
    if (!op.title?.trim()) return skip('收集箱条目缺少内容，已跳过');
    return ok(`记入收集箱：「${op.title}」`,
      (s) => { s.inbox.unshift({ id: uid(), title: op.title.trim(), createdAt: Date.now() }); });
  }

  if (t === 'remove_inbox') {
    const item = findInbox(op.inboxId);
    if (!item) return skip(`找不到收集箱条目（${op.inboxId || '无 id'}）`);
    return ok(`删除收集箱条目「${item.title}」`,
      (s) => { s.inbox = s.inbox.filter((x) => x.id !== item.id); });
  }

  if (t === 'inbox_to_day') {
    const item = findInbox(op.inboxId);
    if (!item) return skip(`找不到收集箱条目（${op.inboxId || '无 id'}）`);
    const day = opDate(op);
    return ok(`把收集箱「${item.title}」安排到 ${dayLabel(day)}${op.blockStart && HHMM.test(op.blockStart) ? ` ${op.blockStart}` : ''}`,
      (s) => {
        const task = taskFromOp({ ...op, title: op.title?.trim() || item.title });
        ensureDay(day).tasks.push(task);
        applyMitCap(s, day, task);
        s.inbox = s.inbox.filter((x) => x.id !== item.id);
      });
  }

  if (t === 'set_reflection') {
    if (!op.text?.trim()) return skip('反思内容为空，已跳过');
    const day = opDate(op);
    const brief = op.text.trim().slice(0, 24);
    return ok(`写${dayLabel(day)}的反思：「${brief}${op.text.trim().length > 24 ? '…' : ''}」`,
      () => { ensureDay(day).reflection = op.text.trim(); });
  }

  if (t === 'add_priority') {
    if (!op.title?.trim()) return skip('本周要事缺少标题，已跳过');
    const goal = op.goalId ? findGoal(op.goalId) : null;
    return ok(`新增本周要事：「${op.title}」${goal ? `（关联「${goal.title}」）` : ''}`,
      () => {
        ensureWeek(thisWeekKey()).priorities.push({ id: uid(), title: op.title.trim(), goalId: goal ? goal.id : null, done: false });
      });
  }

  if (t === 'toggle_priority') {
    const p = findPriority(op.priorityId);
    if (!p) return skip(`找不到本周要事（${op.priorityId || '无 id'}）`);
    return ok(p.done ? `取消勾选本周要事「${p.title}」` : `完成本周要事「${p.title}」`,
      () => { p.done = !p.done; });
  }

  if (t === 'complete_milestone') {
    const hit = findMilestone(op.milestoneId);
    if (!hit) return skip(`找不到里程碑（${op.milestoneId || '无 id'}）`);
    if (hit.ms.done) return skip(`里程碑「${hit.ms.title}」已经完成`);
    return ok(`完成里程碑「${hit.ms.title}」（${hit.goal.title}）`, () => { hit.ms.done = true; });
  }

  if (t === 'set_wake' || t === 'set_sleep') {
    if (!op.text || !HHMM.test(op.text.trim())) return skip(`作息时间格式不对（${op.text || '空'}），需要 HH:MM`);
    const v = op.text.trim();
    if (t === 'set_wake') return ok(`起床时间 → ${v}`, (s) => { s.profile.wake = v; });
    return ok(`就寝时间 → ${v}`, (s) => { s.profile.sleep = v; });
  }

  if (t === 'set_exercise') {
    return ok(`运动习惯 → ${op.text?.trim() || '（清空）'}`, (s) => { s.profile.exercise = op.text?.trim() || ''; });
  }

  if (t === 'note') {
    return ok(`说明：${op.text || op.title || ''}`, () => { /* 只展示，不改数据 */ });
  }

  return skip(`不认识的操作类型「${t}」，已跳过`);
}

// 预览：每个 op 一行人话 + 是否可执行
export function planOps(ops) {
  return (ops || []).map((op) => {
    try { return { ...planOp(op), op }; }
    catch (e) { console.error('planOp failed', op, e); return { ok: false, text: '这条操作无法解析，已跳过', op, exec: null }; }
  });
}

// 执行选中的 op（一次 update，保证只触发一轮保存与重绘）
export function applyOps(ops) {
  const plans = planOps(ops);
  const applied = [], skipped = [];
  update((s) => {
    for (const p of plans) {
      if (!p.ok || !p.exec) { skipped.push(p.text); continue; }
      try { p.exec(s); applied.push(p.text); }
      catch (e) { console.error('op exec failed', p.op, e); skipped.push(`${p.text}（执行失败）`); }
    }
  });
  return { applied, skipped };
}
