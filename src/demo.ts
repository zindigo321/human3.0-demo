import { QUADRANTS, OPENING_QUESTION, validateAnalysis } from './domain';
import type { Analysis, Evidence, Judgment, Message, Quadrant, RuleVersion, Topic } from './domain';

const names: Record<Quadrant, string> = {Mind: '思维与情绪', Body: '身体与恢复', Spirit: '关系与意义', Vocation: '工作与贡献'};
const excerpt = (text: string, length = 48) => text.trim().slice(0, length).replace(/[?？\r\n]/g, ' ');
function contextOf(text: string): Evidence['context'] {
  if (/(压力下|压力大|压力很大|紧张时|赶工时|考试期间)/.test(text)) return 'stress';
  if (/(最近|近期|这周|本周|上周|这几天)/.test(text)) return 'recent';
  if (/(长期|多年来|一直以来|每周|每天)/.test(text)) return 'long-term';
  return 'unknown';
}
function evidence(message: Message): Evidence {
  return {messageId: message.id, quote: message.text.trim().slice(0, 240), kind: 'statement', context: contextOf(message.text), trait: 'unknown'};
}
function nextStep(messages: Message[], rules: RuleVersion): Pick<Analysis, 'nextTopic' | 'nextQuestion' | 'endReason'> {
  const last = messages.at(-1);
  if (!last) return {nextTopic: 'ideal', nextQuestion: OPENING_QUESTION, endReason: null};
  if (last.topic === 'priority') return {nextTopic: 'priority', nextQuestion: '', endReason: last.skipped ? '优先级仍待确认，可先生成暂定报告；如愿意，之后可选择优先级主题补充。' : '已完成近期优先级确认，可先生成暂定报告；仍可选择主题继续。'};
  if (messages.length >= 17) return {nextTopic: 'priority', nextQuestion: '接下来七天，你最想优先改善的一件事是什么？', endReason: null};
  const current = QUADRANTS.includes(last.topic as Quadrant) ? last.topic as Quadrant : undefined;
  let topic: Topic | undefined;
  if (current && !last.skipped && messages.filter(m => m.topic === current).length < 3) topic = current;
  if (!topic) {
    const start = current ? QUADRANTS.indexOf(current) + 1 : 0;
    const ordered = [...QUADRANTS.slice(start), ...QUADRANTS.slice(0, start)];
    topic = ordered.find(q => {
      const items = messages.filter(m => m.topic === q);
      return items.length < 3 && !items.at(-1)?.skipped;
    });
  }
  if (!topic) return {nextTopic: 'priority', nextQuestion: '接下来七天，你最想优先改善的一件事是什么？', endReason: null};
  const quadrant = topic as Quadrant;
  const answers = messages.filter(m => m.topic === quadrant && !m.skipped);
  let question: string;
  if (!answers.length) {
    const ideal = messages.find(m => m.topic === 'ideal' && !m.skipped);
    const anchor = rules.anchors[quadrant].prompt.slice(0, 1000);
    question = ideal ? `你理想的日子里提到「${excerpt(ideal.text, 30)}」。转向${names[quadrant]}：${anchor}` : anchor;
  } else if (answers.length === 1) {
    question = `你提到「${excerpt(answers[0].text)}」。能用一个具体场景说明你当时实际做了什么吗？`;
  } else {
    question = `围绕「${excerpt(answers.at(-1)!.text)}」，现实中影响你持续实践的一个主要条件是什么？`;
  }
  return {nextTopic: quadrant, nextQuestion: question, endReason: null};
}

/** Deterministic local demonstration: organizes statements and asks follow-ups; never assigns a level. */
export function demoAnalyze(messages: Message[], rules: RuleVersion): Analysis {
  const quadrants = Object.fromEntries(QUADRANTS.map(quadrant => {
    const answers = messages.filter(m => m.topic === quadrant && !m.skipped);
    const judgment: Judgment = {
      level: null, phase: null,
      rationale: answers.length ? `已记录 ${answers.length} 条${names[quadrant]}主题的用户陈述。演示模式仅整理原文，不判断层级或阶段；陈述尚待实际经历与稳定表现核实。` : '待了解：暂无本领域有效回答。跳过不作为负面评价依据。',
      support: answers.map(evidence), counter: [],
      unknowns: answers.length ? ['具体行为在长期、近期与压力情境下是否一致。', '理解理念、实践经验与实际技能之间的区别。', '相反经历、可用资源及外部限制仍需核实。'] : ['尚未了解该领域的具体经历、实际行为和现实约束。'],
    };
    return [quadrant, judgment];
  })) as Record<Quadrant, Judgment>;
  const priority = messages.filter(m => m.topic === 'priority' && !m.skipped).at(-1)?.text.trim();
  const goal = priority ? `围绕用户确认的优先级：${priority.slice(0, 300)}` : '待确认：近期最想优先改善的一件事';
  return validateAnalysis({
    quadrants, ...nextStep(messages, rules),
    tensions: [], strengths: [], obstacles: ['尚需区分个人习惯与资源、制度、环境限制；演示模式不推断原因。'], potential: ['待结合具体经历确认可持续的实践，暂不作能力推断。'],
    plan: {
      goal,
      actions: priority ? ['从上述优先级中选一个现有资源下可做、不超过十分钟的小步骤。', '尝试后记录实际感受与遇到的限制，再决定保留、缩小或暂停。'] : ['先选定一件近期最重要、愿意改善的事，再共同确定一个小步骤。'],
      sevenDays: priority ? '前两天选择并试做一次小步骤；一周内按精力决定是否再做一次，不要求连续打卡。' : '七天内先确认优先级与可用时间，资料不足时不急于增加任务。',
      thirtyToNinetyDays: '先观察两周的实际反馈，再决定是否维持；三十至九十天内仅在有帮助且可持续时逐步调整。',
      review: '每周简短记录一次实际做了什么、什么条件有帮助、下一步是否需要调整；不按完成率评价自己。',
      busyFallback: '忙碌或恢复期可缩小到两分钟记录，也可以暂停，恢复后重新选择步幅。',
    },
  }, messages);
}
