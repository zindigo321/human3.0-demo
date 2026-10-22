import { z } from 'zod';
import { createDefaultRule } from './rules';

export const QUADRANTS = ['Mind', 'Body', 'Spirit', 'Vocation'] as const;
export const TOPICS = ['ideal', ...QUADRANTS, 'priority'] as const;
export type Quadrant = typeof QUADRANTS[number];
export type Topic = typeof TOPICS[number];
export type Level = 'L1' | 'L2' | 'L3' | null;
export type Phase = 'Dissonance' | 'Uncertainty' | 'Discovery' | null;
const idSchema = z.string().trim().min(1).max(150);
const text = z.string().max(20000);
const requiredText = z.string().trim().min(1).max(20000);
const dateSchema = z.string().datetime();
export const topicSchema = z.enum(TOPICS);
const questionSchema = z.string().max(1200).refine(value => (value.match(/[?？]/g) ?? []).length <= 1, '每轮只能有一个核心问题');
export const messageSchema = z.object({
  id: idSchema, question: requiredText, text, topic: topicSchema, skipped: z.boolean(),
  createdAt: dateSchema, revisionOf: idSchema.optional(),
}).strict().refine(value => value.skipped || value.text.trim().length > 0, '回答不能为空');
export const anchorSchema = z.object({L1: requiredText, L2: requiredText, L3: requiredText, observations: requiredText, prompt: questionSchema.refine(v => v.trim().length > 0, '追问提示不能为空')}).strict();
export const ruleSchema = z.object({
  id: idSchema, createdAt: dateSchema, version: z.number().int().positive(),
  anchors: z.object({Mind: anchorSchema, Body: anchorSchema, Spirit: anchorSchema, Vocation: anchorSchema}).strict(), note: text,
}).strict();
export const evidenceSchema = z.object({
  messageId: idSchema, quote: z.string().min(1).max(20000).refine(v => v.trim().length > 0, '引文不能为空白'),
  kind: z.enum(['statement', 'interpretation']), context: z.enum(['long-term', 'recent', 'stress', 'unknown']),
  trait: z.enum(['knowledge', 'experience', 'skill', 'unknown']),
}).strict();
export const judgmentSchema = z.object({
  level: z.enum(['L1', 'L2', 'L3']).nullable(), phase: z.enum(['Dissonance', 'Uncertainty', 'Discovery']).nullable(),
  rationale: requiredText, support: z.array(evidenceSchema).max(100), counter: z.array(evidenceSchema).max(100),
  unknowns: z.array(requiredText).max(100),
}).strict().refine(j => (j.level === null && j.phase === null) || j.support.length > 0, '暂定层级或阶段必须有关联的支持证据');
export const planSchema = z.object({goal: requiredText, actions: z.array(requiredText).min(1).max(6), sevenDays: requiredText, thirtyToNinetyDays: requiredText, review: requiredText, busyFallback: requiredText}).strict();
export const analysisSchema = z.object({
  quadrants: z.object({Mind: judgmentSchema, Body: judgmentSchema, Spirit: judgmentSchema, Vocation: judgmentSchema}).strict(),
  nextQuestion: questionSchema, nextTopic: topicSchema, endReason: requiredText.nullable(),
  tensions: z.array(requiredText).max(100), strengths: z.array(requiredText).max(100), obstacles: z.array(requiredText).max(100), potential: z.array(requiredText).max(100), plan: planSchema,
}).strict().refine(a => a.endReason !== null || a.nextQuestion.trim().length > 0, '继续访谈需要下一轮问题');
export const branchSchema = z.object({
  id: idSchema, name: requiredText, parentId: idSchema.nullable(), forkMessageId: idSchema.nullable(),
  messageIds: z.array(idSchema).max(10000), inputVersion: z.number().int().nonnegative(), paused: z.boolean(), nextQuestion: questionSchema, nextTopic: topicSchema,
}).strict();
export const snapshotSchema = z.object({
  id: idSchema, branchId: idSchema, inputVersion: z.number().int().nonnegative(), ruleId: idSchema,
  createdAt: dateSchema, model: requiredText, mode: z.enum(['demo', 'live']), analysis: analysisSchema,
}).strict();
export const overrideSchema = z.object({
  id: idSchema, snapshotId: idSchema, createdAt: dateSchema, reason: requiredText,
  quadrants: z.object({Mind: judgmentSchema.optional(), Body: judgmentSchema.optional(), Spirit: judgmentSchema.optional(), Vocation: judgmentSchema.optional()}).strict(),
  plan: planSchema.optional(), priority: requiredText.optional(), reportNotes: text.optional(),
}).strict();
export const sessionSchema = z.object({
  id: idSchema, title: requiredText, createdAt: dateSchema, messages: z.array(messageSchema).max(10000), branches: z.array(branchSchema).min(1).max(1000), activeBranchId: idSchema,
  snapshots: z.array(snapshotSchema).max(10000), overrides: z.array(overrideSchema).max(10000),
}).strict();
export const storeSchema = z.object({schemaVersion: z.literal(1), sessions: z.array(sessionSchema).min(1).max(1000), activeSessionId: idSchema, rules: z.array(ruleSchema).min(1).max(1000), activeRuleId: idSchema}).strict();
export const bindingSchema = z.object({sessionId: idSchema, branchId: idSchema, inputVersion: z.number().int().nonnegative(), ruleId: idSchema}).strict();
export type Message = z.infer<typeof messageSchema>;
export type RuleVersion = z.infer<typeof ruleSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Judgment = z.infer<typeof judgmentSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Branch = z.infer<typeof branchSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Override = z.infer<typeof overrideSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Store = z.infer<typeof storeSchema>;
export type RequestBinding = z.infer<typeof bindingSchema>;
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const OPENING_QUESTION = '三年后，一个让你愿意长期过下去的普通日子，会是什么样？';
const topicQuestions: Record<Topic, string> = {
  ideal: OPENING_QUESTION,
  Mind: '最近一次你调整原有看法的具体经历是什么？',
  Body: '最近一周，哪一次身体照顾或恢复的实际经历最值得记录？',
  Spirit: '最近哪一次与他人的相处，让你感到自己的重要价值被体现或受到挑战？',
  Vocation: '围绕你想做的工作或学习，最近一次已经采取的具体行动是什么？',
  priority: '接下来七天，你最想优先改善的一件事是什么？',
};

export function createStore(): Store {
  const rules = [createDefaultRule()];
  const store: Store = {schemaVersion: 1, sessions: [], activeSessionId: '', rules, activeRuleId: rules[0].id};
  createSession(store);
  return store;
}
export function createSession(store: Store, title = '我的生活访谈'): Session {
  const branch: Branch = {id: id(), name: '主分支', parentId: null, forkMessageId: null, messageIds: [], inputVersion: 0, paused: false, nextQuestion: OPENING_QUESTION, nextTopic: 'ideal'};
  const session: Session = {id: id(), title: requiredText.parse(title), createdAt: now(), messages: [], branches: [branch], activeBranchId: branch.id, snapshots: [], overrides: []};
  store.sessions.push(session);
  store.activeSessionId = session.id;
  return session;
}
export function getSession(store: Store): Session {
  const result = store.sessions.find(s => s.id === store.activeSessionId);
  if (!result) throw new Error('当前会话不存在');
  return result;
}
export function getBranch(session: Session): Branch {
  const result = session.branches.find(b => b.id === session.activeBranchId);
  if (!result) throw new Error('当前分支不存在');
  return result;
}
export function getMessages(session: Session, branch = getBranch(session)): Message[] {
  const messages = new Map(session.messages.map(m => [m.id, m]));
  return branch.messageIds.map(messageId => {
    const message = messages.get(messageId);
    if (!message) throw new Error('分支中的回答不存在');
    return message;
  });
}
export function getRule(store: Store): RuleVersion {
  const rule = store.rules.find(r => r.id === store.activeRuleId);
  if (!rule) throw new Error('当前规则不存在');
  return rule;
}
export function submitAnswer(store: Store, answer: string, skipped = false): Message {
  const session = getSession(store), branch = getBranch(session);
  if (branch.paused) throw new Error('访谈已暂停，请先恢复');
  if (!branch.nextQuestion.trim()) throw new Error('本次访谈已收尾，请选择主题后继续');
  const message = messageSchema.parse({id: id(), question: branch.nextQuestion, text: skipped ? '' : answer.trim(), topic: branch.nextTopic, skipped, createdAt: now()});
  session.messages.push(message);
  branch.messageIds.push(message.id);
  branch.inputVersion = branch.messageIds.length;
  return message;
}
export function forkAnswer(store: Store, messageId: string, answer: string): Branch {
  const session = getSession(store), parent = getBranch(session), index = parent.messageIds.indexOf(messageId);
  if (index < 0) throw new Error('只能修改当前有效分支中的回答');
  const original = session.messages.find(m => m.id === messageId)!;
  const message = messageSchema.parse({...original, id: id(), text: answer.trim(), skipped: false, createdAt: now(), revisionOf: messageId});
  const branch: Branch = {id: id(), name: `修订分支 ${session.branches.length}`, parentId: parent.id, forkMessageId: messageId, messageIds: [...parent.messageIds.slice(0, index), message.id], inputVersion: index + 1, paused: false, nextQuestion: topicQuestions[original.topic], nextTopic: original.topic};
  session.messages.push(message);
  session.branches.push(branch);
  session.activeBranchId = branch.id;
  return branch;
}
export function switchBranch(store: Store, branchId: string): void {
  const session = getSession(store);
  if (!session.branches.some(b => b.id === branchId)) throw new Error('分支不存在');
  session.activeBranchId = branchId;
}
export function setTopic(store: Store, topic: Topic): void {
  topicSchema.parse(topic);
  const branch = getBranch(getSession(store));
  branch.nextTopic = topic;
  branch.nextQuestion = QUADRANTS.includes(topic as Quadrant) ? getRule(store).anchors[topic as Quadrant].prompt : topicQuestions[topic];
}
export function addRule(store: Store, anchors: RuleVersion['anchors'], note: string): RuleVersion {
  const rule = ruleSchema.parse({id: id(), createdAt: now(), version: Math.max(...store.rules.map(r => r.version)) + 1, anchors, note});
  store.rules.push(rule);
  store.activeRuleId = rule.id;
  return rule;
}
export function requestBinding(store: Store): RequestBinding {
  const session = getSession(store), branch = getBranch(session);
  return {sessionId: session.id, branchId: branch.id, inputVersion: branch.inputVersion, ruleId: store.activeRuleId};
}
export function latestSnapshot(store: Store): Snapshot | undefined {
  const session = getSession(store);
  return [...session.snapshots].reverse().find(s => s.branchId === session.activeBranchId);
}
export function isStale(store: Store, snapshot: Snapshot): boolean {
  const binding = requestBinding(store);
  return !getSession(store).snapshots.some(s => s.id === snapshot.id) || snapshot.branchId !== binding.branchId || snapshot.inputVersion !== binding.inputVersion || snapshot.ruleId !== binding.ruleId;
}

function validateJudgmentReferences(judgment: Judgment, quadrant: Quadrant, messages: Message[]): void {
  for (const evidence of [...judgment.support, ...judgment.counter]) {
    const source = messages.find(m => m.id === evidence.messageId);
    if (!source || source.skipped) throw new Error(`${quadrant} 的证据未关联到有效回答`);
    if (source.topic !== quadrant) throw new Error(`${quadrant} 的证据来自其他主题，不能直接迁移判断`);
    if (!source.text.includes(evidence.quote) || !evidence.quote.trim()) throw new Error(`${quadrant} 的引文不是回答中的真实片段`);
  }
}
export function validateAnalysis(input: unknown, messages: Message[]): Analysis {
  const analysis = analysisSchema.parse(input);
  for (const quadrant of QUADRANTS) validateJudgmentReferences(analysis.quadrants[quadrant], quadrant, messages);
  return analysis;
}
export function applyAnalysis(store: Store, binding: RequestBinding, input: unknown, model: string, mode: 'demo' | 'live'): Snapshot | null {
  const current = requestBinding(store);
  if (Object.keys(current).some(key => current[key as keyof RequestBinding] !== binding[key as keyof RequestBinding])) return null;
  const session = getSession(store), branch = getBranch(session);
  const messages = getMessages(session);
  const analysis = validateAnalysis(input, messages);
  // Interview scheduling is an application constraint, independent of the model's judgments.
  const last = messages.at(-1);
  const lastThree = messages.slice(-3);
  const priorityAsked = messages.some(message => message.topic === 'priority');
  const priorityConfirmed = messages.some(message => message.topic === 'priority' && !message.skipped);
  if (analysis.endReason && priorityAsked && !priorityConfirmed) {
    analysis.endReason = '优先级仍待确认，可先生成暂定报告；如愿意，之后可选择优先级主题补充。';
    analysis.nextQuestion = '';
  }
  if ((analysis.endReason || messages.length >= 17) && !priorityAsked) {
    analysis.endReason = null;
    analysis.nextTopic = 'priority';
    analysis.nextQuestion = topicQuestions.priority;
  } else if (!analysis.endReason && last && QUADRANTS.includes(last.topic as Quadrant) && lastThree.length === 3 && lastThree.every(message => message.topic === last.topic) && analysis.nextTopic === last.topic) {
    const next = QUADRANTS.find(quadrant => quadrant !== last.topic && messages.filter(message => message.topic === quadrant).length < 3);
    analysis.nextTopic = next ?? 'priority';
    analysis.nextQuestion = next ? getRule(store).anchors[next].prompt : topicQuestions.priority;
  }
  const snapshot = snapshotSchema.parse({id: id(), branchId: binding.branchId, inputVersion: binding.inputVersion, ruleId: binding.ruleId, createdAt: now(), model, mode, analysis});
  session.snapshots.push(snapshot);
  branch.nextQuestion = analysis.endReason ? '' : analysis.nextQuestion;
  branch.nextTopic = analysis.nextTopic;
  return snapshot;
}
export function snapshotMessages(session: Session, snapshot: Snapshot): Message[] {
  const branch = session.branches.find(b => b.id === snapshot.branchId);
  if (!branch || snapshot.inputVersion > branch.messageIds.length) throw new Error('评估的分支或输入版本无效');
  return getMessages(session, branch).slice(0, snapshot.inputVersion);
}
function validateOverrideReferences(session: Session, override: Override): void {
  const snapshot = session.snapshots.find(s => s.id === override.snapshotId);
  if (!snapshot) throw new Error('用户修订对应的评估不存在');
  const messages = snapshotMessages(session, snapshot);
  for (const quadrant of QUADRANTS) {
    const judgment = override.quadrants[quadrant];
    if (judgment) validateJudgmentReferences(judgment, quadrant, messages);
  }
}
export function addOverride(store: Store, input: Omit<Override, 'id' | 'createdAt'>): Override {
  const session = getSession(store);
  const override = overrideSchema.parse({...input, id: id(), createdAt: now()});
  validateOverrideReferences(session, override);
  session.overrides.push(override);
  return override;
}
export function effectiveAnalysis(session: Session, snapshot: Snapshot): Analysis {
  const result = structuredClone(snapshot.analysis);
  for (const override of session.overrides.filter(o => o.snapshotId === snapshot.id)) {
    validateOverrideReferences(session, override);
    for (const quadrant of QUADRANTS) if (override.quadrants[quadrant]) result.quadrants[quadrant] = structuredClone(override.quadrants[quadrant]!);
    if (override.plan) result.plan = structuredClone(override.plan);
  }
  return validateAnalysis(result, snapshotMessages(session, snapshot));
}
function uniqueIds(items: {id: string}[], label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`${label} ID 重复`);
}
export function validateSession(input: unknown, rules?: RuleVersion[]): Session {
  const session = sessionSchema.parse(input);
  uniqueIds(session.messages, '回答'); uniqueIds(session.branches, '分支'); uniqueIds(session.snapshots, '评估'); uniqueIds(session.overrides, '修订');
  getBranch(session);
  const messageMap = new Map(session.messages.map(m => [m.id, m]));
  const branchMap = new Map(session.branches.map(b => [b.id, b]));
  const referenced = new Set<string>();
  if (session.branches.filter(b => b.parentId === null).length !== 1) throw new Error('会话必须有且仅有一个主分支');
  for (const branch of session.branches) {
    if (new Set(branch.messageIds).size !== branch.messageIds.length) throw new Error('分支含重复回答');
    if (branch.inputVersion !== branch.messageIds.length) throw new Error('分支输入版本与回答数量不一致');
    for (const messageId of branch.messageIds) {
      if (!messageMap.has(messageId)) throw new Error('分支关联的回答不存在');
      referenced.add(messageId);
    }
    const visited = new Set<string>([branch.id]);
    let ancestorId = branch.parentId;
    while (ancestorId) {
      if (visited.has(ancestorId)) throw new Error('分支父级形成循环');
      visited.add(ancestorId);
      const ancestor = branchMap.get(ancestorId);
      if (!ancestor) throw new Error('父分支不存在');
      ancestorId = ancestor.parentId;
    }
    if (branch.parentId === null) {
      if (branch.forkMessageId !== null) throw new Error('主分支不能含修订位置');
      if (getMessages(session, branch).some(m => m.revisionOf)) throw new Error('主分支不能含修订回答');
    } else {
      const parent = branchMap.get(branch.parentId)!;
      const index = branch.forkMessageId ? parent.messageIds.indexOf(branch.forkMessageId) : -1;
      if (index < 0 || branch.messageIds.length <= index) throw new Error('修订位置无效');
      if (branch.messageIds.slice(0, index).some((messageId, i) => messageId !== parent.messageIds[i])) throw new Error('修订分支的前缀与父分支不一致');
      const revised = messageMap.get(branch.messageIds[index])!;
      const original = messageMap.get(branch.forkMessageId!)!;
      if (revised.revisionOf !== original.id || revised.id === original.id || revised.topic !== original.topic || revised.question !== original.question) throw new Error('修订回答的来源关联无效');
      if (branch.messageIds.slice(index).some(messageId => parent.messageIds.slice(index).includes(messageId))) throw new Error('旧分支后续回答被混入修订分支');
      if (branch.messageIds.slice(index + 1).some(messageId => messageMap.get(messageId)!.revisionOf !== undefined)) throw new Error('分支后续回答不能伪装为其他历史修订');
    }
  }
  for (const message of session.messages) {
    if (!referenced.has(message.id)) throw new Error('回答没有所属分支');
    if (message.revisionOf && (!messageMap.has(message.revisionOf) || message.id === message.revisionOf)) throw new Error('回答修订来源不存在');
  }
  for (const snapshot of session.snapshots) {
    if (rules && !rules.some(rule => rule.id === snapshot.ruleId)) throw new Error('评估所用规则版本不存在');
    validateAnalysis(snapshot.analysis, snapshotMessages(session, snapshot));
  }
  for (const override of session.overrides) validateOverrideReferences(session, override);
  return session;
}
export function validateStore(input: unknown): Store {
  const store = storeSchema.parse(input);
  uniqueIds(store.sessions, '会话'); uniqueIds(store.rules, '规则');
  if (new Set(store.rules.map(r => r.version)).size !== store.rules.length) throw new Error('规则版本号重复');
  getSession(store); getRule(store);
  for (const session of store.sessions) validateSession(session, store.rules);
  return store;
}

export { demoAnalyze } from './demo';
