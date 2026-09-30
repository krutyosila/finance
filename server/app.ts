import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FinanceService } from './core/service';
import type { TransactionFilter } from '../shared/types';
import { backupDatabase, exportFinancialState } from './maintenance';
import { AuthService, AuthError, parsePublicURL, SESSION_COOKIE, sessionCookie } from './auth';
import { AiSettingsService } from './ai/settings';
import { AiError } from './ai/errors';
import { OpenAiInterpreter, type AiInterpreter } from './ai/client';
import { AiEntryService } from './ai/entry';
import { AiPlanService } from './ai/plan';
import { registerSettingsRoutes } from './settings-routes';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const localPorts = new Set(['4317', '5173']);
if (process.env.FINANCE_PORT && /^\d+$/.test(process.env.FINANCE_PORT))
  localPorts.add(String(Number(process.env.FINANCE_PORT)));
function localURL(value: string, origin: boolean): boolean {
  try {
    const url = new URL(origin ? value : `http://${value}`);
    return (
      url.protocol === 'http:' &&
      localHosts.has(url.hostname) &&
      localPorts.has(url.port) &&
      !url.username &&
      !url.password &&
      (origin ? url.pathname === '/' && !url.search && !url.hash : true)
    );
  } catch {
    return false;
  }
}

function queryText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function period(req: Request) {
  return {
    from: queryText(req.query.from),
    to: queryText(req.query.to),
    cycleId: queryText(req.query.cycleId),
    all: req.query.all === 'true',
  };
}
function body(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    throw new Error('JSON nesnesi gönderilmelidir.');
  return req.body;
}

export interface AppOptions {
  publicUrl?: string | null;
  auth?: AuthService;
  authDatabasePath?: string;
  aiSettings?: AiSettingsService;
  aiInterpreter?: AiInterpreter;
}
export function createApp(service: FinanceService, options: AppOptions = {}) {
  const app = express(),
    publicURL = parsePublicURL(
      options.publicUrl === undefined ? process.env.FINANCE_PUBLIC_URL : options.publicUrl,
    );
  const authPath =
    options.auth?.databasePath ??
    options.authDatabasePath ??
    process.env.FINANCE_AUTH_DB ??
    resolve(dirname(fileURLToPath(import.meta.url)), '../data/auth.sqlite');
  if (publicURL && service.databasePath !== ':memory:' && authPath !== ':memory:') {
    const canonical = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path)),
      sameInode =
        existsSync(service.databasePath) &&
        existsSync(authPath) &&
        statSync(service.databasePath).dev === statSync(authPath).dev &&
        statSync(service.databasePath).ino === statSync(authPath).ino;
    if (canonical(service.databasePath) === canonical(authPath) || sameInode)
      throw new Error('Kimlik ve finans veritabanları ayrı dosyalarda tutulmalıdır.');
  }
  const auth = publicURL ? (options.auth ?? new AuthService(authPath)) : null;
  const aiSettings =
    options.aiSettings ??
    new AiSettingsService({
      databasePath: service.databasePath === ':memory:' ? undefined : service.databasePath,
    });
  const interpreter = options.aiInterpreter ?? new OpenAiInterpreter(aiSettings);
  const ai = new AiEntryService(service, interpreter);
  const plans = new AiPlanService(service, interpreter);
  const authorizeAi = (req: Request) => {
    if (auth && !auth.session(sessionCookie(req.headers.cookie)))
      throw new AuthError('Oturumunuz sona erdi. Devam etmek için tekrar giriş yapın.', 401);
  };
  app.locals.authService = auth;
  app.locals.authOwned = !!auth && !options.auth;
  app.disable('x-powered-by');
  if (publicURL) app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (/^\/api(?:\/|$)/i.test(req.path)) res.setHeader('Cache-Control', 'no-store');
    if (publicURL) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
      );
      if ((req.headers.host ?? '').toLowerCase() !== publicURL.host.toLowerCase()) {
        res.status(403).json({ error: 'Bu alan adından gelen isteklere izin verilmez.' });
        return;
      }
      if (!req.secure || req.headers['x-forwarded-proto'] !== 'https') {
        res.status(403).json({ error: 'Sunucu modunda yalnızca HTTPS bağlantısına izin verilir.' });
        return;
      }
      const origin = req.headers.origin;
      if (
        (origin && origin !== publicURL.origin) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        res.status(403).json({ error: 'Başka web sitelerinden gelen isteklere izin verilmez.' });
        return;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin !== publicURL.origin) {
        res.status(403).json({ error: 'İşlem isteği uygulamanın kendi adresinden gelmelidir.' });
        return;
      }
    } else {
      if (!localURL(req.headers.host ?? '', false)) {
        res.status(403).json({ error: 'Yalnızca bu bilgisayardan gelen isteklere izin verilir.' });
        return;
      }
      const origin = req.headers.origin;
      if ((origin && !localURL(origin, true)) || req.headers['sec-fetch-site'] === 'cross-site') {
        res.status(403).json({ error: 'Uzak web sitelerinden gelen isteklere izin verilmez.' });
        return;
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', local: !publicURL }));
  app.get('/api/auth/session', (req, res) => {
    if (auth) auth.checkSessionRate(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    const user = auth?.session(sessionCookie(req.headers.cookie)) ?? null;
    res.json({ required: !!auth, authenticated: !!user, user });
  });
  app.post('/api/auth/login', async (req, res) => {
    if (!auth) {
      res.json({ required: false, authenticated: false, user: null });
      return;
    }
    const input = body(req);
    if (typeof input.email !== 'string' || typeof input.password !== 'string')
      throw new AuthError('E-posta ve parola alanlarını kontrol edin.', 400);
    const session = await auth.login(
      input.email,
      input.password,
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      sessionCookie(req.headers.cookie),
    );
    res.cookie(SESSION_COOKIE, session.token, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: auth.sessionTtlMs,
      expires: new Date(session.expiresAt),
    });
    res.json({ required: true, authenticated: true, user: session.user });
  });
  app.post('/api/auth/logout', (req, res) => {
    auth?.logout(sessionCookie(req.headers.cookie));
    res.clearCookie(SESSION_COOKIE, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    res.json({ required: !!auth, authenticated: false, user: null });
  });
  app.use('/api', (req, res, next) => {
    if (auth) {
      auth.checkSessionRate(req.ip ?? req.socket.remoteAddress ?? 'unknown');
      const user = auth.session(sessionCookie(req.headers.cookie));
      if (!user) {
        res.status(401).json({ error: 'Devam etmek için giriş yapın.' });
        return;
      }
      res.locals.user = user;
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.get(['/api/context', '/api/ai/context', '/api/reports'], (req, res) =>
    res.json(service.getContext(period(req))),
  );
  registerSettingsRoutes(app, auth, aiSettings);
  app.get('/api/transactions', (req, res) => {
    const filter: TransactionFilter = {};
    for (const key of [
      'search',
      'type',
      'currency',
      'category',
      'accountId',
      'from',
      'to',
      'scope',
    ] as const) {
      const value = queryText(req.query[key]);
      if (value !== undefined) filter[key] = value;
    }
    if (req.query.deleted === 'true') filter.deleted = true;
    res.json(service.listTransactions(filter));
  });
  app.get('/api/transactions/:id', (req, res) => res.json(service.getTransaction(req.params.id)));
  app.post('/api/transactions', (req, res) =>
    res.status(201).json(service.createTransaction(body(req) as never)),
  );
  app.patch('/api/transactions/:id', (req, res) =>
    res.json(service.updateTransaction(req.params.id, body(req))),
  );
  app.delete('/api/transactions/:id', (req, res) => {
    service.deleteTransaction(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });
  app.post('/api/transactions/:id/restore', (req, res) =>
    res.json(service.restoreTransaction(req.params.id)),
  );
  app.post('/api/transactions/:id/duplicate', (req, res) =>
    res.status(201).json(service.duplicateTransaction(req.params.id)),
  );
  app.post('/api/parse', async (req, res) => {
    const input = body(req);
    if (typeof input.text !== 'string') throw new Error('text alanı metin olmalıdır.');
    const result = await ai.interpret(input.text);
    authorizeAi(req);
    res.json(result);
  });
  app.post('/api/ai/transaction', async (req, res) => {
    const input = body(req);
    if (typeof input.text !== 'string') throw new Error('text alanı metin olmalıdır.');
    const result = await ai.addText(input.text, input.requestId, () => authorizeAi(req));
    authorizeAi(req);
    res.status(result.saved ? 201 : 200).json(result);
  });
  app.post('/api/ai/entry', async (req, res) => {
    const result = await plans.preview(body(req).text);
    authorizeAi(req);
    res.json(result);
  });
  app.post('/api/ai/entry/confirm', (req, res) => {
    const input = body(req);
    const result = plans.confirm(input.plan, input.requestId, () => authorizeAi(req));
    res.status(result.saved ? 201 : 200).json(result);
  });

  app.get('/api/accounts', (_req, res) => res.json(service.listAccounts()));
  app.post('/api/accounts', (req, res) =>
    res.status(201).json(service.createAccount(body(req) as never)),
  );
  app.patch('/api/accounts/:id', (req, res) =>
    res.json(service.updateAccount(req.params.id, body(req))),
  );
  app.delete('/api/accounts/:id', (req, res) => {
    service.deleteAccount(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });
  app.get('/api/debts', (_req, res) => res.json(service.listDebts()));
  app.post('/api/debts', (req, res) =>
    res.status(201).json(service.createDebt(body(req) as never)),
  );
  app.patch('/api/debts/:id', (req, res) => res.json(service.updateDebt(req.params.id, body(req))));
  app.delete('/api/debts/:id', (req, res) => {
    service.deleteDebt(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });
  app.get('/api/recurring', (_req, res) => res.json(service.listObligations()));
  app.post('/api/recurring', (req, res) =>
    res.status(201).json(service.createObligation(body(req) as never)),
  );
  app.patch('/api/recurring/:id', (req, res) =>
    res.json(service.updateObligation(req.params.id, body(req))),
  );
  app.delete('/api/recurring/:id', (req, res) => {
    service.deleteObligation(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });
  app.post('/api/recurring/:id/pay', (req, res) =>
    res.status(201).json(service.payObligation(req.params.id, body(req) as never)),
  );
  app.get('/api/subscriptions', (_req, res) => res.json(service.listSubscriptions()));
  app.post('/api/subscriptions', (req, res) =>
    res.status(201).json(service.createSubscription(body(req) as never)),
  );
  app.patch('/api/subscriptions/:id', (req, res) =>
    res.json(service.updateSubscription(req.params.id, body(req))),
  );
  app.delete('/api/subscriptions/:id', (req, res) => {
    service.deleteSubscription(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  });
  app.post('/api/subscriptions/:id/pay', (req, res) =>
    res.status(201).json(service.paySubscription(req.params.id, body(req) as never)),
  );
  app.get('/api/cycles', (_req, res) => res.json(service.listCycles()));
  app.post('/api/cycles', (req, res) => res.status(201).json(service.startCycle(body(req))));
  app.post('/api/cycles/:id/end', (req, res) => {
    const input = body(req);
    if (input.end !== undefined && typeof input.end !== 'string')
      throw new Error('end alanı ISO tarih veya zaman damgası olmalıdır.');
    res.json(service.endCycle(req.params.id, input.end));
  });
  app.get('/api/audit', (req, res) => res.json(service.listAudit(queryText(req.query.entityId))));
  app.post('/api/backup', async (_req, res) =>
    res.status(201).json({ path: await backupDatabase(service) }),
  );
  app.post('/api/export', async (_req, res) =>
    res.status(201).json(await exportFinancialState(service)),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API yolu bulunamadı.' }));
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const raw = error instanceof Error ? error.message : 'İstek tamamlanamadı.';
    const message =
      error instanceof Error && error.name === 'ZodError'
        ? 'Alanları kontrol edin: zorunlu alan, tür veya değer geçersiz.'
        : error instanceof SyntaxError
          ? 'JSON isteği okunamadı.'
          : raw;
    if (error instanceof AuthError && error.retryAfter)
      res.setHeader('Retry-After', String(error.retryAfter));
    const status =
      error instanceof AuthError || error instanceof AiError
        ? error.statusCode
        : /not found|does not exist|bulunamadı|mevcut değil/i.test(message)
          ? 404
          : /running|active API|Stop the|çalışıyor|uygulamayı durdur/i.test(message)
            ? 409
            : 400;
    res.status(status).json({ error: message });
  });
  return app;
}
