// ============ 后台智能调度器 ============
// 不需要用户点按钮的那部分 AI：
// · 观察卡（brief）：数据变了 + 距上次 ≥15 分钟 → 后台刷新一句观察（每天 ≤10 次）
// · 自动洞察：出现「该做深度洞察」信号且本周还没有 → 后台生成（每 20 小时最多试一次）
// · 复盘点评：完成晚间复盘后自动请 AI 点评当天（原来要手动点）
// 只依赖 store + ai，不 import ui —— 需要提示用户时发 CustomEvent('yaoshi-toast')，
// main.js 里统一转成 toast。所有失败都静默（后台任务不打扰人）。

import {
  state, update, subscribe, todayKey, thisWeekKey, computeSignals,
} from './store.js';
import { hasKey, aiBrief, aiInsight, aiReviewDay } from './ai.js';

const BRIEF_MIN_GAP = 15 * 60 * 1000;   // 两次观察至少隔 15 分钟
const BRIEF_DAILY_MAX = 10;             // 每天最多 10 次（约束成本）
const INSIGHT_RETRY_GAP = 20 * 60 * 60 * 1000; // 自动洞察每 20 小时最多尝试一次

let briefBusy = false;
let insightBusy = false;
let debounceTimer = null;

const enabled = () => hasKey() && state.settings.autoAI !== false;

function toast(msg) {
  document.dispatchEvent(new CustomEvent('yaoshi-toast', { detail: msg }));
}

// 观察卡的「数据指纹」：这些东西变了才值得重新看一眼。
// 刻意不含 assistant 自身与计时器秒数，避免自我触发的循环。
function briefHash() {
  const tk = todayKey();
  const day = state.days[tk];
  const wk = state.weeks[thisWeekKey()];
  return JSON.stringify({
    tasks: (day?.tasks || []).map((t) => [t.id.slice(-6), t.done, !!t.dropped, t.mit, t.blockStart, t.actMin]),
    refl: day?.reflection || '',
    prios: (wk?.priorities || []).map((p) => [p.id.slice(-6), p.done]),
    timerTask: state.timer?.taskId?.slice(-6) || null,
  });
}

async function maybeBrief(force = false) {
  if (!enabled() || briefBusy) return;
  const a = state.assistant;
  const tk = todayKey();
  const count = a.briefDate === tk ? a.briefCount : 0;
  const hash = briefHash();
  if (!force) {
    if (hash === a.briefHash) return;
    if (a.brief && tk === a.briefDate && Date.now() - (a.brief.at || 0) < BRIEF_MIN_GAP) return;
    if (count >= BRIEF_DAILY_MAX) return;
  }
  briefBusy = true;
  try {
    const r = await aiBrief();
    update((s) => {
      s.assistant.brief = { headline: r.headline, suggestion: r.suggestion || null, at: Date.now() };
      s.assistant.briefHash = hash;
      s.assistant.briefDate = tk;
      s.assistant.briefCount = (s.assistant.briefDate === tk ? count : 0) + 1;
    });
  } catch (e) {
    console.info('brief skipped:', e.message);
  } finally {
    briefBusy = false;
  }
}

// 手动刷新（观察卡上的 ↻）：绕过节流，但仍然记录指纹与次数
export function refreshBrief() { return maybeBrief(true); }

async function maybeAutoInsight() {
  if (!enabled() || insightBusy) return;
  const twk = thisWeekKey();
  if (state.weeks[twk]?.insight) return;
  if (!computeSignals().some((s) => s.key === 'insight-due')) return;
  if (Date.now() - (state.assistant.insightAutoAt || 0) < INSIGHT_RETRY_GAP) return;
  insightBusy = true;
  // 先记尝试时间再调用：失败也占用本轮窗口，避免反复烧钱
  update((s) => { s.assistant.insightAutoAt = Date.now(); });
  try {
    const ins = await aiInsight();
    update((s) => {
      if (!s.weeks[twk]) s.weeks[twk] = { priorities: [], budgets: {}, plannedAt: null, review: null };
      s.weeks[twk].insight = { ...ins, createdAt: Date.now(), auto: true };
    });
    toast('✦ 教练完成了一次深度洞察，去「回顾」看看');
  } catch (e) {
    console.info('auto insight skipped:', e.message);
  } finally {
    insightBusy = false;
  }
}

// 完成晚间复盘后自动点评（ui 的 review-day-done 直接调用）
export async function autoComment() {
  if (!hasKey()) return;
  const tk = todayKey();
  const day = state.days[tk];
  if (!day || day.aiComment) return;
  try {
    const text = await aiReviewDay(day.reflection);
    update((s) => { if (s.days[tk]) s.days[tk].aiComment = text.trim(); });
  } catch (e) {
    console.info('auto comment skipped:', e.message);
  }
}

function tick() {
  if (document.visibilityState !== 'visible') return;
  maybeBrief();
  maybeAutoInsight();
}

export function init() {
  // 数据一变，90 秒后看一眼（一连串编辑只触发一次）
  subscribe(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tick, 90 * 1000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(tick, 3000);
  });
  setInterval(tick, 5 * 60 * 1000);
  // 启动后稍等再看：等 config.local 注入 key、首屏渲染完
  setTimeout(tick, 8000);
}
