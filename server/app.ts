import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { bindingSchema, messageSchema, ruleSchema, snapshotSchema, overrideSchema, validateSession, snapshotMessages, validateAnalysis } from '../src/domain.ts';
import { analyzeMessages, readModelConfig, ServiceError, type ModelConfig } from './model.ts';
import { buildReport } from './report.ts';

const analysisRequest = z.object({ binding: bindingSchema, messages: z.array(messageSchema).max(200), rules: ruleSchema }).strict();
const reportRequest = z.object({ session: z.unknown(), snapshot: snapshotSchema, override: overrideSchema.optional(), rules: ruleSchema }).strict();
type Cached = { signature: string; status: number; body: unknown; expiresAt: number };
export interface AppOptions { config?: ModelConfig; fetchImpl?: typeof fetch; timeoutMs?: number; cacheLimit?: number }

export function createApp(options: AppOptions = {}) {
  const app = express();
  const config = options.config ?? readModelConfig();
  const mode = config.apiKey ? 'live' : 'demo';
  const model = mode === 'demo' ? '本地演示规则' : config.model;
  const cache = new Map<string, Cached>();
  const pendingIds = new Set<string>();
  const activeSessions = new Set<string>();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host;
    let hostUrl: URL;
    try { hostUrl = new URL(`http://${host}`); } catch { return res.status(403).json({ error: 'LOCAL_ONLY', message: '此工具仅允许本机访问。' }); }
    if (!host || !['127.0.0.1', 'localhost'].includes(hostUrl.hostname) || hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash || Number(hostUrl.port || 80) !== req.socket.localPort) {
      return res.status(403).json({ error: 'LOCAL_ONLY', message: '此工具仅允许本机访问。' });
    }
    if ((req.headers.origin && req.headers.origin !== hostUrl.origin) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'ORIGIN_REJECTED', message: '已拒绝来自其它网站的请求。' });
    next();
  });
  app.use('/api', express.json({ limit: '2mb', strict: true }));
  app.get('/api/health', (_req, res) => res.json({ mode, model }));

  app.post('/api/analyze', async (req, res) => {
    const parsed = analysisRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', message: '访谈输入格式有误，请检查备份或重新加载会话。' });
    const { binding, messages, rules } = parsed.data;
    if (binding.ruleId !== rules.id || binding.inputVersion !== messages.length || new Set(messages.map((m) => m.id)).size !== messages.length) return res.status(400).json({ error: 'INVALID_BINDING', message: '分析版本与输入不一致。' });
    const requestId = req.header('X-Request-ID') || randomUUID();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return res.status(400).json({ error: 'INVALID_REQUEST_ID', message: '请求编号无效。' });
    const signature = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    for (const [id, item] of cache) if (item.expiresAt < Date.now()) cache.delete(id);
    const cached = cache.get(requestId);
    if (cached) {
      if (cached.signature !== signature) return res.status(409).json({ error: 'REQUEST_ID_REUSED', message: '请求编号已用于不同输入。' });
      return res.status(cached.status).json(cached.body);
    }
    if (pendingIds.has(requestId) || activeSessions.has(binding.sessionId)) return res.status(409).json({ error: 'IN_PROGRESS', message: '这场访谈仍有分析进行中，请先等待或取消。' });
    if (activeSessions.size >= 4) return res.status(429).json({ error: 'BUSY', message: '正在处理其它分析，请稍后手动重试。' });
    activeSessions.add(binding.sessionId);
    pendingIds.add(requestId);
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? 30_000;
    let timeout: ReturnType<typeof setTimeout>;
    const cancellation = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new ServiceError(timedOut ? 504 : 408, timedOut ? 'TIMEOUT' : 'CANCELLED', timedOut ? '分析超过30秒，已取消请求。请手动重试。' : '分析已取消。')), { once: true });
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    });
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    const respond = (status: number, body: unknown) => {
      cache.set(requestId, { signature, status, body, expiresAt: Date.now() + 5 * 60_000 });
      const limit = options.cacheLimit ?? 100;
      while (cache.size > limit) cache.delete(cache.keys().next().value!);
      if (!res.destroyed) res.status(status).json(body);
    };
    try {
      const analysis = await Promise.race([analyzeMessages(messages, rules, config, controller.signal, options.fetchImpl), cancellation]);
      respond(200, { binding, analysis, model, mode });
    } catch (error) {
      const safe = error instanceof ServiceError ? error : new ServiceError(500, 'ANALYSIS_FAILED', '分析暂时失败，本地访谈记录仍然保留。');
      respond(safe.status, { error: safe.code, message: safe.message });
    } finally {
      clearTimeout(timeout!);
      res.off('close', onClose);
      activeSessions.delete(binding.sessionId);
      pendingIds.delete(requestId);
    }
  });

  app.post('/api/report', async (req, res) => {
    try {
      const parsed = reportRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'INVALID_REPORT', message: '报告数据不完整或格式有误。' });
      const { snapshot, override, rules } = parsed.data;
      const session = validateSession(parsed.data.session);
      const canonicalSnapshot = session.snapshots.find((item) => item.id === snapshot.id);
      if (!canonicalSnapshot || JSON.stringify(canonicalSnapshot) !== JSON.stringify(snapshot) || snapshot.ruleId !== rules.id) throw new Error('Snapshot binding mismatch');
      if (override && !session.overrides.some((item) => item.id === override.id && item.snapshotId === snapshot.id && JSON.stringify(item) === JSON.stringify(override))) throw new Error('Override binding mismatch');
      const messages = snapshotMessages(session, snapshot);
      validateAnalysis({ ...snapshot.analysis, quadrants: { ...snapshot.analysis.quadrants, ...override?.quadrants }, plan: override?.plan ?? snapshot.analysis.plan }, messages);
      const data = await buildReport(session, snapshot, override, rules);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="human-3-report.docx"; filename*=UTF-8''${encodeURIComponent('Human 3.0 成长报告.docx')}`);
      return res.send(data);
    } catch {
      return res.status(400).json({ error: 'INVALID_REPORT', message: '报告生成失败：请确认会话、规则版本、修订和证据引用完整且一致。' });
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '未找到此接口。' }));
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: 'index.html', dotfiles: 'deny', fallthrough: true }));
    app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
  } else app.get('/', (_req, res) => res.status(503).type('text').send('请先运行 npm run build，再启动工作台。'));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const large = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    res.status(large ? 413 : 400).json({ error: large ? 'BODY_TOO_LARGE' : 'BAD_REQUEST', message: large ? '请求内容过大，请缩小会话或备份。' : '请求格式有误。' });
  });
  return app;
}
