import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PROJECT_ROOT } from '../core/database';
import { AiError } from './errors';

export interface AiSettingsOptions {
  path?: string;
  databasePath?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}
export interface AiSettingsStatus {
  provider: 'openai';
  configured: boolean;
  model: string;
}
export interface AiCredentials {
  apiKey: string;
  model: string;
}
interface StoredSettings {
  apiKey?: string;
  model?: string;
}
const DEFAULT_MODEL = 'gpt-5.4-mini';
const within = (path: string, root: string) => {
  const part = relative(root, path);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
};
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(canonical(dirname(path)), basename(path));
}
function model(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new AiError('Geçerli bir OpenAI model adı girin.', 400);
  return value;
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^sk-[A-Za-z0-9_-]{12,256}$/.test(value))
    throw new AiError('Geçerli bir OpenAI API anahtarı girin.', 400);
  return value;
}
export class AiSettingsService {
  private readonly path: string;
  private readonly databasePath: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private activeConnections = 0;
  constructor(options: AiSettingsOptions = {}) {
    this.databasePath = resolve(
      options.databasePath ?? process.env.FINANCE_DB ?? join(PROJECT_ROOT, 'data/finance.sqlite'),
    );
    this.path = resolve(
      options.path ??
        process.env.FINANCE_AI_CONFIG ??
        join(dirname(this.databasePath), 'ai-config.json'),
    );
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000)
      throw new AiError('AI bağlantı süresi geçersiz.', 400);
    this.checkPath();
  }
  private checkPath() {
    try {
      const resolved = canonical(this.path),
        sourceRoot = canonical(PROJECT_ROOT),
        dataRoot = join(sourceRoot, 'data');
      const authPath = canonical(
        resolve(process.env.FINANCE_AUTH_DB ?? join(PROJECT_ROOT, 'data/auth.sqlite')),
      );
      if (
        extname(this.path) !== '.json' ||
        resolved === canonical(this.databasePath) ||
        resolved === authPath ||
        (within(resolved, sourceRoot) &&
          (process.env.FINANCE_PUBLIC_URL || !within(resolved, dataRoot)))
      )
        throw new Error('unsafe');
      const stat = lstatSync(this.path, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe');
      }
    } catch {
      throw new AiError('AI yapılandırması güvenli, ayrı bir JSON dosyasında tutulmalıdır.');
    }
  }
  private read(): StoredSettings {
    this.checkPath();
    if (!existsSync(this.path)) return {};
    try {
      const stat = statSync(this.path);
      if (
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        stat.size > 8192
      )
        throw new Error('permissions');
      const stored: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (
        !stored ||
        typeof stored !== 'object' ||
        Array.isArray(stored) ||
        Object.keys(stored).some((name) => !['apiKey', 'model'].includes(name))
      )
        throw new Error('format');
      const input = stored as StoredSettings;
      if (input.apiKey !== undefined) key(input.apiKey);
      if (input.model !== undefined) model(input.model);
      return input;
    } catch {
      throw new AiError(
        'AI yapılandırma dosyası okunamadı. İçerik ve özel dosya izinlerini kontrol edin.',
      );
    }
  }
  private environmentKey(): string | undefined {
    const value = process.env.OPENAI_API_KEY;
    if (!value) return undefined;
    try {
      return key(value);
    } catch {
      throw new AiError('Sunucu OpenAI anahtarı geçersiz.');
    }
  }
  status(): AiSettingsStatus {
    const stored = this.read();
    return {
      provider: 'openai',
      configured: !!(stored.apiKey ?? this.environmentKey()),
      model: stored.model ?? DEFAULT_MODEL,
    };
  }
  getCredentials(): AiCredentials | null {
    const stored = this.read(),
      apiKey = stored.apiKey ?? this.environmentKey();
    return apiKey ? { apiKey, model: stored.model ?? DEFAULT_MODEL } : null;
  }
  update(input: { apiKey?: string; model?: string }): AiSettingsStatus {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((name) => !['apiKey', 'model'].includes(name))
    )
      throw new AiError('Yalnız API anahtarı ve model alanları gönderilebilir.', 400);
    if (input.apiKey === undefined && input.model === undefined)
      throw new AiError('API anahtarı veya model alanı gereklidir.', 400);
    const updated = this.read();
    if (input.apiKey !== undefined) updated.apiKey = key(input.apiKey);
    if (input.model !== undefined) updated.model = model(input.model);
    updated.model ??= DEFAULT_MODEL;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let owned = false;
    try {
      this.checkPath();
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const handle = openSync(temporary, 'wx', 0o600);
      owned = true;
      try {
        writeFileSync(handle, `${JSON.stringify(updated)}\n`);
      } finally {
        closeSync(handle);
      }
      this.checkPath();
      renameSync(temporary, this.path);
    } catch {
      throw new AiError('AI ayarları güvenli dosyaya kaydedilemedi.');
    } finally {
      if (owned) rmSync(temporary, { force: true });
    }
    return this.status();
  }
  async testConnection(): Promise<{ ok: true; provider: 'openai'; model: string }> {
    const credentials = this.getCredentials();
    if (!credentials) throw new AiError('Önce OpenAI API anahtarını ekleyin.', 400);
    if (this.activeConnections >= 2)
      throw new AiError('Bağlantı testleri yoğun. Biraz sonra yeniden deneyin.', 429);
    this.activeConnections++;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    try {
      response = await Promise.race([
        this.fetcher(`https://api.openai.com/v1/models/${encodeURIComponent(credentials.model)}`, {
          method: 'GET',
          redirect: 'error',
          headers: { Authorization: `Bearer ${credentials.apiKey}` },
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new AiError('OpenAI bağlantısı zaman aşımına uğradı.'));
          }, this.timeoutMs);
        }),
      ]);
      if (!response.ok)
        throw new AiError(
          'OpenAI bağlantısı doğrulanamadı. Anahtar, model erişimi ve hesabınızı kontrol edin.',
        );
      return { ok: true, provider: 'openai', model: credentials.model };
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('OpenAI bağlantısı kurulamadı. Bir süre sonra yeniden deneyin.');
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      try {
        await response?.body?.cancel();
      } catch {
        /* Sağlayıcının gövdesi/hatası dışarı çıkarılmaz. */
      }
      this.activeConnections--;
    }
  }
}
