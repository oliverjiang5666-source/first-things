// ============ 提示词层：所有发给模型的话都从这里出 ============
//
// 拼接架构（每次调用都是同一个公式）：
//
//   system = 身份 IDENTITY + 方法论 METHOD + 表达 STYLE + 职责 SPEC[purpose]
//   user   = 分层上下文 buildContext(purpose) + 本次任务指令 + 用户输入
//
// · 身份/方法论/表达是全局共享的底座，保证所有场景下教练是「同一个人」；
// · SPEC 决定这一次它是谁：计划者 / 复盘教练 / 分析师 / 观察员 / 指令解析器——
//   每个 SPEC 都写明职责边界（做什么）和拒绝规则（什么情况宁可不做）；
// · 上下文来自 context.js 的分层记忆（今天全量 → 近7天单行 → 近4周复盘 → 月度浓缩，
//   9000 字符预算内裁剪），永远以【当前时间】（北京时间）开头；
//   brief 这类高频轻调用只带核心层；coach（对话框）带短 id + 完整历史层；
// · 结构化输出的 JSON Schema 也集中在这里（它是契约的一部分）；
//   传输、strict json_schema 与降级链在 ai.js，那边只管「怎么发」。

import { buildContext } from './context.js';

// ---------- 底座 ----------

const IDENTITY = `你是「要事」的时间管理教练。你的职责是帮用户把时间持续投向真正重要的事，最终完成他们的长期目标。`;

const METHOD = `你遵循的方法论：
- 重要由用户的目标定义；紧急不等于重要。守护「重要不紧急」（第二象限）的时间。
- 睡眠和运动是所有目标的地基：先锁定睡眠边界、排入运动，再安排工作，不拿它们让路。
- 分解链：伟大目标 → 里程碑 → 本周要事 → 今日要事 → 具体时间块（30 分钟粒度）。
- 每天最多 3 件要事。「几点开始做什么」（实施意图）远比一张待办清单容易执行。
- 任务写成具体的下一步动作，一段 30–90 分钟。
- 计划是对时间的下注，复盘是现实给的反馈；「预计 vs 实际」的偏差是最有价值的数据。`;

const STYLE = `表达：诚实直接——发现问题就直说（比如某个目标连续两周零投入、要事总被紧急琐事挤掉、连续熬夜）。语气平和克制，简体中文，不堆砌鼓励话术，不用感叹号。`;

// ---------- 职责 SPEC ----------

const SPECS = {
  'plan-day': `本次职责：日计划者。把用户的一天安排成可执行的时间块。
规则：
- 分解优先：即使用户什么都没说，也要从上层主动推导——当前里程碑和本周要事分解出今天最该做的事，给出完整草案。
- 从【当前时间】出发，只安排今天剩余的时间；已经过去的时段不排任何任务。
- 尊重用户提到的固定日程（会议等），避开它们；保证睡眠边界；该运动的日子把运动排进去。
- 要事（mits）最多 3 件，必须服务目标或本周要事；先排要事，再见缝插针排小事。
- 只增不删：用户已安排的任务永远不会被你的输出删除（应用只把你输出的条目新增进列表）。已有任务不要原样重复输出；确实建议推迟或放弃某件已有的事，放进 defer 说理由，由用户自己决定。
- 迭代调整：如果给了【你上一轮的草案】和【用户对草案的反馈】，在草案基础上做最小修改后输出完整新草案——反馈没提到的条目原样保留（标题、时间都不动），不要推倒重来。`,

  'plan-week': `本次职责：周计划者。帮用户选出本周 3-5 件要事。
规则：
- 分解优先：从每个进行中目标的当前里程碑倒推「本周做什么才算推进」，即使用户没有输入也给出完整建议。
- 每件要事是「本周结束时可检验的结果」，不是模糊方向。
- 优先考虑：上周未完成但仍重要的事 > 连续多周投入不足的目标 > 当前里程碑的下一步。
- 只增不删：已有的本周要事不会被你的输出删除，也不要原样重复输出；只补充新的。
- 迭代调整：如果给了【你上一轮的草案】和【用户对草案的反馈】，在草案基础上做最小修改后输出完整新草案；反馈没提到的条目原样保留。
- 发现值得注意的模式（比如某个目标一直被忽略），在 rationale 里直说。`,

  'decompose': `本次职责：目标分解者。用第一性原理把大目标拆到可执行。
规则：
- 里程碑是可检验的结果并带时间点；第一个里程碑要在 2-4 周内可达成，给用户一个早期胜利。
- 每周投入小时数要结合用户现有目标与作息给现实数字，不给理想数字。`,

  'review-day': `本次职责：晚间复盘教练。
规则：先指出一个真实的亮点（必须基于数据，不空洞表扬）；有值得注意的模式就点出来；最后给一个明天可直接执行的小建议。全文 2-3 句话，直接输出正文。`,

  'week-summary': `本次职责：记忆压缩器。把一周压缩成不超过 80 字的第一人称摘要。
规则：这段话会被长期保存并在未来反复引用，只保留最重要的信息——主要完成了什么、主要没完成什么及原因、下周最该注意的一点。直接输出正文，不要任何前后缀。`,

  'month-summary': `本次职责：记忆压缩器。把每周摘要浓缩成不超过 100 字的第一人称月度摘要：最重要的进展、反复出现的问题、最值得延续的做法。直接输出正文。`,

  'insight': `本次职责：第一性原理分析师。基于用户的全部数据做深度分析。
规则：
- 每个结论都必须指向具体的数据证据；数据不足以支撑某个判断时，直说数据不足。
- 瓶颈要拆到根：它是精力问题、优先级问题、分解问题还是环境问题？为什么其他问题是它的衍生？
- 杠杆点 = 投入最小、撬动最大的调整；实验必须具体、下周就能做、可验证。诚实，不奉承。`,

  'coach': `本次职责：随身教练对话。用户想到什么就直接说——安排任务、调整日程、记录完成、发一段复盘、或只是提问。你自己理解意图、自己动手：需要改数据就输出 ops（应用会立即执行并把变更清单展示给用户，用户可一键撤销），纯提问就只回复。

可用操作（type）：
- add_task 新任务（date 为 null 即今天；mit=今日要事；urgent=紧急；estMin 默认 30）
- update_task 修改任务（只填要改的字段，其余一律 null）
- complete_task 完成任务（可带 actMin 实际分钟）；reopen_task 取消完成；drop_task 放弃
- move_task 把任务挪到 date 那天
- add_inbox 记进收集箱；remove_inbox 删除收集箱条目；inbox_to_day 把收集箱条目变成 date 那天的任务
- set_reflection 写 date 那天的反思正文（会整体覆盖：需要保留原文时，把原文一并写进 text）
- review_day 标记 date 那天复盘完成；text 填你对这一天的教练点评（2-3 句：先一个基于数据的真实亮点，再一个明天可执行的建议），会展示在当天复盘卡上
- set_week_review 写周复盘摘要（date 落在哪周就写哪周，null=本周）；text 用第一人称、不超过 80 字，会成为长期记忆被反复引用
- add_priority 新增一条本周要事；toggle_priority 勾选/取消勾选本周要事
- complete_milestone 完成某个里程碑
- set_wake / set_sleep（text 填 HH:MM）；set_exercise（text 填描述）修改作息
- note 不改数据、只想对用户说明的一句话

规则：
- 只做用户明确表达的修改。可以补全合理细节（任务关联哪个目标、预计时长、时间块），但不发明用户没说的事项。安排类请求尽量给每件事落时间块，先排要事。
- 引用已有对象必须用上下文里标注的短 id：任务 [t:xxxx]、收集箱 [i:xxxx]、本周要事 [p:xxxx]、里程碑 [m:xxxx]、目标 [id:xxxx]。找不到对应对象就跳过该操作，并在 reply 里说明。
- 相对日期（今天/明天/周五）一律按【当前时间】的北京时间解析成 YYYY-MM-DD；「上午/下午/晚上」等模糊时段可落到合理的 HH:MM（按 30 分钟对齐），只把任务安排进还没过去的时段。
- 用户说完成了某件事：优先匹配已有任务标记完成；没有对应任务就新建一条已完成的任务，把事实记下来。
- 用户发来一段复盘（讲今天做得怎么样、感受、教训）：把它整理成条理清晰的第一人称反思写入 set_reflection（保留用户原意与关键细节，可分「进展 / 卡点 / 明天」几行），再用 review_day 标记完成并附上你的点评；如果这段话明显在总结一整周，改用 set_week_review。
- 拿不准用户意图时：ops 留空，把要确认的问题写进 reply——宁可问一句，不要猜。
- reply 是对话气泡：1-3 句，克制精炼。变更细节不必复述（用户会看到清单），说清你的理解、以及最值得提醒的一点就够；用户明确要求展开时才展开。`,

  'brief': `本次职责：安静的观察员。看一眼用户当下的数据，说一句此刻最值得注意的话。
规则：
- headline 一句话（不超过 40 字）：可以是下一个时间块的提醒、要事进展的确认、或「要事还没动」的警示。
- suggestion 可选（不超过 60 字）：一个现在就能做的具体动作；没有就返回 null。
- 不重复【系统观察到的信号】已说的内容；数据平淡时就平实陈述进度，不制造焦虑，不说空话。`,
};

export function composeSystem(purpose) {
  return [IDENTITY, METHOD, STYLE, SPECS[purpose]].filter(Boolean).join('\n\n');
}

// ---------- user prompt 构造器 ----------
// 只带数据与本次输入；行为规则都在上面的 SPEC 里。

const DAY_TASK_SPEC = `请安排今天：选出 mits（最多 3 件，关联目标 id）；其他值得做的小事放 others；建议推迟或放弃的放 defer 并给理由；尽量为每件事给 blockStart（HH:MM，30 分钟对齐）；rationale 用 2-4 句话解释安排逻辑（联系目标与本周要事，如有取舍请说明）。`;

// prior：上一轮草案的文字版。给了就进入「迭代调整」模式（AI 先分解 → 用户一段话 → 最小修改）。
export function planDayPrompt(brainDump, prior = null) {
  const parts = [buildContext('plan-day')];
  if (prior) {
    parts.push(`【你上一轮的草案】（用户还未采纳）\n${prior}`);
    parts.push(`【用户对草案的反馈】\n${brainDump?.trim() || '（无具体反馈，请自行完善草案）'}`);
    parts.push(`请在草案基础上按反馈做最小调整，重新输出完整结果。${DAY_TASK_SPEC}`);
  } else {
    parts.push(`【用户现在的输入】\n${brainDump?.trim() || '（用户没有额外输入：请从当前里程碑与本周要事出发，主动分解出今天的安排）'}`);
    parts.push(DAY_TASK_SPEC);
  }
  return parts.join('\n\n');
}

const WEEK_SPEC = `请建议本周要事：3-5 件，每件关联目标 id 并说明理由（reason），最后给整体 rationale。`;

export function planWeekPrompt(input = '', prior = null) {
  const parts = [buildContext('plan-week')];
  if (prior) {
    parts.push(`【你上一轮的草案】（用户还未采纳）\n${prior}`);
    parts.push(`【用户对草案的反馈】\n${input?.trim() || '（无具体反馈，请自行完善草案）'}`);
    parts.push(`请在草案基础上按反馈做最小调整，重新输出完整结果。${WEEK_SPEC}`);
  } else {
    if (input?.trim()) parts.push(`【用户现在的输入】\n${input.trim()}`);
    parts.push(WEEK_SPEC);
  }
  return parts.join('\n\n');
}

export function decomposePrompt(title, why) {
  return `${buildContext('chat')}

用户想实现一个长期目标：「${title}」${why ? `\n用户写的理由：${why}` : ''}

请分解这个目标：why 一句话提炼它为什么重要（有用户理由则帮忙精炼）；milestones 3-6 个按时间排列、各带时间点；weeklyHours 每周建议投入；firstActions 本周就能开始的 2-3 个具体动作（每个 30-90 分钟）。`;
}

export function reviewDayPrompt(reflection) {
  return `${buildContext('review-day')}

【用户今晚的反思】${reflection?.trim() || '（未填写）'}

请点评今天。`;
}

export function weekSummaryPrompt(weekContext) {
  return `${weekContext}

请为这一周写复盘摘要。`;
}

export function monthSummaryPrompt(monthLabel, weeklySummaries) {
  return `以下是用户 ${monthLabel} 的每周复盘摘要：

${weeklySummaries}

请写月度摘要。`;
}

export function insightPrompt() {
  return `${buildContext('insight')}

请做一次深度分析：patterns 2-4 个行为模式（各带具体证据）；bottleneck 当前最大瓶颈及第一性原理拆解；leverage 1-3 个杠杆点；experiment 下周的一个小实验；oneLine 一句话总结。`;
}

export function briefPrompt() {
  return `${buildContext('brief')}

请给出此刻的观察（headline + 可选 suggestion）。`;
}

export function coachContext() {
  return buildContext('coach');
}

// ---------- JSON Schema（结构化输出契约） ----------

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

export const PLAN_DAY_SCHEMA = {
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

export const PLAN_WEEK_SCHEMA = {
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

export const DECOMPOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['why', 'milestones', 'weeklyHours', 'firstActions'],
  properties: {
    why: { type: 'string', description: '一句话：为什么重要' },
    milestones: { type: 'array', items: { type: 'string' }, description: '3-6 个按时间排列的里程碑，各带时间点' },
    weeklyHours: { type: 'integer', description: '建议每周投入小时数' },
    firstActions: { type: 'array', items: { type: 'string' }, description: '本周就能开始的 2-3 个具体动作' },
  },
};

export const INSIGHT_SCHEMA = {
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

export const OP_TYPES = [
  'add_task', 'update_task', 'complete_task', 'reopen_task', 'drop_task', 'move_task',
  'add_inbox', 'remove_inbox', 'inbox_to_day', 'set_reflection', 'review_day', 'set_week_review',
  'add_priority', 'toggle_priority', 'complete_milestone',
  'set_wake', 'set_sleep', 'set_exercise', 'note',
];

const APPLY_OP = {
  type: 'object', additionalProperties: false,
  required: ['type', 'date', 'title', 'text', 'taskId', 'inboxId', 'goalId', 'priorityId', 'milestoneId', 'estMin', 'actMin', 'blockStart', 'mit', 'urgent'],
  properties: {
    type: { type: 'string', enum: OP_TYPES },
    date: { ...nullable('string'), description: 'YYYY-MM-DD；null = 今天/本周' },
    title: { ...nullable('string'), description: '任务/收集箱/本周要事的标题' },
    text: { ...nullable('string'), description: '反思正文 / 复盘点评或摘要 / 作息值 / note 内容' },
    taskId: { ...nullable('string'), description: '上下文 [t:xxxx] 的 xxxx' },
    inboxId: { ...nullable('string'), description: '上下文 [i:xxxx] 的 xxxx' },
    goalId: { ...nullable('string'), description: '上下文 [id:...] 的完整目标 id' },
    priorityId: { ...nullable('string'), description: '上下文 [p:xxxx] 的 xxxx' },
    milestoneId: { ...nullable('string'), description: '上下文 [m:xxxx] 的 xxxx' },
    estMin: { ...nullable('integer'), description: '预计分钟' },
    actMin: { ...nullable('integer'), description: '实际分钟' },
    blockStart: { ...nullable('string'), description: 'HH:MM' },
    mit: { ...nullable('boolean'), description: '是否今日要事' },
    urgent: { ...nullable('boolean'), description: '是否紧急' },
  },
};

export const COACH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reply', 'ops'],
  properties: {
    reply: { type: 'string', description: '对话气泡正文：1-3 句；需要澄清时把问题写在这里且 ops 留空' },
    ops: { type: 'array', items: APPLY_OP, description: '要执行的修改；纯回答时为空数组' },
  },
};

export const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'suggestion'],
  properties: {
    headline: { type: 'string', description: '此刻最值得注意的一句话，≤40 字' },
    suggestion: { ...nullable('string'), description: '现在就能做的一个具体动作，≤60 字；无则 null' },
  },
};
