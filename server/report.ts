import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { effectiveAnalysis, snapshotMessages, type Analysis, type Evidence, type Judgment, type Override, type Quadrant, type RuleVersion, type Session, type Snapshot } from '../src/domain.ts';

const names: Record<Quadrant, string> = { Mind: '心智 Mind', Body: '身体 Body', Spirit: '精神与关系 Spirit', Vocation: '事业与贡献 Vocation' };
const quadrants: Quadrant[] = ['Mind', 'Body', 'Spirit', 'Vocation'];
const phaseNames = { Dissonance: '失调', Uncertainty: '不确定', Discovery: '发现' };
const contextNames = { 'long-term': '长期模式', recent: '近期状态', stress: '压力情境', unknown: '情境未知' };
const traitNames = { knowledge: '知识', experience: '体验', skill: '技能', unknown: '维度未知' };
const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
const body = (text: string, bold = false) => new Paragraph({ children: [new TextRun({ text: text || '尚未提供', bold })], spacing: { after: 120, line: 300 }, widowControl: true });
const heading = (text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 = HeadingLevel.HEADING_1) => new Paragraph({ text, heading: level, keepNext: true, spacing: { before: 240, after: 120 } });
function list(items: string[], empty: string): Paragraph[] { return items.length ? items.map((text) => body(`• ${text}`)) : [body(empty)]; }
function matrix(rows: string[][], widths: number[]): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, rowIndex) => new TableRow({ tableHeader: rowIndex === 0, cantSplit: true, children: row.map((text, col) => new TableCell({
      width: { size: widths[col], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
      shading: { fill: rowIndex === 0 ? 'DDEBF7' : rowIndex % 2 === 0 ? 'F5F7FA' : 'FFFFFF' },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: rowIndex === 0, color: '000000' })], spacing: { after: 30, line: 280 } })],
    })) })),
  });
}
function evidenceParagraphs(items: Evidence[], empty: string): Paragraph[] {
  return items.length ? items.flatMap((e) => [body(`“${e.quote}”`), body(`${e.kind === 'statement' ? '用户陈述' : '解释性引用'}；${contextNames[e.context]}；${traitNames[e.trait]}；回答 ${e.messageId}`)]) : [body(empty)];
}
function judgmentParts(judgment: Judgment): Paragraph[] {
  return [body(`暂定位置：${judgment.level ?? '未知'}；阶段：${judgment.phase ? phaseNames[judgment.phase] : '未知'}`), body(judgment.rationale), body('支持证据', true), ...evidenceParagraphs(judgment.support, '尚无足够支持证据。'), body('反证与限制', true), ...evidenceParagraphs(judgment.counter, '尚未收集到反证，不代表不存在反证。'), body('待澄清', true), ...list(judgment.unknowns, '暂无新增问题。')];
}
function planParts(plan: Analysis['plan']): Paragraph[] {
  return [body(`目标：${plan.goal}`), ...list(plan.actions, '尚未确定行动。'), body(`七天验证：${plan.sevenDays}`), body(`三十至九十天观察：${plan.thirtyToNinetyDays}`), body(`复盘标准：${plan.review}`), body(`忙碌时的保底行动：${plan.busyFallback}`)];
}

export async function buildReport(session: Session, snapshot: Snapshot, override: Override | undefined, rules: RuleVersion): Promise<Buffer> {
  const messages = snapshotMessages(session, snapshot);
  const branch = session.branches.find((item) => item.id === snapshot.branchId)!;
  const snapshotOverrides = session.overrides.filter((item) => item.snapshotId === snapshot.id);
  override ??= snapshotOverrides.at(-1);
  const appliedOverrides = override ? snapshotOverrides.slice(0, snapshotOverrides.findIndex((item) => item.id === override.id) + 1) : [];
  const analysis = effectiveAnalysis({ ...session, overrides: appliedOverrides }, snapshot);
  const priority = [...appliedOverrides].reverse().find((item) => item.priority)?.priority;
  const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const sections: (Paragraph | Table)[] = [
    new Paragraph({ text: 'Human 3.0 个人成长访谈报告', heading: HeadingLevel.TITLE, spacing: { after: 180 } }),
    body('这份报告整理理想生活、四象限中的自我陈述与暂定解释，并将优先事项转化为可回顾的小步行动。所有判断均可修订；证据不足处保持未知。它不构成医学或心理诊断，也不是经过验证的量表结果。'),
    body(`${session.title} · ${branch.name}`),
    matrix([['记录项目', '本报告采用的版本'], ['分析时间', `${time(snapshot.createdAt)} 北京时间`], ['模型与模式', `${snapshot.model} / ${snapshot.mode === 'demo' ? '演示模式 未进行真实模型评估' : '真实模型建议'}`], ['分析与分支', `${snapshot.id} / ${snapshot.branchId}`], ['输入版本', `${snapshot.inputVersion} 条回答记录${snapshot.inputVersion < branch.inputVersion ? ' 本报告为历史快照' : ''}`], ['规则版本', `第 ${rules.version} 版 / ${rules.id}`], ['用户修订', override ? `${override.id} / ${time(override.createdAt)}` : '未采用用户修订']], [2200, 7160]),
    heading('理想生活与当前优先事项'),
    ...messages.filter((m) => m.topic === 'ideal' && !m.skipped).flatMap((m) => [body(m.question, true), body(m.text)]),
    body(`优先事项：${priority || messages.filter((m) => m.topic === 'priority' && !m.skipped).map((m) => m.text).join('；') || '尚未明确，需要由本人选择。'}`),
    heading('四象限概览'),
    matrix([['象限', '模型暂定位置', '采用位置', '采用阶段'], ...quadrants.map((q) => [names[q], snapshot.analysis.quadrants[q].level ?? '未知', analysis.quadrants[q].level ?? '未知', analysis.quadrants[q].phase ? phaseNames[analysis.quadrants[q].phase!] : '未知'])], [2760, 2200, 2200, 2200]),
    body('各象限独立呈现，没有总等级。暂定位置不代表个人价值；知识、体验与稳定技能需要不同证据。'),
    heading('优势与潜力'), ...list(analysis.strengths, '优势仍待访谈确认。'), ...list(analysis.potential, '潜力仍待验证。'),
    heading('阻碍与跨象限冲突'), ...list(analysis.obstacles, '尚未确认主要阻碍。'), ...list(analysis.tensions, '尚未确认跨象限冲突。'),
  ];
  for (const q of quadrants) {
    sections.push(heading(names[q]), ...judgmentParts(analysis.quadrants[q]));
    if (appliedOverrides.some((item) => item.quadrants[q])) sections.push(heading('该象限原始模型建议', HeadingLevel.HEADING_2), ...judgmentParts(snapshot.analysis.quadrants[q]));
  }
  sections.push(heading('可执行的成长计划'), ...planParts(analysis.plan));
  if (appliedOverrides.some((item) => item.plan || item.priority)) sections.push(heading('原始模型行动建议', HeadingLevel.HEADING_2), ...planParts(snapshot.analysis.plan));
  sections.push(heading('用户修订记录'));
  if (!appliedOverrides.length) sections.push(body('当前报告未采用用户修订。'));
  for (const item of appliedOverrides) {
    sections.push(body(`修订 ${item.id}；${time(item.createdAt)}`), body(`修订原因：${item.reason}`));
    if (item.reportNotes) sections.push(body(`本人补充：${item.reportNotes}`));
    if (item.priority) sections.push(body(`优先事项：${item.priority}`));
    sections.push(body(`修订范围：${Object.keys(item.quadrants).map((key) => names[key as Quadrant]).join('、') || '未改动象限'}${item.plan ? '；行动计划' : ''}${item.priority ? '；优先级' : ''}`));
  }
  sections.push(heading('下一步访谈'), body(snapshot.analysis.endReason ? `结束依据：${snapshot.analysis.endReason}` : `待讨论：${snapshot.analysis.nextQuestion}`));
  sections.push(heading('问答与证据原文'));
  for (const message of messages) sections.push(heading(`回答 ${messages.indexOf(message) + 1}`, HeadingLevel.HEADING_2), body(`记录编号：${message.id}；${time(message.createdAt)}`), body(message.question, true), body(message.skipped ? '用户跳过了此问题，不作为证据。' : message.text));
  sections.push(heading('采用的规则版本'), body(`规则 ${rules.id}；第 ${rules.version} 版；${time(rules.createdAt)}`), body(`修订说明：${rules.note || '初始规则'}`));
  for (const q of quadrants) {
    const anchor = rules.anchors[q];
    sections.push(heading(names[q], HeadingLevel.HEADING_2), body(`L1：${anchor.L1}`), body(`L2：${anchor.L2}`), body(`L3：${anchor.L3}`), body(`观察维度：${anchor.observations}`), body(`自定义观察提示：${anchor.prompt || '无'}`));
  }
  const sourceText = await readFile(fileURLToPath(new URL('../docs/SOURCES.md', import.meta.url)), 'utf8');
  sections.push(heading('框架来源与使用边界'));
  const reportSources = sourceText.split(/(?=^## )/m).filter((part) => part.startsWith('## 原始来源') || part.startsWith('## 不可被自定义规则解除'));
  sections.push(body('中文行为锚点是本工具采用的产品解释，可以按版本修改，不是官方量表。四象限分别观察，L1至L3与发展阶段分别记录，资料不足时保持未知。'));
  for (const part of reportSources) for (const line of part.split(/\r?\n/).filter((line) => line.trim())) {
    const plain = line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2').replace('以下两篇由项目执行过程通过 Firecrawl 读取；', '以下两篇为框架原始来源；');
    sections.push(body(plain));
  }
  const doc = new Document({
    creator: 'Human 3.0 对话工作台', title: 'Human 3.0 个人成长访谈报告', description: '个人访谈的版本化证据与成长行动记录',
    styles: { default: { document: { run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }, size: 22, color: '000000' }, paragraph: { spacing: { after: 120, line: 300 } } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 36, bold: true, color: '000000' }, paragraph: { alignment: AlignmentType.LEFT, spacing: { after: 180 } } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 28, bold: true, color: '000000' }, paragraph: { keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 24, bold: true, color: '000000' }, paragraph: { keepNext: true, outlineLevel: 1 } },
    ] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1273, bottom: 1134, left: 1273 } } }, children: sections }],
  });
  return Packer.toBuffer(doc);
}
