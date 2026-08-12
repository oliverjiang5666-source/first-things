// ============ OpenRouter API (direct from browser, key stays local) ============
// 零依赖静态站点：原生 fetch 直连 OpenRouter（OpenAI 兼容格式）。
// API key 只保存在本机 localStorage，只发往 openrouter.ai。

import { state, goalById } from './store.js';
import { buildContext } from './context.js';

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

const SYSTEM = `你是「要事」的时间管理教练。你的职责是帮用户把时间持续投向真正重要的事，最终完成他们的长期目标。

你遵循这些原则：
- 重要由用户的目标定义；紧急不等于重要。守护「重要不紧急」（第二象限）的时间。
- 睡眠和运动是所有目标的地基：先锁定睡眠边界、排入运动，再安排工作，不拿它们让路。
- 分解链：伟大目标 → 里程碑 → 本周要事 → 今日要事 → 具体时间块（30 分钟粒度）。
- 每天最多 3 件要事。「几点开始做什么」（实施意图）远比一张待办清单容易执行。
- 任务写成具体的下一步动作，一段 30–90 分钟。
- 诚实直接：发现问题就直说，比如某个目标连续两周零投入、要事总被紧急琐事挤掉、连续熬夜。
- 语气平和克制，简体中文，不堆砌鼓励话术，不用感叹号。`;

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

async function callAI({ system = SYSTEM, messages, maxTokens = 16000, schema = null, schemaName = 'result', stream = false, onDelta = null, signal = null }) {
  const model = (state.settings.model || 'openai/gpt-5.6-sol').trim();
  const effort = state.settings.effort || 'max';

  const makeBody = (m, eff, withSchema) => {
    const msgs = [{ role: 'system', content: system }, ...messages.map((x) => ({ ...x }))];
    const b = { model: m, messages: msgs, max_tokens: maxTokens };
    if (eff) b.reasoning = { effort: eff };
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
    return await rawCall(makeBody(model, effort, true), opts);
  } catch (e1) {
    if (isFatal(e1)) throw e1;
    // 同模型降级重试：最高档 effort 或结构化输出不被支持时
    try {
      if (isEffortErr(e1) && effort !== 'high') return await rawCall(makeBody(model, 'high', true), opts);
      if (isSchemaErr(e1)) return await rawCall(makeBody(model, effort, false), opts);
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

const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });

const TASK_ITEM = {
  type: 'object', additionalProperties: false,
  required: ['title', 'goalId', 'estMin', 'blockStart'],
  properties: {
    title: { type: 'string', description: '具体的下一步动作' },
    goalId: { ...nullable('string'), description: '关联目标的 id，无则 null' },
    estMin: { type: 'integer', description: '预计分钟数，30 分钟粒度' },
    blockStart: { ...nullable('string'), description: '建议开始时间 HH:MM，无则 null' },
  },
};

const PLAN_DAY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['mits', 'others', 'defer', 'rationale'],
  properties: {
    mits: { type: 'array', items: TASK_ITEM, description: '今日要事，最多 3 件' },
    others: { type: 'array', items: TASK_ITEM, description: '其他小事' },
    defer: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'reason'],
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
      },
      description: '建议推迟或放弃的事',
    },
    rationale: { type: 'string', description: '2-4 句安排理由' },
  },
};

const PLAN_WEEK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['priorities', 'rationale'],
  properties: {
    priorities: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'goalId', 'reason'],
        properties: {
          title: { type: 'string', description: '一句可检验的结果' },
          goalId: nullable('string'),
          reason: { type: 'string', description: '为什么是本周要事' },
        },
      },
    },
    rationale: { type: 'string' },
  },
};

const DECOMPOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['why', 'milestones', 'weeklyHours', 'firstActions'],
  properties: {
    why: { type: 'string', description: '一句话：为什么重要' },
    milestones: { type: 'array', items: { type: 'string' }, description: '3-6 个按时间排列的里程碑，各带时间点' },
    weeklyHours: { type: 'integer', description: '建议每周投入小时数' },
    firstActions: { type: 'array', items: { type: 'string' }, description: '本周就能开始的 2-3 个具体动作' },
  },
};

const INSIGHT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['oneLine', 'patterns', 'bottleneck', 'leverage', 'experiment'],
  properties: {
    oneLine: { type: 'string', description: '一句话总结本次洞察' },
    patterns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'evidence'],
        properties: {
          title: { type: 'string', description: '观察到的行为模式' },
          evidence: { type: 'string', description: '支持这个判断的具体数据证据' },
        },
      },
      description: '2-4 个行为模式',
    },
    bottleneck: {
      type: 'object', additionalProperties: false,
      required: ['title', 'analysis'],
      properties: {
        title: { type: 'string', description: '当前最大的瓶颈' },
        analysis: { type: 'string', description: '第一性原理分析：为什么它是根本瓶颈' },
      },
    },
    leverage: { type: 'array', items: { type: 'string' }, description: '1-3 个杠杆点：投入小、撬动大的改变' },
    experiment: {
      type: 'object', additionalProperties: false,
      required: ['title', 'how'],
      properties: {
        title: { type: 'string', description: '下周的一个小实验' },
        how: { type: 'string', description: '具体怎么做、怎么验证' },
      },
    },
  },
};

function validateGoalId(id) {
  return id && goalById(id) ? id : null;
}

// ---------- public API ----------

export function planDayPrompt(brainDump) {
  return `${buildContext('plan-day')}

【用户现在的输入】
${brainDump?.trim() || '（用户没有额外输入，请根据现有信息安排）'}

请基于以上全部信息安排今天：
1. 选出最多 3 件「今日要事」（mits），优先服务目标和本周要事，写成具体的下一步动作，并关联目标 id；
2. 其他值得做的小事放 others；
3. 明确建议推迟或放弃的事放 defer，并给出理由；
4. 尽量为每件事给出开始时间 blockStart（HH:MM，按 30 分钟对齐），避开用户提到的固定日程，保证睡眠边界；若用户有运动习惯且今天该运动，把运动排进 mits 或 others；
5. rationale 用 2-4 句话解释安排逻辑（联系目标与本周要事，如有取舍请说明）；
6. 今天任务列表里已有的条目不要原样重复输出；只输出新增的任务，或需要调整时间/内容的新版本（标题要和原任务不同，说明改了什么）。`;
}

export async function aiPlanDay(brainDump) {
  const text = await callAI({
    messages: [{ role: 'user', content: planDayPrompt(brainDump) }],
    schema: PLAN_DAY_SCHEMA, schemaName: 'day_plan',
  });
  const plan = parseStructured(text);
  plan.mits = (plan.mits || []).slice(0, 3).map((t) => ({ ...t, goalId: validateGoalId(t.goalId) }));
  plan.others = (plan.others || []).map((t) => ({ ...t, goalId: validateGoalId(t.goalId) }));
  plan.defer = plan.defer || [];
  return plan;
}

export function planWeekPrompt() {
  return `${buildContext('plan-week')}

请为用户建议「本周要事」：3-5 件，每件是一句本周结束时可检验的结果（不是模糊方向），关联目标 id，并说明理由。优先考虑：上周未完成但仍重要的事、连续多周投入不足的目标、当前里程碑的下一步。rationale 里如发现值得注意的模式（如某目标一直被忽略），请直说。`;
}

export async function aiPlanWeek() {
  const text = await callAI({
    messages: [{ role: 'user', content: planWeekPrompt() }],
    schema: PLAN_WEEK_SCHEMA, schemaName: 'week_plan',
  });
  const plan = parseStructured(text);
  plan.priorities = (plan.priorities || []).slice(0, 5).map((p) => ({ ...p, goalId: validateGoalId(p.goalId) }));
  return plan;
}

export function decomposePrompt(title, why) {
  return `用户想实现一个长期目标：「${title}」${why ? `\n用户写的理由：${why}` : ''}

${buildContext('chat')}

请用第一性原理帮用户把这个大目标分解到可执行：
1. why：一句话提炼它为什么重要（有用户理由则帮忙精炼）；
2. milestones：3-6 个里程碑，按时间顺序，每个是一句可检验的结果并带大致时间点（例：「10月底：完成初稿」）。第一个里程碑要在 2-4 周内可达成，给用户一个早期胜利；
3. weeklyHours：结合用户现有目标与作息，建议每周现实可投入的小时数；
4. firstActions：本周就能开始的 2-3 个具体动作，每个 30-90 分钟。`;
}

export async function aiDecomposeGoal(title, why) {
  const text = await callAI({
    messages: [{ role: 'user', content: decomposePrompt(title, why) }],
    schema: DECOMPOSE_SCHEMA, schemaName: 'goal_decomposition',
  });
  return parseStructured(text);
}

export function reviewDayPrompt(reflection) {
  return `${buildContext('review-day')}

【用户今晚的反思】${reflection?.trim() || '（未填写）'}

请用 2-3 句话点评今天：先指出一个真实的亮点（基于数据，不空洞表扬），如果有值得注意的模式就点出来，最后给一个明天可以直接执行的小建议。直接输出点评正文。`;
}

export async function aiReviewDay(reflection) {
  return callAI({
    messages: [{ role: 'user', content: reviewDayPrompt(reflection) }],
    maxTokens: 8000,
  });
}

export function weekSummaryPrompt(weekContext) {
  return `${weekContext}

请以用户的第一人称，为这一周写一段不超过 80 字的复盘摘要。它会作为长期记忆保存并在未来持续被引用，所以只保留最重要的信息：主要完成了什么、主要没完成什么及原因、下周最该注意的一点。直接输出摘要正文，不要任何前后缀。`;
}

export async function aiWeekSummary(weekContext) {
  return callAI({
    messages: [{ role: 'user', content: weekSummaryPrompt(weekContext) }],
    maxTokens: 8000,
  });
}

export async function aiMonthSummary(monthLabel, weeklySummaries) {
  const prompt = `以下是用户 ${monthLabel} 的每周复盘摘要：

${weeklySummaries}

请以用户的第一人称，把它们浓缩成一段不超过 100 字的月度摘要（长期记忆）：这个月最重要的进展、反复出现的问题、以及最值得延续的做法。直接输出正文。`;
  return callAI({ messages: [{ role: 'user', content: prompt }], maxTokens: 8000 });
}

export function insightPrompt() {
  return `${buildContext('insight')}

请基于以上全部数据，为用户做一次第一性原理的深度分析：
1. patterns：2-4 个从数据里观察到的行为模式（每个都要给出具体证据，如"周三、周四的完成率明显低于其他天"）；
2. bottleneck：当前阻碍用户达成目标的最大瓶颈是什么？用第一性原理拆解：它是精力问题、优先级问题、分解问题，还是环境问题？为什么其他问题都是它的衍生？
3. leverage：1-3 个杠杆点——投入最小、能撬动最大改变的调整；
4. experiment：下周做的一个小实验，具体、可验证；
5. oneLine：一句话总结。

要求：诚实，不奉承；每个结论都能指向具体数据；如果数据太少不足以支撑某个判断，直接说数据不足。`;
}

export async function aiInsight() {
  const text = await callAI({
    messages: [{ role: 'user', content: insightPrompt() }],
    schema: INSIGHT_SCHEMA, schemaName: 'weekly_insight',
    maxTokens: 20000,
  });
  return parseStructured(text);
}

export async function aiChat(chatMessages, onDelta, signal) {
  const system = `${SYSTEM}

以下是用户当前的完整现状（由应用自动整理）：

${buildContext('chat')}`;
  return callAI({ system, messages: chatMessages, stream: true, onDelta, maxTokens: 16000, signal });
}

export async function testConnection() {
  return callAI({
    system: '你是一个连接测试助手。',
    messages: [{ role: 'user', content: '请只回复四个字：连接成功' }],
    maxTokens: 2000,
  });
}
