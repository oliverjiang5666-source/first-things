// ============ OpenRouter API (direct from browser, key stays local) ============
// 零依赖静态站点：原生 fetch 直连 OpenRouter（OpenAI 兼容格式）。
// API key 只保存在本机 localStorage，只发往 openrouter.ai。
// 「说什么」（system 拼接、user prompt、schema）都在 prompts.js；这里只管「怎么发」：
// 传输、strict json_schema、以及 出错时的降级链（同模型降 effort → 去 schema → 换回退模型）。

import { state, goalById } from './store.js';
import {
  composeSystem, coachContext,
  planDayPrompt, planWeekPrompt, decomposePrompt, reviewDayPrompt,
  weekSummaryPrompt, monthSummaryPrompt, insightPrompt, briefPrompt,
  PLAN_DAY_SCHEMA, PLAN_WEEK_SCHEMA, DECOMPOSE_SCHEMA, INSIGHT_SCHEMA, COACH_SCHEMA, BRIEF_SCHEMA,
} from './prompts.js';

// ui.js 的「查看上下文 / 复制给任意 AI」直接用这些构造器
export { planDayPrompt, planWeekPrompt, decomposePrompt, reviewDayPrompt, weekSummaryPrompt, insightPrompt, composeSystem };

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const MODELS = [
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol · 默认' },
  { id: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro · 更强更贵' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5 · 备选' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini · 快而省' },
];

// 主模型出错时自动回退
export const FALLBACK_MODEL = 'anthropic/claude-opus-5';

export const EFFORTS = [
  { id: 'max', label: '最深思考（默认）' },
  { id: 'xhigh', label: '极深' },
  { id: 'high', label: '深' },
  { id: 'medium', label: '标准' },
  { id: 'low', label: '快' },
];

export function hasKey() { return !!state.settings.apiKey?.trim(); }

function friendlyError(status, data) {
  const msg = data?.error?.message || '';
  if (status === 401) return 'API Key 无效，请在设置里检查（OpenRouter 的 key 以 sk-or- 开头）。';
  if (status === 402) return 'OpenRouter 余额不足，请到 openrouter.ai 充值。';
  if (status === 403) return '该 Key 无权使用这个模型（可能被 Key 的模型白名单限制）。';
  if (status === 404) return `模型不存在：请检查设置里的模型 ID。${msg}`;
  if (status === 429) return '请求太频繁，稍等几十秒再试。';
  if (status >= 500) return 'OpenRouter 或上游服务暂时不可用，稍后再试。';
  if (status === 400) return `请求有误：${msg}`;
  return msg || `请求失败（${status}）`;
}

async function rawCall(body, { stream = false, onDelta = null, signal = null } = {}) {
  const key = state.settings.apiKey?.trim();
  if (!key) { const e = new Error('还没有设置 API Key'); e.noKey = true; throw e; }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://github.com/oliverjiang5666-source/first-things',
        'X-Title': 'First Things',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('网络请求失败，请检查网络连接。');
  }

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    const e = new Error(friendlyError(res.status, data));
    e.status = res.status;
    e.rawMessage = data?.error?.message || '';
    throw e;
  }

  if (!stream) {
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || '请求出错');
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    if (choice?.finish_reason === 'length') console.warn('response truncated at max_tokens');
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.error) throw new Error(ev.error.message || '流式响应出错');
      const delta = ev.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        if (onDelta) onDelta(delta, full);
      }
    }
  }
  return full;
}

// effort 可按调用覆盖：交互式重活（计划/洞察）用设置里的档位（默认 max），
// 「一句话」解析用 high（秒级返回、精度足够），后台观察用 medium（高频、廉价）。
async function callAI({ system, messages, maxTokens = 16000, schema = null, schemaName = 'result', stream = false, onDelta = null, signal = null, effort = null }) {
  const model = (state.settings.model || 'openai/gpt-5.6-sol').trim();
  const eff = effort || state.settings.effort || 'max';

  const makeBody = (m, e, withSchema) => {
    const msgs = [{ role: 'system', content: system }, ...messages.map((x) => ({ ...x }))];
    const b = { model: m, messages: msgs, max_tokens: maxTokens };
    if (e) b.reasoning = { effort: e };
    if (schema && withSchema) {
      b.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    } else if (schema && !withSchema) {
      msgs[msgs.length - 1].content += '\n\n请只输出一个符合上述要求的 JSON 对象，不要输出任何其他文字或代码块标记。';
    }
    if (stream) b.stream = true;
    return b;
  };

  const opts = { stream, onDelta, signal };
  const rawOf = (e) => (e.rawMessage || e.message || '').toLowerCase();
  const isSchemaErr = (e) => e.status === 400 && schema && /response_format|json_schema|structured|schema/.test(rawOf(e));
  const isEffortErr = (e) => e.status === 400 && /reasoning|effort/.test(rawOf(e));
  const isFatal = (e) => e.name === 'AbortError' || e.noKey || [401, 402, 403].includes(e.status);

  try {
    return await rawCall(makeBody(model, eff, true), opts);
  } catch (e1) {
    if (isFatal(e1)) throw e1;
    // 同模型降级重试：最高档 effort 或结构化输出不被支持时
    try {
      if (isEffortErr(e1) && eff !== 'high') return await rawCall(makeBody(model, 'high', true), opts);
      if (isSchemaErr(e1)) return await rawCall(makeBody(model, eff, false), opts);
    } catch (e2) {
      if (isFatal(e2)) throw e2;
    }
    if (model === FALLBACK_MODEL) throw e1;
    // 回退模型：Claude Opus 5
    console.info(`primary model failed (${e1.message}), falling back to ${FALLBACK_MODEL}`);
    try {
      return await rawCall(makeBody(FALLBACK_MODEL, 'high', true), opts);
    } catch (e3) {
      if (isFatal(e3)) throw e3;
      if (isSchemaErr(e3)) return rawCall(makeBody(FALLBACK_MODEL, 'high', false), opts);
      if (isEffortErr(e3)) return rawCall(makeBody(FALLBACK_MODEL, null, true), opts);
      throw e3;
    }
  }
}

function parseStructured(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); }
  catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    throw new Error('AI 返回的内容无法解析，请重试。');
  }
}

function validateGoalId(id) {
  return id && goalById(id) ? id : null;
}

// ---------- public API ----------

// prior：上一轮草案文字版；带上即为「迭代调整」（AI 先分解 → 用户一段话 → 最小修改）
export async function aiPlanDay(brainDump, prior = null) {
  const text = await callAI({
    system: composeSystem('plan-day'),
    messages: [{ role: 'user', content: planDayPrompt(brainDump, prior) }],
    schema: PLAN_DAY_SCHEMA, schemaName: 'day_plan',
  });
  const plan = parseStructured(text);
  plan.mits = (plan.mits || []).slice(0, 3).map((t) => ({ ...t, goalId: validateGoalId(t.goalId) }));
  plan.others = (plan.others || []).map((t) => ({ ...t, goalId: validateGoalId(t.goalId) }));
  plan.defer = plan.defer || [];
  return plan;
}

export async function aiPlanWeek(input = '', prior = null) {
  const text = await callAI({
    system: composeSystem('plan-week'),
    messages: [{ role: 'user', content: planWeekPrompt(input, prior) }],
    schema: PLAN_WEEK_SCHEMA, schemaName: 'week_plan',
  });
  const plan = parseStructured(text);
  plan.priorities = (plan.priorities || []).slice(0, 5).map((p) => ({ ...p, goalId: validateGoalId(p.goalId) }));
  return plan;
}

export async function aiDecomposeGoal(title, why) {
  const text = await callAI({
    system: composeSystem('decompose'),
    messages: [{ role: 'user', content: decomposePrompt(title, why) }],
    schema: DECOMPOSE_SCHEMA, schemaName: 'goal_decomposition',
  });
  return parseStructured(text);
}

export async function aiReviewDay(reflection) {
  return callAI({
    system: composeSystem('review-day'),
    messages: [{ role: 'user', content: reviewDayPrompt(reflection) }],
    maxTokens: 8000,
  });
}

export async function aiWeekSummary(weekContext) {
  return callAI({
    system: composeSystem('week-summary'),
    messages: [{ role: 'user', content: weekSummaryPrompt(weekContext) }],
    maxTokens: 8000,
  });
}

export async function aiMonthSummary(monthLabel, weeklySummaries) {
  return callAI({
    system: composeSystem('month-summary'),
    messages: [{ role: 'user', content: monthSummaryPrompt(monthLabel, weeklySummaries) }],
    maxTokens: 8000,
  });
}

export async function aiInsight() {
  const text = await callAI({
    system: composeSystem('insight'),
    messages: [{ role: 'user', content: insightPrompt() }],
    schema: INSIGHT_SCHEMA, schemaName: 'weekly_insight',
    maxTokens: 20000,
  });
  return parseStructured(text);
}

// 教练对话框：用户说什么都行（安排/调整/记录/复盘/提问），模型自己理解、
// 需要时输出 ops 由应用执行。上下文放 system 且每轮重建——上一轮的修改立即可见。
// effort 固定 high：对话要秒级返回，解析与安排精度足够。
export async function aiCoach(messages, signal = null) {
  const system = `${composeSystem('coach')}

以下是用户当前的现状与历史（应用自动整理，每轮对话都会刷新；短 id 用于 ops 引用）：

${coachContext()}`;
  const text = await callAI({
    system, messages,
    schema: COACH_SCHEMA, schemaName: 'coach_turn',
    maxTokens: 16000, effort: 'high', signal,
  });
  const r = parseStructured(text);
  r.ops = Array.isArray(r.ops) ? r.ops : [];
  r.reply = r.reply || '';
  return r;
}

// 后台观察：高频、轻量，effort medium。
export async function aiBrief() {
  const text = await callAI({
    system: composeSystem('brief'),
    messages: [{ role: 'user', content: briefPrompt() }],
    schema: BRIEF_SCHEMA, schemaName: 'coach_brief',
    maxTokens: 8000, effort: 'medium',
  });
  const r = parseStructured(text);
  if (!r.headline) throw new Error('empty brief');
  return r;
}

export async function testConnection() {
  return callAI({
    system: '你是一个连接测试助手。',
    messages: [{ role: 'user', content: '请只回复四个字：连接成功' }],
    maxTokens: 2000, effort: 'low',
  });
}
