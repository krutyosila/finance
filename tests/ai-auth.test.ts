import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { AuthService, hashPassword, SESSION_COOKIE, type PasswordHash } from '../server/auth';
import { FinanceService } from '../server/core/service';
import { AiSettingsService } from '../server/ai/settings';
import type { AiInterpreter } from '../server/ai/client';
import { createApp } from '../server/app';

const ORIGIN = 'https://finance.example.com';
const PASSWORD = 'ai-auth-test-only-old-password';
const TOKEN = 'r'.repeat(43);
let passwordHash: PasswordHash;
const fixtures: { finance: FinanceService; auth: AuthService; root: string }[] = [];
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
afterEach(() => {
  for (const { finance, auth, root } of fixtures.splice(0)) {
    finance.close();
    auth.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'finance-ai-auth-'));
  const finance = new FinanceService(':memory:');
  const auth = new AuthService(':memory:');
  fixtures.push({ finance, auth, root });
  const time = Date.now();
  auth.sqlite
    .prepare(
      'INSERT INTO administrator(id,email,password_salt,password_hash,created_at,updated_at) VALUES(1,?,?,?,?,?)',
    )
    .run('ai-review@example.com', passwordHash.salt, passwordHash.hash, time, time);
  auth.sqlite
    .prepare(
      'INSERT INTO sessions(token_hash,administrator_id,created_at,expires_at) VALUES(?,1,?,?)',
    )
    .run(createHash('sha256').update(TOKEN).digest('hex'), time, time + 600000);
  let release!: () => void;
  let announce!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const interpreter: AiInterpreter = {
    interpret: async (text) => {
      announce();
      await gate;
      return {
        text,
        certain: true,
        issues: [],
        draft: { type: 'EXPENSE', amount: '450', currency: 'TRY', description: 'AI test kaydı' },
      };
    },
    classifyLabels: async (input) => {
      announce();
      await gate;
      return input.transactions.map((transaction) => ({
        transactionId: transaction.id,
        labelId: input.labels[0].id,
      }));
    },
  };
  const app = createApp(finance, {
    publicUrl: ORIGIN,
    auth,
    aiInterpreter: interpreter,
    aiSettings: new AiSettingsService({
      path: join(root, 'ai.json'),
      databasePath: join(root, 'finance.sqlite'),
    }),
  });
  return { finance, auth, app, release, entered };
}

// Express middleware is exercised without opening a listening socket.
function post(app: Express, path: string, body: unknown) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  const req = new IncomingMessage(socket);
  req.method = 'POST';
  req.url = path;
  req.headers = {
    host: 'finance.example.com',
    origin: ORIGIN,
    'x-forwarded-proto': 'https',
    cookie: `${SESSION_COOKIE}=${TOKEN}`,
  };
  Object.assign(req, { body });
  const res = new ServerResponse(req);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    res.end = ((chunk: unknown) => {
      resolve({ status: res.statusCode, body: JSON.parse(String(chunk)) });
      socket.destroy();
      return res;
    }) as typeof res.end;
    app(req, res);
  });
}

function expectNoFinancialWrites(finance: FinanceService) {
  expect(finance.listTransactions()).toHaveLength(0);
  expect(finance.listAudit()).toHaveLength(0);
  expect(finance.sqlite.prepare('SELECT COUNT(*) AS count FROM ai_entry_receipts').get()).toEqual({
    count: 0,
  });
}

function stableSnapshot(finance: FinanceService) {
  const { exportedAt: _exportedAt, context, ...stored } = finance.snapshot();
  const { generatedAt: _generatedAt, ...computed } = context;
  return { ...stored, context: computed };
}

describe('AI beklerken oturum iptali', () => {
  it('etiket taraması önizlemesini kayıt değiştirmeden döndürür', async () => {
    const { app, finance, entered, release } = fixture();
    const label = finance.createLabel({ name: 'Market' });
    const transaction = finance.createTransaction({
      type: 'EXPENSE',
      amount: '12',
      currency: 'TRY',
      description: 'Market alışverişi',
    });
    const before = stableSnapshot(finance);
    const pending = post(app, '/api/ai/labels/scan', {
      transactions: [
        {
          transactionId: transaction.id,
          transactionUpdatedAt: transaction.updatedAt,
          previousLabelId: null,
        },
      ],
    });
    await entered;
    release();
    expect(await pending).toMatchObject({
      status: 200,
      body: {
        suggestions: [
          {
            transactionId: transaction.id,
            labelId: label.id,
            previousLabelId: null,
            transactionUpdatedAt: transaction.updatedAt,
          },
        ],
      },
    });
    expect(stableSnapshot(finance)).toEqual(before);
  });

  it('çıkıştan sonra bekleyen etiket taraması önizlemesini döndürmez', async () => {
    const { app, auth, finance, entered, release } = fixture();
    finance.createLabel({ name: 'Market' });
    const transaction = finance.createTransaction({
      type: 'EXPENSE',
      amount: '12',
      currency: 'TRY',
      description: 'Market alışverişi',
    });
    const before = stableSnapshot(finance);
    const pending = post(app, '/api/ai/labels/scan', {
      transactions: [
        {
          transactionId: transaction.id,
          transactionUpdatedAt: transaction.updatedAt,
          previousLabelId: null,
        },
      ],
    });
    await entered;
    auth.logout(TOKEN);
    release();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('suggestions');
    expect(stableSnapshot(finance)).toEqual(before);
  });
  it('geçerli oturumla tamamlanan açık AI işlemini kaydeder', async () => {
    const { app, finance, entered, release } = fixture();
    const pending = post(app, '/api/ai/transaction', {
      text: '450 market',
      requestId: 'valid-ai-auth-id',
    });
    await entered;
    release();
    expect(await pending).toMatchObject({ status: 201, body: { saved: true } });
    expect(finance.listTransactions()).toHaveLength(1);
  });

  it('çıkıştan sonra bekleyen AI isteğinin işlem, audit veya receipt yazmasını reddeder', async () => {
    const { app, auth, finance, entered, release } = fixture();
    const pending = post(app, '/api/ai/transaction', {
      text: '450 market',
      requestId: 'logout-ai-auth-id',
    });
    await entered;
    expect((await post(app, '/api/auth/logout', {})).status).toBe(200);
    expect(auth.session(TOKEN)).toBeNull();
    release();
    expect(await pending).toMatchObject({ status: 401 });
    expectNoFinancialWrites(finance);
  });

  it('çıkıştan sonra bekleyen AI önizlemesinin özel taslağını döndürmez', async () => {
    const { app, auth, finance, entered, release } = fixture();
    const pending = post(app, '/api/parse', { text: '450 market' });
    await entered;
    auth.logout(TOKEN);
    release();
    const result = await pending;
    expect(result.status).toBe(401);
    expect(result.body).not.toHaveProperty('draft');
    expectNoFinancialWrites(finance);
  });

  it('parola değişimi oturumları iptal ettikten sonra bekleyen AI kaydını reddeder', async () => {
    const { app, auth, finance, entered, release } = fixture();
    const pending = post(app, '/api/ai/transaction', {
      text: '450 market',
      requestId: 'password-ai-auth-id',
    });
    await entered;
    const changed = await post(app, '/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'ai-auth-test-only-new-password',
    });
    expect(changed).toMatchObject({ status: 200, body: { changed: true } });
    expect(auth.session(TOKEN)).toBeNull();
    release();
    expect(await pending).toMatchObject({ status: 401 });
    expectNoFinancialWrites(finance);
  });
});
