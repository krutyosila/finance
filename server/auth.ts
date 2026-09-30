import Database from 'better-sqlite3';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROJECT_ROOT } from './core/database';
export interface AuthUser {
  email: string;
  role: 'ADMIN';
}
export interface PasswordHash {
  salt: string;
  hash: string;
}
export interface AuthOptions {
  now?: () => number;
  sessionTtlMs?: number;
  loginLimit?: number;
  loginWindowMs?: number;
  sessionLimit?: number;
  sessionWindowMs?: number;
}
export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
export function parsePublicURL(value: string | undefined | null): URL | null {
  if (value == null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FINANCE_PUBLIC_URL geçerli bir HTTPS adresi olmalıdır.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'FINANCE_PUBLIC_URL yalnızca HTTPS alan adı içermelidir; yol, kullanıcı veya sorgu eklemeyin.',
    );
  return url;
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, 'hex'),
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<PasswordHash> {
  if (
    typeof password !== 'string' ||
    password.length < 16 ||
    Buffer.byteLength(password, 'utf8') > 1024
  )
    throw new Error('Parola en az 16 karakter olmalı ve 1024 baytı aşmamalıdır.');
  const salt = randomBytes(32).toString('hex'),
    hash = (await derive(password, salt)).toString('hex');
  return { salt, hash };
}
export async function verifyPassword(password: string, record: PasswordHash): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    Buffer.byteLength(password, 'utf8') > 1024 ||
    !/^[a-f0-9]{64}$/.test(record.salt) ||
    !/^[a-f0-9]{128}$/.test(record.hash)
  )
    return false;
  const calculated = await derive(password, record.salt);
  return timingSafeEqual(calculated, Buffer.from(record.hash, 'hex'));
}
function email(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error('Geçerli bir e-posta adresi girin.');
  return normalized;
}
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const SESSION_COOKIE = '__Host-finance_session';
export function sessionCookie(header: string | undefined): string | undefined {
  const entries = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (entries.length !== 1) return undefined;
  const token = entries[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export class AuthService {
  readonly sqlite: Database.Database;
  readonly databasePath: string;
  readonly sessionTtlMs: number;
  private now: () => number;
  private loginLimit: number;
  private loginWindowMs: number;
  private sessionLimit: number;
  private sessionWindowMs: number;
  private activeChecks = 0;
  private lastCleanup = -Infinity;
  private dummy: PasswordHash = {
    salt: randomBytes(32).toString('hex'),
    hash: randomBytes(64).toString('hex'),
  };
  constructor(
    databasePath = process.env.FINANCE_AUTH_DB ?? resolve(PROJECT_ROOT, 'data/auth.sqlite'),
    options: AuthOptions = {},
  ) {
    this.databasePath = databasePath;
    this.now = options.now ?? Date.now;
    this.sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000;
    this.loginLimit = options.loginLimit ?? 10;
    this.loginWindowMs = options.loginWindowMs ?? 15 * 60 * 1000;
    this.sessionLimit = options.sessionLimit ?? 240;
    this.sessionWindowMs = options.sessionWindowMs ?? 60 * 1000;
    if (
      [
        this.sessionTtlMs,
        this.loginLimit,
        this.loginWindowMs,
        this.sessionLimit,
        this.sessionWindowMs,
      ].some((n) => !Number.isSafeInteger(n) || n <= 0)
    )
      throw new Error('Oturum ve istek sınırları pozitif tam sayı olmalıdır.');
    if (databasePath !== ':memory:')
      mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
    this.sqlite = new Database(databasePath);
    if (
      this.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('transactions','accounts')",
        )
        .get()
    ) {
      this.sqlite.close();
      throw new Error('Kimlik veritabanı finans veritabanından ayrı olmalıdır.');
    }
    if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite
      .exec(`CREATE TABLE IF NOT EXISTS administrator (id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL CHECK(length(password_salt)=64),password_hash TEXT NOT NULL CHECK(length(password_hash)=128),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),administrator_id INTEGER NOT NULL REFERENCES administrator(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL CHECK(expires_at>created_at));
   CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
   CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL CHECK(count>=0));`);
  }
  close() {
    this.sqlite.close();
  }
  isProvisioned() {
    return !!this.sqlite.prepare('SELECT id FROM administrator WHERE id=1').get();
  }
  async provisionAdmin(
    address: string,
    password: string,
    options: { reset?: boolean } = {},
  ): Promise<AuthUser> {
    const normalized = email(address);
    if (this.isProvisioned() && !options.reset)
      throw new Error(
        'Yönetici zaten mevcut. Parolayı değiştirmek için --reset seçeneğini açıkça kullanın.',
      );
    const hashed = await hashPassword(password),
      time = this.now();
    return this.sqlite.transaction(() => {
      if (this.isProvisioned() && !options.reset)
        throw new Error(
          'Yönetici zaten mevcut. Parolayı değiştirmek için --reset seçeneğini açıkça kullanın.',
        );
      this.sqlite
        .prepare(
          'INSERT INTO administrator(id,email,password_salt,password_hash,created_at,updated_at) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=excluded.updated_at',
        )
        .run(normalized, hashed.salt, hashed.hash, time, time);
      this.sqlite.prepare('DELETE FROM sessions').run();
      return { email: normalized, role: 'ADMIN' as const };
    })();
  }
  private rate(bucket: string, limit: number, windowMs: number) {
    const time = this.now(),
      key = tokenHash(bucket);
    if (time - this.lastCleanup >= 60000) {
      this.sqlite
        .prepare('DELETE FROM rate_limits WHERE window_start<?')
        .run(time - Math.max(this.loginWindowMs, this.sessionWindowMs));
      this.lastCleanup = time;
    }
    this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare('SELECT window_start,count FROM rate_limits WHERE key=?')
        .get(key) as { window_start: number; count: number } | undefined;
      const expired = !row || time - row.window_start >= windowMs || time < row.window_start;
      if (!expired && row.count >= limit)
        throw new AuthError(
          'Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.',
          429,
          Math.max(1, Math.ceil((row.window_start + windowMs - time) / 1000)),
        );
      this.sqlite
        .prepare(
          'INSERT INTO rate_limits(key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=?,count=?',
        )
        .run(
          key,
          expired ? time : row!.window_start,
          expired ? time : row!.window_start,
          expired ? 1 : row!.count + 1,
        );
    })();
  }
  checkSessionRate(address: string) {
    this.rate(`session:${address}`, this.sessionLimit, this.sessionWindowMs);
  }
  async changePassword(
    currentPassword: string,
    newPassword: string,
    token: string | undefined,
    address: string,
  ): Promise<void> {
    const user = this.session(token);
    if (!user) throw new AuthError('Devam etmek için yeniden giriş yapın.', 401);
    if (
      typeof currentPassword !== 'string' ||
      Buffer.byteLength(currentPassword, 'utf8') > 1024 ||
      typeof newPassword !== 'string' ||
      newPassword.length < 16 ||
      Buffer.byteLength(newPassword, 'utf8') > 1024
    )
      throw new AuthError(
        'Yeni parola en az 16 karakter olmalı ve parolalar 1024 baytı aşmamalıdır.',
        400,
      );
    this.rate(`password-ip:${address}`, this.loginLimit, this.loginWindowMs);
    this.rate(`password-user:${user.email}`, this.loginLimit, this.loginWindowMs);
    if (this.activeChecks >= 4)
      throw new AuthError('Parola işlemleri yoğun. Biraz sonra yeniden deneyin.', 429, 1);
    const previous = this.sqlite
      .prepare('SELECT password_salt,password_hash FROM administrator WHERE id=1')
      .get() as { password_salt: string; password_hash: string } | undefined;
    if (!previous) throw new AuthError('Devam etmek için yeniden giriş yapın.', 401);
    this.activeChecks++;
    try {
      if (
        !(await verifyPassword(currentPassword, {
          salt: previous.password_salt,
          hash: previous.password_hash,
        }))
      )
        throw new AuthError('Mevcut parola hatalı.', 401);
      const next = await hashPassword(newPassword);
      this.sqlite.transaction(() => {
        const current = this.sqlite
          .prepare('SELECT password_salt,password_hash FROM administrator WHERE id=1')
          .get() as typeof previous;
        if (
          !current ||
          current.password_hash !== previous.password_hash ||
          current.password_salt !== previous.password_salt ||
          this.session(token)?.email !== user.email
        )
          throw new AuthError('Oturum değişti. Yeniden giriş yapın.', 401);
        this.sqlite
          .prepare(
            'UPDATE administrator SET password_salt=?,password_hash=?,updated_at=? WHERE id=1',
          )
          .run(next.salt, next.hash, this.now());
        this.sqlite.prepare('DELETE FROM sessions').run();
      })();
    } finally {
      this.activeChecks--;
    }
  }
  async login(
    address: string,
    password: string,
    clientAddress: string,
    previousToken?: string,
  ): Promise<{ token: string; user: AuthUser; expiresAt: number }> {
    if (
      typeof address !== 'string' ||
      typeof password !== 'string' ||
      address.length > 254 ||
      Buffer.byteLength(password, 'utf8') > 1024
    )
      throw new AuthError('E-posta ve parola alanlarını kontrol edin.', 400);
    const normalized = address.trim().toLowerCase();
    this.rate(`login-ip:${clientAddress}`, this.loginLimit, this.loginWindowMs);
    this.rate(`login-email:${normalized}`, this.loginLimit, this.loginWindowMs);
    const administrator = this.sqlite
      .prepare('SELECT email,password_salt,password_hash FROM administrator WHERE id=1')
      .get() as { email: string; password_salt: string; password_hash: string } | undefined;
    const matching = administrator?.email === normalized;
    if (this.activeChecks >= 4)
      throw new AuthError('Giriş işlemleri yoğun. Biraz sonra yeniden deneyin.', 429, 1);
    let valid = false;
    this.activeChecks++;
    try {
      valid = await verifyPassword(
        password,
        matching
          ? { salt: administrator!.password_salt, hash: administrator!.password_hash }
          : this.dummy,
      );
    } finally {
      this.activeChecks--;
    }
    if (!matching || !valid) throw new AuthError('E-posta veya parola hatalı.', 401);
    const token = randomBytes(32).toString('base64url'),
      time = this.now(),
      expiresAt = time + this.sessionTtlMs;
    this.sqlite.transaction(() => {
      const current = this.sqlite
        .prepare('SELECT email,password_salt,password_hash FROM administrator WHERE id=1')
        .get() as typeof administrator;
      if (
        !current ||
        current.email !== administrator!.email ||
        current.password_hash !== administrator!.password_hash ||
        current.password_salt !== administrator!.password_salt
      )
        throw new AuthError('E-posta veya parola hatalı.', 401);
      this.sqlite.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time);
      if (previousToken) this.logout(previousToken);
      this.sqlite
        .prepare(
          'INSERT INTO sessions(token_hash,administrator_id,created_at,expires_at) VALUES (?,1,?,?)',
        )
        .run(tokenHash(token), time, expiresAt);
    })();
    return { token, user: { email: administrator!.email, role: 'ADMIN' }, expiresAt };
  }
  session(token: string | undefined): AuthUser | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const digest = tokenHash(token),
      time = this.now();
    const row = this.sqlite
      .prepare(
        'SELECT administrator.email,sessions.expires_at FROM sessions JOIN administrator ON administrator.id=sessions.administrator_id WHERE sessions.token_hash=?',
      )
      .get(digest) as { email: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at <= time) {
      this.sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest);
      return null;
    }
    return { email: row.email, role: 'ADMIN' };
  }
  logout(token: string | undefined) {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
      this.sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  }
}
