import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];
const script = fileURLToPath(new URL('../scripts/backup-auth.mjs', import.meta.url));
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
describe('sunucu dağıtım yardımcıları', () => {
  it('kimlik doğrulama WAL kayıtlarını ayrı, özel izinli ve çakışmayan SQLite yedeklerine alır', () => {
    const root = mkdtempSync(join(tmpdir(), 'finance-auth-backup-'));
    roots.push(root);
    const authPath = join(root, 'auth.sqlite');
    const database = new Database(authPath);
    database.pragma('journal_mode = WAL');
    database.exec(
      "CREATE TABLE admins (hash TEXT NOT NULL); INSERT INTO admins VALUES ('hashed-test-placeholder')",
    );
    const command = () =>
      JSON.parse(
        execFileSync(process.execPath, [script], {
          encoding: 'utf8',
          env: {
            ...process.env,
            FINANCE_DB: join(root, 'data', 'finance.sqlite'),
            FINANCE_AUTH_DB: authPath,
          },
        }),
      );
    try {
      const first = command();
      const second = command();
      expect(first.path).not.toBe(second.path);
      expect(first.path).toContain(join(root, 'auth-backups'));
      expect(statSync(first.path).mode & 0o777).toBe(0o600);
      const backup = new Database(first.path, { readonly: true });
      try {
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(backup.prepare('SELECT hash FROM admins').get()).toEqual({
          hash: 'hashed-test-placeholder',
        });
      } finally {
        backup.close();
      }
      expect(existsSync(join(root, 'data', 'finance.sqlite'))).toBe(false);
    } finally {
      database.close();
    }
  });

  it('kimlik veritabanı yoksa yeni veritabanı veya boş kimlik yedeği oluşturmaz', () => {
    const root = mkdtempSync(join(tmpdir(), 'finance-auth-missing-'));
    roots.push(root);
    const path = join(root, 'missing.sqlite');
    expect(() =>
      execFileSync(process.execPath, [script], {
        stdio: 'pipe',
        env: {
          ...process.env,
          FINANCE_AUTH_DB: path,
          FINANCE_DB: join(root, 'data', 'finance.sqlite'),
        },
      }),
    ).toThrow();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(root, 'auth-backups'))).toBe(false);
  });

  it('güncelleme betiği sözdizimi geçerliyken eksik kurulumda veri veya hizmet değiştirmeden durur', () => {
    const path = fileURLToPath(new URL('../scripts/deploy-update.sh', import.meta.url));
    execFileSync('bash', ['-n', path], { stdio: 'pipe' });
    const root = mkdtempSync(join(tmpdir(), 'finance-deploy-missing-'));
    roots.push(root);
    expect(() =>
      execFileSync('bash', [path], {
        stdio: 'pipe',
        env: {
          ...process.env,
          FINANCE_INSTALL_ROOT: root,
          FINANCE_ENV_FILE: join(root, 'missing.env'),
        },
      }),
    ).toThrow();
    expect(
      readFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'utf8'),
    ).toContain('.local/');
    expect(existsSync(join(root, 'releases'))).toBe(false);
  });
});
