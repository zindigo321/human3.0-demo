import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import type { Store } from '../src/domain';

const STORAGE_KEY = 'human3.workbench.v1';
const browserErrors = new WeakMap<Page, string[]>();
async function saved(page: Page): Promise<Store> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORAGE_KEY);
}
async function current(page: Page) {
  const store = await saved(page);
  return store.sessions.find((s) => s.id === store.activeSessionId)!;
}
async function activeBranch(page: Page) {
  const session = await current(page);
  return session.branches.find((b) => b.id === session.activeBranchId)!;
}
async function answer(page: Page, value: string) {
  const before = await saved(page), count = before?.sessions.find((s) => s.id === before.activeSessionId)?.snapshots.length || 0;
  await page.getByLabel('你的回答', { exact: true }).fill(value);
  await page.getByRole('button', { name: '发送回答 ↑', exact: true }).click();
  await expect.poll(async () => (await current(page)).snapshots.length).toBe(count + 1);
  await expect(page.getByRole('button', { name: '发送回答 ↑', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}
async function reanalyze(page: Page) {
  const count = (await current(page)).snapshots.length;
  await page.getByRole('button', { name: '↻ 重新分析', exact: true }).click();
  await expect.poll(async () => (await current(page)).snapshots.length).toBe(count + 1);
}
async function closeDialog(page: Page) { await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); }
function unzipXml(buffer: Buffer) {
  for (let i = 0; i < buffer.length - 46; i++) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
    const length = buffer.readUInt16LE(i + 28);
    if (buffer.subarray(i + 46, i + 46 + length).toString() !== 'word/document.xml') continue;
    const size = buffer.readUInt32LE(i + 20), offset = buffer.readUInt32LE(i + 42);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    return inflateRawSync(buffer.subarray(start, start + size)).toString('utf8');
  }
  throw new Error('Missing document XML');
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The explicit 502 test intentionally makes the browser log the failed HTTP resource.
    if (/Failed to load resource.*502/.test(message.text())) return;
    errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByText('正在连接', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '理想生活 / 对话' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) || [], 'unexpected browser runtime or console errors').toEqual([]);
});

test('initial interview asks one question, adapts to answers, changes topic and locates exact evidence', async ({ page }) => {
  const question = await page.locator('.current-question h2').innerText();
  expect((question.match(/[?？]/g) || []).length).toBe(1);
  await expect(page.getByRole('button', { name: '发送回答 ↑' })).toBeDisabled();
  await page.getByLabel('你的回答', { exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: '发送回答 ↑' })).toBeDisabled();
  await answer(page, '希望每天早晨安静研究，晚上陪伴家人。');
  expect((await activeBranch(page)).nextQuestion).toContain('希望每天早晨安静研究');
  await answer(page, '最近一次根据反例调整了研究方法，保留原有记录。');
  expect((await activeBranch(page)).nextQuestion).toContain('最近一次根据反例调整');
  const session = await current(page);
  expect(session.messages).toHaveLength(2);
  expect(session.messages[1].topic).toBe('Mind');
  await page.getByLabel('切换主题').selectOption('Body');
  expect((await activeBranch(page)).nextTopic).toBe('Body');
  const bodyAnswer = '这周每天散步二十分钟，疲惫时会缩短为十分钟。';
  await answer(page, bodyAnswer);
  await page.locator('.quadrant.q1').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '身体 · 判断与依据' })).toBeVisible();
  await dialog.locator('.quote').first().click();
  const bodyMessage = (await current(page)).messages.at(-1)!;
  await expect(page.locator(`#message-${bodyMessage.id}`)).toHaveClass(/highlight/);
  expect((await current(page)).snapshots.at(-1)!.analysis.quadrants.Body.support[0].quote).toBe(bodyAnswer);
  const beforeRefresh = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(beforeRefresh);
  await expect(page.locator('.answer-card').last()).toContainText(bodyAnswer);
});

test('editing an earlier answer preserves the old branch and isolates all later answers', async ({ page }) => {
  await answer(page, '我想每周保留研究与家人的时间。');
  await answer(page, '原心智回答：我会仔细核对推理。');
  await page.getByLabel('切换主题').selectOption('Body');
  await answer(page, '旧后续身体回答：每周散步三次。');
  const original = await current(page), originalBranch = original.branches[0];
  await page.locator('.exchange').nth(1).getByRole('button', { name: '修改 ↗' }).click();
  await page.getByLabel('修改后的回答').fill('修订心智回答：我也会主动寻找相反证据。');
  await page.getByRole('button', { name: '保存为新分支' }).click();
  const branched = await current(page), next = branched.branches.find((b) => b.id === branched.activeBranchId)!;
  expect(branched.branches).toHaveLength(2);
  expect(next.messageIds).toHaveLength(2);
  expect(next.parentId).toBe(originalBranch.id);
  expect(next.messageIds).not.toContain(original.messages[2].id);
  expect(branched.messages.find((m) => m.id === next.messageIds[1])?.revisionOf).toBe(original.messages[1].id);
  expect(branched.branches[0]).toEqual(originalBranch);
  await expect(page.locator('.transcript')).not.toContainText('旧后续身体回答');
  await reanalyze(page);
  expect((await current(page)).snapshots.at(-1)!.branchId).toBe(next.id);
  await page.locator('#branch-select').selectOption(originalBranch.id);
  expect((await current(page)).activeBranchId).toBe(originalBranch.id);
  await expect(page.locator('.transcript')).toContainText('旧后续身体回答');
  await page.locator('#branch-select').selectOption(next.id);
  await expect(page.locator('.transcript')).toContainText('修订心智回答');
  await expect(page.locator('.transcript')).not.toContainText('旧后续身体回答');
});

test('human revisions, rule versions, selected migration, plan edits, DOCX and JSON round trip preserve evidence', async ({ page }) => {
  await page.getByRole('button', { name: '◈ 打开虚构演示' }).click();
  const initial = await current(page);
  expect(initial.messages).toHaveLength(6);
  for (const [index, level, rationale] of [[0, 'L2', '心智用户修订保留原始模型'], [1, 'L1', '身体用户修订逐项选择']] as const) {
    await page.locator(`.quadrant.q${index}`).click();
    await page.getByRole('combobox', { name: '暂定层级', exact: true }).selectOption(level);
    await page.getByRole('textbox', { name: '依据说明', exact: true }).fill(rationale);
    await page.getByRole('dialog').getByRole('textbox', { name: '修订原因', exact: true }).fill(`因为需要补充真实经历${index}`);
    await page.getByRole('button', { name: '保存用户修订' }).click();
    expect((await current(page)).overrides).toHaveLength(index + 1);
  }
  const beforeRule = await saved(page);
  await page.getByRole('button', { name: /⚙ 评估规则/ }).click();
  await page.getByRole('textbox', { name: 'L1 行为倾向', exact: true }).first().fill('修订锚点：根据具体行为观察外部规则依赖。');
  await page.getByRole('textbox', { name: '修改说明', exact: true }).fill('加入观察条件');
  await page.getByRole('button', { name: '保存为新规则版本' }).click();
  expect((await saved(page)).rules).toHaveLength(beforeRule.rules.length + 1);
  expect((await current(page)).snapshots[0].ruleId).toBe(initial.snapshots[0].ruleId);
  await expect(page.locator('.insights > .stale')).toContainText('规则已改变');
  await reanalyze(page);
  const next = (await current(page)).snapshots.at(-1)!;
  expect(next.ruleId).toBe((await saved(page)).activeRuleId);
  expect((await current(page)).overrides.filter((o) => o.snapshotId === next.id)).toHaveLength(0);
  await page.getByRole('button', { name: '比较并选择保留' }).click();
  await page.getByRole('dialog').locator('input[name="Mind"]').check();
  await page.getByRole('button', { name: '将所选修订带入新评估' }).click();
  const migration = (await current(page)).overrides.at(-1)!;
  expect(migration.snapshotId).toBe(next.id); expect(migration.quadrants.Mind?.level).toBe('L2'); expect(migration.quadrants.Body).toBeUndefined();
  await page.getByRole('button', { name: '生成暂定报告 ↗' }).click();
  await page.getByRole('textbox', { name: '一项主目标', exact: true }).fill('七天内优先建立温和的恢复节奏');
  await page.getByRole('textbox', { name: '当前优先级修订', exact: true }).fill('');
  await page.getByRole('textbox', { name: '报告补充与更正', exact: true }).fill('我的补充：环境限制仍需记录。');
  await page.getByRole('dialog').getByRole('textbox', { name: '修订原因', exact: true }).fill('只修改计划，优先级保持原记录');
  await page.getByRole('button', { name: '保存报告修订' }).click();
  const reportRevision = (await current(page)).overrides.at(-1)!;
  expect(reportRevision.plan?.goal).toBe('七天内优先建立温和的恢复节奏'); expect(reportRevision.priority).toBeUndefined();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出可编辑 DOCX ↓' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const docx = await readFile((await download.path())!);
  const xml = unzipXml(docx);
  for (const content of ['七天内优先建立温和的恢复节奏', '心智用户修订保留原始模型', '我的补充：环境限制仍需记录。', next.ruleId, initial.messages[1].text]) expect(xml).toContain(content);
  await closeDialog(page);
  const backupEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const backup = await backupEvent, backupBytes = await readFile((await backup.path())!);
  const backupStore = JSON.parse(backupBytes.toString()); expect(backupStore).toEqual(await saved(page));
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('alert')).toContainText('导入被拒绝'); expect(await saved(page)).toEqual(backupStore);
  await page.getByRole('button', { name: '＋ 开始新访谈' }).click();
  expect((await saved(page)).sessions).toHaveLength(backupStore.sessions.length + 1);
  await page.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBytes });
  await page.getByRole('button', { name: '确认导入' }).click();
  expect(await saved(page)).toEqual(backupStore);
  await page.reload(); expect(await saved(page)).toEqual(backupStore);
  await expect(page.locator('.quadrant.q0')).toContainText('L2 · 暂定');
});

test('mobile navigation, pause and skipped answers remain recoverable after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await activeBranch(page)).paused).toBe(true);
  await expect(page.getByLabel('你的回答', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeDisabled();
  await page.reload(); expect((await activeBranch(page)).paused).toBe(true);
  await page.getByRole('button', { name: '继续访谈', exact: true }).click();
  expect((await activeBranch(page)).paused).toBe(false);
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  const session = await current(page); expect(session.messages).toHaveLength(1); expect(session.messages[0].skipped).toBe(true); expect(session.snapshots).toHaveLength(0);
  expect((await activeBranch(page)).nextTopic).toBe('Mind');
  await page.getByRole('navigation', { name: '工作台标签' }).getByRole('button', { name: '四象限', exact: true }).click();
  await expect(page.locator('.quadrant.q0')).toBeVisible();
  await page.getByRole('navigation', { name: '工作台标签' }).getByRole('button', { name: '会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('navigation', { name: '工作台标签' }).getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.locator('.transcript')).toContainText('本轮不作为评价依据');
});

test('duplicate clicks cannot duplicate answers and a delayed response cannot contaminate a new session', async ({ page }) => {
  let release: () => void = () => {}, started: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  await page.route('**/api/analyze', async (route) => {
    calls++;
    const response = await route.fetch();
    started(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel('你的回答', { exact: true }).fill('这个回答只属于第一个会话。');
  await page.getByRole('button', { name: '发送回答 ↑' }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await requestStarted;
  const first = await current(page); expect(first.messages).toHaveLength(1); expect(first.snapshots).toHaveLength(0); expect(calls).toBe(1);
  await page.getByRole('button', { name: '＋ 开始新访谈' }).click();
  const second = await current(page); expect(second.id).not.toBe(first.id); expect(second.messages).toHaveLength(0);
  release();
  await expect.poll(async () => await page.locator('.current-question h2').innerText()).toContain('三年后');
  await page.waitForTimeout(150);
  const store = await saved(page);
  expect(store.sessions.find((s) => s.id === first.id)?.snapshots).toHaveLength(0);
  expect(store.sessions.find((s) => s.id === second.id)?.snapshots).toHaveLength(0);
  expect((await current(page)).id).toBe(second.id);
});

test('failed model request retains one answer and offers only one explicit retry', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/analyze', async (route) => { requests++; await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'MODEL_NETWORK', message: '模拟网络中断，请手动重试。' }) }); });
  await page.getByLabel('你的回答', { exact: true }).fill('发生网络故障也应保留这条回答。');
  await page.getByRole('button', { name: '发送回答 ↑' }).click();
  await expect(page.getByRole('alert')).toContainText('模拟网络中断');
  expect((await current(page)).messages).toHaveLength(1); expect((await current(page)).snapshots).toHaveLength(0); expect(requests).toBe(1);
  await page.getByRole('button', { name: '重试一次', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('模拟网络中断');
  await expect(page.getByRole('button', { name: '重试一次', exact: true })).toHaveCount(0);
  expect(requests).toBe(2); expect((await current(page)).messages).toHaveLength(1);
});

test('a corrupted local record stays protected until a valid backup is imported and editing resumes', async ({ page }) => {
  await answer(page, '恢复前的有效记录：每天想留一点自主时间。');
  const original = await saved(page), corrupted = '{damaged local record';
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: corrupted });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('本地记录无法读取');
  await expect(page.getByLabel('你的回答', { exact: true })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(corrupted);
  await page.locator('input[type="file"]').setInputFiles({ name: 'valid-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await page.getByRole('button', { name: '确认导入' }).click();
  expect(await saved(page)).toEqual(original);
  await expect(page.getByLabel('你的回答', { exact: true })).toBeEnabled();
  await answer(page, '恢复后继续回答：我会查阅原始记录再调整判断。');
  expect((await current(page)).messages).toHaveLength(2);
  expect((await current(page)).messages[0].text).toBe(original.sessions[0].messages[0].text);
});

test('storage quota failure preserves old saved data and offers the new in-memory answers in JSON export', async ({ page }) => {
  await answer(page, '已保存的第一条回答。');
  const original = await saved(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.getByLabel('你的回答', { exact: true }).fill('磁盘已满时仍保留在当前页面的新回答。');
  await page.getByRole('button', { name: '发送回答 ↑' }).click();
  await expect(page.getByRole('button', { name: '发送回答 ↑', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('自动保存失败');
  await expect(page.locator('.answer-card').last()).toContainText('磁盘已满时仍保留在当前页面的新回答。');
  expect(await saved(page)).toEqual(original);
  await expect(page.locator('.save-state')).toContainText('尚未保存');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const backup = await event, data = JSON.parse(await readFile((await backup.path())!, 'utf8')) as Store;
  const active = data.sessions.find((s) => s.id === data.activeSessionId)!;
  expect(active.messages).toHaveLength(2);
  expect(active.messages[1].text).toBe('磁盘已满时仍保留在当前页面的新回答。');
  expect(await saved(page)).toEqual(original);
});

