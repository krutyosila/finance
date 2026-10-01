import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { AuthService, hashPassword, verifyPassword, parsePublicURL } from '../server/auth';
import { runAdmin } from '../server/admin';
import { FinanceService } from '../server/core/service';
import { createApp } from '../server/app';
const EMAIL = 'admin@example.com',
  PASSWORD = 'test-only-long-private-password',
  ORIGIN = 'https://finance.example.com';
const stores: AuthService[] = [],
  services: FinanceService[] = [],
  servers: Server[] = [],
  roots: string[] = [];
const auth = (options: ConstructorParameters<typeof AuthService>[1] = {}) => {
  const a = new AuthService(':memory:', options);
  stores.push(a);
  return a;
};
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  stores.splice(0).forEach((s) => s.close());
  services.splice(0).forEach((s) => s.close());
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
async function api(a?: AuthService, publicUrl: string | null = ORIGIN) {
  const finance = new FinanceService(':memory:');
  services.push(finance);
  const app = createApp(finance, { publicUrl, auth: a });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port missing');
  return async (
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) =>
    new Promise<{
      status: number;
      body: any;
      headers: import('node:http').IncomingHttpHeaders;
    }>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: options.method ?? 'GET',
          headers: {
            host: publicUrl ? 'finance.example.com' : 'localhost:4317',
            'x-forwarded-proto': 'https',
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...options.headers,
          },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 500,
              body: text ? JSON.parse(text) : null,
              headers: response.headers,
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      if (options.body) request.write(JSON.stringify(options.body));
      request.end();
    });
}
describe('hosted authentication source records', () => {
  it('only accepts a canonical HTTPS public origin', () => {
    expect(parsePublicURL(ORIGIN)?.origin).toBe(ORIGIN);
    for (const bad of [
      'http://finance.example.com',
      'https://ali:secret@finance.example.com',
      'https://finance.example.com/path',
      'https://finance.example.com?query=yes',
    ])
      expect(() => parsePublicURL(bad)).toThrow();
    expect(parsePublicURL(undefined)).toBeNull();
  });
  it('salts scrypt password hashes and verifies without storing plaintext', async () => {
    const first = await hashPassword(PASSWORD),
      second = await hashPassword(PASSWORD);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyPassword(PASSWORD, first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
  });
  it('accepts eight-character passwords for provisioning and change, and rejects seven', async () => {
    const a = auth();
    await expect(hashPassword('Tiny12!')).rejects.toThrow();
    await a.provisionAdmin(EMAIL, 'Test123!');
    const first = await a.login(EMAIL, 'Test123!', 'first'),
      second = await a.login(EMAIL, 'Test123!', 'second');
    await expect(
      a.changePassword('Test123!', 'Tiny12!', first.token, 'first'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(a.session(first.token)).not.toBeNull();
    await a.changePassword('Test123!', 'Next123!', first.token, 'first');
    expect(a.session(first.token)).toBeNull();
    expect(a.session(second.token)).toBeNull();
    expect((await a.login(EMAIL, 'Next123!', 'new-login')).user.email).toBe(EMAIL);
  });
  it('creates no administrator or session until explicitly provisioned', () => {
    const a = auth();
    expect(a.isProvisioned()).toBe(false);
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
  });
  it('preserves an existing administrator unless explicit reset and revokes sessions on reset', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const session = await a.login(EMAIL, PASSWORD, '127.0.0.1');
    await expect(a.provisionAdmin(EMAIL, 'second-test-only-long-password')).rejects.toThrow();
    expect(a.session(session.token)).toEqual({ email: EMAIL, role: 'ADMIN' });
    await a.provisionAdmin(EMAIL, 'second-test-only-long-password', {
      reset: true,
    });
    expect(a.session(session.token)).toBeNull();
    await expect(a.login(EMAIL, PASSWORD, '127.0.0.2')).rejects.toThrow();
  });
  it('stores only hashed session tokens and enforces expiration and logout', async () => {
    let clock = 1000;
    const a = auth({ now: () => clock, sessionTtlMs: 1000 });
    await a.provisionAdmin(EMAIL, PASSWORD);
    const session = await a.login(EMAIL, PASSWORD, '127.0.0.1');
    const row = a.sqlite.prepare('SELECT token_hash FROM sessions').get() as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(session.token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.token.length).toBeGreaterThanOrEqual(43);
    expect(a.session(session.token)?.email).toBe(EMAIL);
    clock = 2001;
    expect(a.session(session.token)).toBeNull();
    const next = await a.login(EMAIL, PASSWORD, '127.0.0.1');
    a.logout(next.token);
    expect(a.session(next.token)).toBeNull();
  });
  it('rate limits incorrect logins and session checks using persisted windows', async () => {
    let clock = 0;
    const a = auth({
      now: () => clock,
      loginLimit: 2,
      loginWindowMs: 1000,
      sessionLimit: 2,
      sessionWindowMs: 1000,
    });
    await a.provisionAdmin(EMAIL, PASSWORD);
    await expect(a.login(EMAIL, 'wrong', '127.0.0.1')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(a.login(EMAIL, 'wrong', '127.0.0.1')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(a.login(EMAIL, PASSWORD, '127.0.0.1')).rejects.toMatchObject({
      statusCode: 429,
    });
    a.checkSessionRate('127.0.0.1');
    a.checkSessionRate('127.0.0.1');
    expect(() => a.checkSessionRate('127.0.0.1')).toThrow();
    clock = 1001;
    expect(() => a.checkSessionRate('127.0.0.1')).not.toThrow();
    expect((await a.login(EMAIL, PASSWORD, '127.0.0.1')).user.email).toBe(EMAIL);
  });
  it('provisions from an owner-only file and never prints password/hash/token', async () => {
    const a = auth(),
      root = mkdtempSync(join(tmpdir(), 'finance-admin-test-'));
    roots.push(root);
    const path = join(root, 'password');
    writeFileSync(path, `${PASSWORD}\n`, { mode: 0o600 });
    let output = '';
    expect(
      await runAdmin(['--email', EMAIL, '--password-file', path], {
        auth: a,
        stdout: (t) => {
          output += t;
        },
        stderr: (t) => {
          output += t;
        },
      }),
    ).toBe(0);
    expect(output).toContain(EMAIL);
    expect(output).not.toContain(PASSWORD);
    expect(
      await runAdmin(['--email', EMAIL, '--password', PASSWORD], {
        auth: a,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toBe(1);
  });
});
describe('independent mobile and desktop sessions', () => {
  it('keeps devices on the same IP logged in while rotating and logging out only the mobile cookie', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const request = await api(a),
      sharedHeaders = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.42' },
      mobileHeaders = {
        ...sharedHeaders,
        'user-agent': 'Finance test mobile browser',
      },
      desktopHeaders = {
        ...sharedHeaders,
        'user-agent': 'Finance test desktop browser',
      };
    const [mobileLogin, desktopLogin] = await Promise.all([
      request('/api/auth/login', {
        method: 'POST',
        headers: mobileHeaders,
        body: { email: EMAIL, password: PASSWORD },
      }),
      request('/api/auth/login', {
        method: 'POST',
        headers: desktopHeaders,
        body: { email: EMAIL, password: PASSWORD },
      }),
    ]);
    expect(mobileLogin.status).toBe(200);
    expect(desktopLogin.status).toBe(200);
    const mobileCookie = mobileLogin.headers['set-cookie']![0].split(';')[0],
      desktopCookie = desktopLogin.headers['set-cookie']![0].split(';')[0];
    expect(mobileCookie).not.toBe(desktopCookie);
    for (const headers of [
      { ...mobileHeaders, cookie: mobileCookie },
      { ...desktopHeaders, cookie: desktopCookie },
    ]) {
      expect((await request('/api/auth/session', { headers })).body).toEqual({
        required: true,
        authenticated: true,
        user: { email: EMAIL, role: 'ADMIN' },
      });
      expect((await request('/api/context', { headers })).status).toBe(200);
    }
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 2 });

    const mobileRelogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { ...mobileHeaders, cookie: mobileCookie },
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(mobileRelogin.status).toBe(200);
    const nextMobileCookie = mobileRelogin.headers['set-cookie']![0].split(';')[0];
    expect(nextMobileCookie).not.toBe(mobileCookie);
    expect(
      (
        await request('/api/auth/session', {
          headers: { ...mobileHeaders, cookie: mobileCookie },
        })
      ).body.authenticated,
    ).toBe(false);
    expect(
      (
        await request('/api/context', {
          headers: { ...mobileHeaders, cookie: nextMobileCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/api/context', {
          headers: { ...desktopHeaders, cookie: desktopCookie },
        })
      ).status,
    ).toBe(200);
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 2 });

    expect(
      (
        await request('/api/auth/logout', {
          method: 'POST',
          headers: { ...mobileHeaders, cookie: nextMobileCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/api/context', {
          headers: { ...mobileHeaders, cookie: nextMobileCookie },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request('/api/context', {
          headers: { ...desktopHeaders, cookie: desktopCookie },
        })
      ).status,
    ).toBe(200);
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
  });

  it('keeps simultaneous sessions from different IPs independent on logout', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const [mobile, desktop] = await Promise.all([
      a.login(EMAIL, PASSWORD, '198.51.100.10'),
      a.login(EMAIL, PASSWORD, '203.0.113.20'),
    ]);
    expect(mobile.token).not.toBe(desktop.token);
    expect(a.session(mobile.token)).toEqual({ email: EMAIL, role: 'ADMIN' });
    expect(a.session(desktop.token)).toEqual({ email: EMAIL, role: 'ADMIN' });
    a.logout(mobile.token);
    expect(a.session(mobile.token)).toBeNull();
    expect(a.session(desktop.token)).toEqual({ email: EMAIL, role: 'ADMIN' });
    a.logout(desktop.token);
    expect(a.session(desktop.token)).toBeNull();
  });

  it('expires one device without expiring the other device that logged in later', async () => {
    let clock = 1000;
    const a = auth({ now: () => clock, sessionTtlMs: 1000 });
    await a.provisionAdmin(EMAIL, PASSWORD);
    const mobile = await a.login(EMAIL, PASSWORD, '198.51.100.10');
    clock = 1500;
    const desktop = await a.login(EMAIL, PASSWORD, '203.0.113.20');
    expect(a.session(mobile.token)).not.toBeNull();
    expect(a.session(desktop.token)).not.toBeNull();
    clock = mobile.expiresAt;
    expect(a.session(mobile.token)).toBeNull();
    expect(a.session(desktop.token)).toEqual({ email: EMAIL, role: 'ADMIN' });
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
    clock = desktop.expiresAt;
    expect(a.session(desktop.token)).toBeNull();
    expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
  });

  it('preserves both device sessions when the private auth database is closed and reopened', async () => {
    const root = mkdtempSync(join(tmpdir(), 'finance-device-sessions-'));
    roots.push(root);
    const path = join(root, 'auth.sqlite'),
      first = new AuthService(path),
      tokens: string[] = [];
    try {
      await first.provisionAdmin(EMAIL, PASSWORD);
      const logins = await Promise.all([
        first.login(EMAIL, PASSWORD, '198.51.100.10'),
        first.login(EMAIL, PASSWORD, '203.0.113.20'),
      ]);
      tokens.push(...logins.map((login) => login.token));
      expect(first.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({
        n: 2,
      });
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o077).toBe(0);
    } finally {
      first.close();
    }
    const reopened = new AuthService(path);
    stores.push(reopened);
    expect(reopened.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({
      n: 2,
    });
    for (const token of tokens)
      expect(reopened.session(token)).toEqual({ email: EMAIL, role: 'ADMIN' });
  });
});
describe('hosted API authorization', () => {
  it('requires login on every financial API while allowing only public health/session/login', async () => {
    const a = auth(),
      request = await api(a);
    expect((await request('/api/health')).status).toBe(200);
    expect((await request('/api/auth/session')).body).toEqual({
      required: true,
      authenticated: false,
      user: null,
    });
    for (const path of [
      '/api/context',
      '/api/ai/context',
      '/api/transactions',
      '/api/accounts',
      '/api/debts',
      '/api/audit',
    ])
      expect((await request(path)).status).toBe(401);
  });
  it('logs in with secure host-only cookie and authorizes subsequent requests', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const request = await api(a),
      login = await request('/api/auth/login', {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: { email: EMAIL, password: PASSWORD },
      });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({ email: EMAIL, role: 'ADMIN' });
    const cookie = login.headers['set-cookie']![0];
    for (const part of [
      '__Host-finance_session=',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/',
    ])
      expect(cookie).toContain(part);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(
      (
        await request('/api/context', {
          headers: { cookie: cookie.split(';')[0] },
        })
      ).status,
    ).toBe(200);
    expect(login.headers['cache-control']).toContain('no-store');
  });
  it('rejects missing or foreign mutation origins even with valid session and rejects forged hosts/HTTP', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const s = await a.login(EMAIL, PASSWORD, '127.0.0.1'),
      request = await api(a),
      cookie = `__Host-finance_session=${s.token}`;
    for (const origin of [undefined, 'https://attacker.example']) {
      const response = await request('/api/ai/transaction', {
        method: 'POST',
        headers: { cookie, ...(origin ? { origin } : {}) },
        body: { text: '100 market' },
      });
      expect(response.status).toBe(403);
    }
    expect((await request('/api/health', { headers: { host: 'attacker.example' } })).status).toBe(
      403,
    );
    expect(
      (
        await request('/api/health', {
          headers: { 'x-forwarded-proto': 'http' },
        })
      ).status,
    ).toBe(403);
  });
  it('invalidates sessions on logout and rejects expired sessions', async () => {
    let clock = 1000;
    const a = auth({ now: () => clock, sessionTtlMs: 1000 });
    await a.provisionAdmin(EMAIL, PASSWORD);
    const s = await a.login(EMAIL, PASSWORD, '127.0.0.1'),
      request = await api(a),
      cookie = `__Host-finance_session=${s.token}`;
    expect(
      (
        await request('/api/auth/logout', {
          method: 'POST',
          headers: { cookie, origin: ORIGIN },
        })
      ).status,
    ).toBe(200);
    expect((await request('/api/context', { headers: { cookie } })).status).toBe(401);
    const next = await a.login(EMAIL, PASSWORD, '127.0.0.1');
    clock = 2001;
    expect(
      (
        await request('/api/context', {
          headers: { cookie: `__Host-finance_session=${next.token}` },
        })
      ).status,
    ).toBe(401);
  });
  it('preserves the unauthenticated local mode and blocks remote hosts', async () => {
    const request = await api(undefined, null);
    expect((await request('/api/auth/session')).body).toEqual({
      required: false,
      authenticated: false,
      user: null,
    });
    expect((await request('/api/context')).status).toBe(200);
    expect(
      (
        await request('/api/context', {
          headers: { host: 'finance.example.com' },
        })
      ).status,
    ).toBe(403);
  });
  it('prevents caching financial and session responses for every accepted route casing', async () => {
    const a = auth();
    await a.provisionAdmin(EMAIL, PASSWORD);
    const session = await a.login(EMAIL, PASSWORD, '127.0.0.1'),
      request = await api(a);
    for (const path of ['/api/context', '/API/context', '/Api/auth/session']) {
      const result = await request(path, {
        headers: { cookie: `__Host-finance_session=${session.token}` },
      });
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toContain('no-store');
    }
  });
});
it('does not modify the financial schema when the auth database path is misconfigured', () => {
  const root = mkdtempSync(join(tmpdir(), 'finance-auth-path-'));
  roots.push(root);
  const finance = new FinanceService(join(root, 'finance.sqlite'));
  services.push(finance);
  expect(() =>
    createApp(finance, {
      publicUrl: ORIGIN,
      authDatabasePath: finance.databasePath,
    }),
  ).toThrow();
  expect(
    finance.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='administrator'").get(),
  ).toBeUndefined();
});
it('cannot issue a session from a password invalidated during asynchronous verification', async () => {
  const a = auth();
  await a.provisionAdmin(EMAIL, PASSWORD);
  const pending = a.login(EMAIL, PASSWORD, '127.0.0.1');
  a.sqlite.prepare('UPDATE administrator SET password_hash=? WHERE id=1').run('0'.repeat(128));
  await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  expect(a.sqlite.prepare('SELECT count(*) AS n FROM sessions').get()).toMatchObject({ n: 0 });
});
it('rejects an auth database as financial storage before modifying its schema', async () => {
  const root = mkdtempSync(join(tmpdir(), 'finance-financial-path-'));
  roots.push(root);
  const path = join(root, 'auth.sqlite'),
    first = new AuthService(path);
  await first.provisionAdmin(EMAIL, PASSWORD);
  first.close();
  expect(() => new FinanceService(path)).toThrow('ayrı');
  const reopened = new AuthService(path);
  stores.push(reopened);
  expect(reopened.isProvisioned()).toBe(true);
  expect(
    reopened.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('accounts','transactions','schema_migrations')",
      )
      .all(),
  ).toEqual([]);
});
it('revokes and clears logout even when session request quota is exhausted', async () => {
  const a = auth({ sessionLimit: 1 });
  await a.provisionAdmin(EMAIL, PASSWORD);
  const session = await a.login(EMAIL, PASSWORD, '127.0.0.1'),
    request = await api(a);
  const cookie = `__Host-finance_session=${session.token}`;
  expect((await request('/api/context', { headers: { cookie } })).status).toBe(200);
  expect((await request('/api/context', { headers: { cookie } })).status).toBe(429);
  const logout = await request('/api/auth/logout', {
    method: 'POST',
    headers: { cookie, origin: ORIGIN },
  });
  expect(logout.status).toBe(200);
  expect(logout.headers['set-cookie']?.[0]).toContain('Expires=Thu, 01 Jan 1970');
  expect(a.session(session.token)).toBeNull();
  expect(
    (
      await request('/api/auth/logout', {
        method: 'POST',
        headers: { origin: ORIGIN },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request('/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://attacker.example' },
      })
    ).status,
  ).toBe(403);
});
it('verifies hashes with the published scrypt N=131072 r=8 p=1 work factor', async () => {
  const { scryptSync } = await import('node:crypto');
  const salt = 'ab'.repeat(32),
    hash = scryptSync(PASSWORD, Buffer.from(salt, 'hex'), 64, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    }).toString('hex');
  expect(await verifyPassword(PASSWORD, { salt, hash })).toBe(true);
});
