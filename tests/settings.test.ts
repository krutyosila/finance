import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { AuthError, AuthService, SESSION_COOKIE } from '../server/auth';
import { AiSettingsService } from '../server/ai/settings';
import { AiError } from '../server/ai/errors';
import { registerSettingsRoutes } from '../server/settings-routes';
import { PROJECT_ROOT } from '../server/core/database';

const API_KEY = 'sk-test-only-settings-private-value';
const OLD_PASSWORD = 'old-test-only-private-password';
const NEW_PASSWORD = 'new-test-only-private-password';
const EMAIL = 'settings-admin@example.com';
const roots: string[] = [],
  stores: AuthService[] = [],
  servers: Server[] = [];
const fixture = (options: Partial<ConstructorParameters<typeof AiSettingsService>[0]> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'finance-settings-'));
  roots.push(root);
  return {
    root,
    path: join(root, 'ai-config.json'),
    settings: new AiSettingsService({ path: join(root, 'ai-config.json'), ...options }),
  };
};
const auth = (options: ConstructorParameters<typeof AuthService>[1] = {}) => {
  const value = new AuthService(':memory:', options);
  stores.push(value);
  return value;
};
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('özel OpenAI ayarları', () => {
  it('anahtar yokken varsayılan modeli gösterir ve hiçbir dosya yazmaz', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { settings } = fixture();
    expect(settings.status()).toEqual({
      provider: 'openai',
      configured: false,
      model: 'gpt-5.4-mini',
    });
    expect(settings.getCredentials()).toBeNull();
  });
  it('anahtarı özel atomik dosyaya kaydeder, model güncellemesinde korur ve durumdan dışlar', () => {
    const { settings, path } = fixture();
    expect(settings.update({ apiKey: API_KEY })).toEqual({
      provider: 'openai',
      configured: true,
      model: 'gpt-5.4-mini',
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(settings.update({ model: 'gpt-5.4' })).toEqual({
      provider: 'openai',
      configured: true,
      model: 'gpt-5.4',
    });
    expect(settings.getCredentials()).toEqual({ apiKey: API_KEY, model: 'gpt-5.4' });
    expect(JSON.stringify(settings.status())).not.toContain(API_KEY);
    expect(new AiSettingsService({ path }).getCredentials()).toEqual({
      apiKey: API_KEY,
      model: 'gpt-5.4',
    });
  });
  it('disk anahtarına öncelik verir; yalnız model dosyasında ortam anahtarı kullanılabilir', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-environment-only-private-key');
    const { settings } = fixture();
    settings.update({ model: 'gpt-5.4' });
    expect(settings.getCredentials()?.apiKey).toBe('sk-environment-only-private-key');
    settings.update({ apiKey: API_KEY });
    expect(settings.getCredentials()?.apiKey).toBe(API_KEY);
  });
  it('geçersiz değerleri ve bozuk JSON dosyasını anahtar sızdırmadan reddeder', () => {
    const { settings, path } = fixture();
    settings.update({ apiKey: API_KEY });
    const original = readFileSync(path, 'utf8');
    for (const input of [
      { apiKey: '' },
      { apiKey: `sk-${API_KEY}\n` },
      { model: '../secrets' },
      { model: '' },
      { apiKey: 123 },
    ]) {
      expect(() => settings.update(input as any)).toThrow(AiError);
      expect(readFileSync(path, 'utf8')).toBe(original);
    }
    writeFileSync(path, `{invalid-json-${API_KEY}`, { mode: 0o600 });
    try {
      settings.status();
      expect.fail('bozuk dosya reddedilmelidir');
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect(String(error)).not.toContain(API_KEY);
    }
  });
  it('finans/kimlik dosyalarına, kaynak ağacına ve symlink hedeflerine yazmaz', () => {
    const { root } = fixture();
    const databasePath = join(root, 'finance.sqlite'),
      authPath = join(root, 'auth.sqlite');
    writeFileSync(databasePath, 'financial-marker');
    writeFileSync(authPath, 'auth-marker');
    for (const path of [
      databasePath,
      authPath,
      join(PROJECT_ROOT, 'public', 'ai-config.json'),
      join(PROJECT_ROOT, 'server', 'ai-config.json'),
    ])
      expect(() =>
        new AiSettingsService({ path, databasePath }).update({ apiKey: API_KEY }),
      ).toThrow(AiError);
    const target = join(root, 'untouched.json');
    writeFileSync(target, '{"model":"gpt-5.4-mini"}', { mode: 0o600 });
    const linked = join(root, 'linked.json');
    symlinkSync(target, linked);
    expect(() => new AiSettingsService({ path: linked }).update({ apiKey: API_KEY })).toThrow(
      AiError,
    );
    expect(readFileSync(target, 'utf8')).toBe('{"model":"gpt-5.4-mini"}');
    expect(readFileSync(databasePath, 'utf8')).toBe('financial-marker');
    expect(readFileSync(authPath, 'utf8')).toBe('auth-marker');
  });
  it('model erişimini sabit HTTPS adresinde kontrol eder, finans verisi göndermeden başarılı döner', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const { settings } = fixture({ fetcher });
    settings.update({ apiKey: API_KEY });
    expect(await settings.testConnection()).toEqual({
      ok: true,
      provider: 'openai',
      model: 'gpt-5.4-mini',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-5.4-mini',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${API_KEY}` },
      }),
    );
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body');
  });
  it('kopuk symlink dosyasını değiştirmeden reddeder', () => {
    const { root } = fixture();
    const path = join(root, 'linked.json');
    symlinkSync(join(root, 'missing.json'), path);
    expect(() => new AiSettingsService({ path }).update({ apiKey: API_KEY })).toThrow(AiError);
    expect(() => statSync(join(root, 'missing.json'))).toThrow();
  });
  it('yerel data dizini public dizinine yönlenmişse anahtarı web ağacına yazmaz', async () => {
    const { root } = fixture();
    const publicPath = join(root, 'public');
    mkdirSync(publicPath);
    symlinkSync(publicPath, join(root, 'data'));
    vi.resetModules();
    vi.doMock('../server/core/database', () => ({ PROJECT_ROOT: root }));
    try {
      const { AiSettingsService: IsolatedSettings } = await import('../server/ai/settings');
      expect(() =>
        new IsolatedSettings({ path: join(root, 'data', 'ai-config.json') }).update({
          apiKey: API_KEY,
        }),
      ).toThrow(/güvenli/);
      expect(() => statSync(join(publicPath, 'ai-config.json'))).toThrow();
    } finally {
      vi.doUnmock('../server/core/database');
      vi.resetModules();
    }
  });
  it('iki noktayla başlayan kaynak alt klasörüne anahtar yazmaz', async () => {
    const { root } = fixture();
    vi.resetModules();
    vi.doMock('../server/core/database', () => ({ PROJECT_ROOT: root }));
    try {
      const { AiSettingsService: IsolatedSettings } = await import('../server/ai/settings');
      const path = join(root, '..private', 'ai-config.json');
      expect(() => new IsolatedSettings({ path }).update({ apiKey: API_KEY })).toThrow(/güvenli/);
      expect(() => statSync(path)).toThrow();
    } finally {
      vi.doUnmock('../server/core/database');
      vi.resetModules();
    }
  });
  it('sağlayıcı hata gövdesini veya ağ hata metnini sızdırmaz, bağlantı zaman aşımını uygular', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(API_KEY, { status: 401 }));
    const { settings } = fixture({ fetcher, timeoutMs: 20 });
    settings.update({ apiKey: API_KEY });
    await expect(settings.testConnection()).rejects.toMatchObject({ statusCode: 503 });
    fetcher.mockRejectedValue(new Error(`transport-${API_KEY}`));
    await expect(settings.testConnection()).rejects.not.toThrow(API_KEY);
    fetcher.mockImplementation(() => new Promise(() => {}));
    await expect(settings.testConnection()).rejects.toThrow(/zaman|süre/i);
  });
  it('aynı anda en fazla iki bağlantı testi çalıştırır', async () => {
    const completions: ((value: Response) => void)[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        completions.length >= 2
          ? Promise.resolve(new Response('{}'))
          : new Promise((resolve) => completions.push(resolve)),
      );
    const { settings } = fixture({ fetcher });
    settings.update({ apiKey: API_KEY });
    const first = settings.testConnection(),
      second = settings.testConnection();
    try {
      await expect(settings.testConnection()).rejects.toMatchObject({ statusCode: 429 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      completions.forEach((complete) => complete(new Response('{}')));
      await Promise.all([first, second]);
    }
    fetcher.mockResolvedValue(new Response('{}'));
    expect((await settings.testConnection()).ok).toBe(true);
  });
  it('başarı ve sağlayıcı hatasında okunmayan yanıt gövdelerini iptal eder', async () => {
    const success = new Response('{}'),
      failed = new Response(API_KEY, { status: 401 });
    const cancelSuccess = vi.spyOn(success.body!, 'cancel');
    const cancelFailed = vi.spyOn(failed.body!, 'cancel');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(failed);
    const { settings } = fixture({ fetcher });
    settings.update({ apiKey: API_KEY });
    await settings.testConnection();
    expect(cancelSuccess).toHaveBeenCalledOnce();
    await expect(settings.testConnection()).rejects.not.toThrow(API_KEY);
    expect(cancelFailed).toHaveBeenCalledOnce();
  });
});

describe('oturumdan güvenli parola değişimi', () => {
  it('mevcut parolayı doğrular, yeni hash yazar ve bütün oturumları iptal eder', async () => {
    const store = auth();
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const first = await store.login(EMAIL, OLD_PASSWORD, 'first'),
      second = await store.login(EMAIL, OLD_PASSWORD, 'second');
    await expect(
      store.changePassword('wrong', NEW_PASSWORD, first.token, 'first'),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(store.session(first.token)).not.toBeNull();
    await expect(
      store.changePassword(OLD_PASSWORD, 'short', first.token, 'first'),
    ).rejects.toMatchObject({ statusCode: 400 });
    await store.changePassword(OLD_PASSWORD, NEW_PASSWORD, first.token, 'first');
    expect(store.session(first.token)).toBeNull();
    expect(store.session(second.token)).toBeNull();
    await expect(store.login(EMAIL, OLD_PASSWORD, 'old-login')).rejects.toMatchObject({
      statusCode: 401,
    });
    expect((await store.login(EMAIL, NEW_PASSWORD, 'new-login')).user.email).toBe(EMAIL);
    expect(JSON.stringify(store.sqlite.prepare('SELECT * FROM administrator').get())).not.toContain(
      NEW_PASSWORD,
    );
  });
  it('oturumsuz denemeyi reddeder ve yanlış mevcut parola denemelerini sınırlar', async () => {
    const store = auth({ loginLimit: 1 });
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const session = await store.login(EMAIL, OLD_PASSWORD, 'login');
    await expect(
      store.changePassword(OLD_PASSWORD, NEW_PASSWORD, undefined, 'client'),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      store.changePassword('wrong', NEW_PASSWORD, session.token, 'client'),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      store.changePassword(OLD_PASSWORD, NEW_PASSWORD, session.token, 'client'),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
  it('async doğrulama sırasında çıkış yapılırsa parolayı değiştirmez', async () => {
    const store = auth();
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const session = await store.login(EMAIL, OLD_PASSWORD, 'login');
    const pending = store.changePassword(OLD_PASSWORD, NEW_PASSWORD, session.token, 'client');
    store.logout(session.token);
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect((await store.login(EMAIL, OLD_PASSWORD, 'check')).user.email).toBe(EMAIL);
  });
  it('eşzamanlı iki parola değişiminden yalnız birini kabul eder', async () => {
    const store = auth();
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const session = await store.login(EMAIL, OLD_PASSWORD, 'login');
    const results = await Promise.allSettled([
      store.changePassword(OLD_PASSWORD, NEW_PASSWORD, session.token, 'one'),
      store.changePassword(OLD_PASSWORD, 'another-new-long-private-password', session.token, 'two'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(store.session(session.token)).toBeNull();
  });
});

async function routes(store: AuthService | null, settings: AiSettingsService) {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    if (store && !store.session(req.headers.cookie?.split('=')[1])) {
      res.status(401).json({ error: 'Giriş gerekli.' });
      return;
    }
    next();
  });
  registerSettingsRoutes(app, store, settings);
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res
        .status(error instanceof AiError || error instanceof AuthError ? error.statusCode : 500)
        .json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test portu eksik.');
  return (path: string, method = 'GET', body?: unknown, cookie?: string) =>
    new Promise<{ status: number; body: any; cookie?: string }>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method,
          headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode!,
              body: JSON.parse(text),
              cookie: response.headers['set-cookie']?.[0],
            }),
          );
        },
      );
      request.on('error', reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
}
describe('ayar uçları', () => {
  it('oturum arkasında durum/güncelleme/test sunar ve anahtarı yanıta koymaz', async () => {
    const store = auth();
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const login = await store.login(EMAIL, OLD_PASSWORD, 'login');
    const { settings } = fixture({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    });
    const request = await routes(store, settings),
      cookie = `${SESSION_COOKIE}=${login.token}`;
    expect((await request('/api/settings/ai')).status).toBe(401);
    const updated = await request('/api/settings/ai', 'PATCH', { apiKey: API_KEY }, cookie);
    expect(updated.status).toBe(200);
    expect(JSON.stringify(updated.body)).not.toContain(API_KEY);
    expect((await request('/api/settings/ai', 'GET', undefined, cookie)).body.configured).toBe(
      true,
    );
    expect((await request('/api/settings/ai/test', 'POST', {}, cookie)).body.ok).toBe(true);
    expect(
      (await request('/api/settings/ai', 'PATCH', { apiKey: API_KEY, unknown: 'bad' }, cookie))
        .status,
    ).toBe(400);
  });
  it('başarılı parola değişiminde güvenli çerezi temizler; yerel modda reddeder', async () => {
    const store = auth();
    await store.provisionAdmin(EMAIL, OLD_PASSWORD);
    const login = await store.login(EMAIL, OLD_PASSWORD, 'login');
    const { settings } = fixture();
    const request = await routes(store, settings);
    const changed = await request(
      '/api/auth/password',
      'POST',
      { currentPassword: OLD_PASSWORD, newPassword: 'Next123!' },
      `${SESSION_COOKIE}=${login.token}`,
    );
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ changed: true });
    for (const value of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'])
      expect(changed.cookie).toContain(value);
    expect(
      (await request('/api/settings/ai', 'GET', undefined, `${SESSION_COOKIE}=${login.token}`))
        .status,
    ).toBe(401);
    const local = await routes(null, settings);
    expect(
      (
        await local('/api/auth/password', 'POST', {
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(403);
  });
});
