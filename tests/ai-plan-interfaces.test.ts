import { afterEach, describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { FinanceService } from '../server/core/service';
import { AiSettingsService } from '../server/ai/settings';
import { AuthService, SESSION_COOKIE } from '../server/auth';
import { createApp } from '../server/app';
import { runCli } from '../server/cli';
import type { AiInterpreter } from '../server/ai/client';
import type { AiPlan } from '../shared/types';

const ORIGIN = 'https://finance.example.com';
const TOKEN = 'u'.repeat(43);
const fixtures: { finance: FinanceService; auth: AuthService; root: string }[] = [];
function plan(text = 'Hesap ve abonelik ekle'): AiPlan {
  return {
    text,
    certain: true,
    issues: [],
    items: [
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'Garanti', type: 'BANK', currency: 'TRY', openingBalance: '25000' },
      },
      {
        key: 'netflix',
        kind: 'subscription',
        data: {
          service: 'Netflix',
          amount: '300',
          currency: 'TRY',
          frequency: 'MONTHLY',
          nextRenewal: '2026-10-15',
          accountId: '@bank',
        },
      },
    ],
  };
}
const model: AiInterpreter = {
  interpret: async (text) => ({ text, certain: false, issues: ['Legacy unused'], draft: {} }),
  interpretPlan: async (text) => plan(text),
};
function fixture(hosted = false, interpreter = model) {
  const root = mkdtempSync(join(tmpdir(), 'finance-plan-interfaces-'));
  const finance = new FinanceService(':memory:');
  const auth = new AuthService(':memory:');
  fixtures.push({ finance, auth, root });
  const now = Date.now();
  auth.sqlite
    .prepare(
      'INSERT INTO administrator(id,email,password_salt,password_hash,created_at,updated_at) VALUES(1,?,?,?,?,?)',
    )
    .run('plan-fixture@example.com', 'f'.repeat(64), 'a'.repeat(128), now, now);
  auth.sqlite
    .prepare(
      'INSERT INTO sessions(token_hash,administrator_id,created_at,expires_at) VALUES(?,1,?,?)',
    )
    .run(createHash('sha256').update(TOKEN).digest('hex'), now, now + 600000);
  const app = createApp(finance, {
    publicUrl: hosted ? ORIGIN : null,
    auth: hosted ? auth : undefined,
    aiInterpreter: interpreter,
    aiSettings: new AiSettingsService({ path: join(root, 'ai.json') }),
  });
  return { finance, auth, app };
}
function post(app: Express, path: string, body: unknown, hosted = false, cookie = true) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  const req = new IncomingMessage(socket);
  req.method = 'POST';
  req.url = path;
  req.headers = hosted
    ? {
        host: 'finance.example.com',
        origin: ORIGIN,
        'x-forwarded-proto': 'https',
        ...(cookie ? { cookie: `${SESSION_COOKIE}=${TOKEN}` } : {}),
      }
    : { host: 'localhost:4317', origin: 'http://localhost:4317' };
  Object.assign(req, { body });
  const res = new ServerResponse(req);
  return new Promise<{ status: number; body: any; cache: unknown }>((resolve) => {
    res.end = ((chunk: unknown) => {
      resolve({
        status: res.statusCode,
        body: JSON.parse(String(chunk)),
        cache: res.getHeader('Cache-Control'),
      });
      socket.destroy();
      return res;
    }) as typeof res.end;
    app(req, res);
  });
}
afterEach(() =>
  fixtures.splice(0).forEach(({ finance, auth, root }) => {
    finance.close();
    auth.close();
    rmSync(root, { recursive: true, force: true });
  }),
);
describe('universal AI preview and confirmation interfaces', () => {
  it('previews without writes, confirms linked records and returns the same result on retry', async () => {
    const { finance, app } = fixture();
    const preview = await post(app, '/api/ai/entry', { text: 'Hesap ve abonelik ekle' });
    expect(preview.status).toBe(200);
    expect(preview.cache).toBe('no-store');
    expect(preview.body.items).toHaveLength(2);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(0);
    const body = { plan: preview.body, requestId: 'confirm-plan-interface' };
    const saved = await post(app, '/api/ai/entry/confirm', body);
    expect(saved).toMatchObject({ status: 201, body: { saved: true } });
    expect((await post(app, '/api/ai/entry/confirm', body)).body).toEqual(saved.body);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(finance.listSubscriptions()[0].accountId).toBe(finance.listAccounts()[0].id);
    const changed = plan();
    changed.items[0].data = { ...changed.items[0].data, name: 'Changed' };
    expect(
      (await post(app, '/api/ai/entry/confirm', { plan: changed, requestId: body.requestId }))
        .status,
    ).toBe(409);
  });
  it('returns incomplete confirmation without any financial writes', async () => {
    const { finance, app } = fixture();
    const incomplete = plan();
    incomplete.items[0] = {
      key: 'bank',
      kind: 'account',
      data: { name: 'Garanti', type: 'BANK', currency: 'TRY' },
    };
    const result = await post(app, '/api/ai/entry/confirm', {
      plan: incomplete,
      requestId: 'incomplete-interface',
    });
    expect(result).toMatchObject({ status: 200, body: { saved: false } });
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listSubscriptions()).toHaveLength(0);
  });
  it('requires a hosted session for both new endpoints', async () => {
    const { app } = fixture(true);
    for (const path of ['/api/ai/entry', '/api/ai/entry/confirm'])
      expect(
        (
          await post(
            app,
            path,
            { text: 'Hesap ekle', plan: plan(), requestId: 'no-session-interface' },
            true,
            false,
          )
        ).status,
      ).toBe(401);
  });
  it('withholds a private plan when the hosted session expires while AI is interpreting', async () => {
    let release!: () => void, announce!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const { app, auth, finance } = fixture(true, {
      ...model,
      interpretPlan: async (text) => {
        announce();
        await gate;
        return plan(text);
      },
    });
    const pending = post(app, '/api/ai/entry', { text: 'Hesap ve abonelik ekle' }, true);
    await entered;
    auth.logout(TOKEN);
    release();
    const result = await pending;
    expect(result.status).toBe(401);
    expect(result.body).not.toHaveProperty('items');
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(0);
  });
  it('rejects stale confirmation after logout and never creates a record', async () => {
    const { app, auth, finance } = fixture(true);
    auth.logout(TOKEN);
    const result = await post(
      app,
      '/api/ai/entry/confirm',
      { plan: plan(), requestId: 'stale-confirm-interface' },
      true,
    );
    expect(result.status).toBe(401);
    expect(finance.listAccounts()).toHaveLength(0);
  });
  it('uses the same preview and confirmed plan service from CLI', async () => {
    const { finance } = fixture();
    let stdout = '',
      stderr = '';
    const options = {
      service: finance,
      aiInterpreter: model,
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    };
    expect(await runCli(['ai', 'preview', 'Hesap ve abonelik ekle', '--json'], options)).toBe(0);
    const preview = JSON.parse(stdout);
    expect(preview.items).toHaveLength(2);
    expect(finance.listAccounts()).toHaveLength(0);
    stdout = '';
    expect(
      await runCli(
        [
          'ai',
          'confirm',
          '--data',
          JSON.stringify(preview),
          '--request-id',
          'cli-plan-interface',
          '--json',
        ],
        options,
      ),
    ).toBe(0);
    expect(JSON.parse(stdout).saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(stderr).toBe('');
    stdout = '';
    expect(
      await runCli(
        [
          'ai',
          'confirm',
          '--data',
          JSON.stringify({ ...plan(), certain: false, issues: ['Hangi hesap?'] }),
          '--request-id',
          'cli-uncertain-interface',
          '--json',
        ],
        options,
      ),
    ).toBe(2);
    expect(JSON.parse(stdout).saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(1);
  });
});
