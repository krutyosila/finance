import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function openDatabase(path = resolve(PROJECT_ROOT, 'data/finance.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  if (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('administrator','sessions','rate_limits')",
      )
      .get()
  ) {
    sqlite.close();
    throw new Error('Finans veritabanı kimlik veritabanından ayrı olmalıdır.');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  for (const [version, file] of [
    [1, '0001_initial.sql'],
    [2, '0002_ai_entry_receipts.sql'],
    [3, '0003_labels.sql'],
  ] as const) {
    const migration = sqlite
      .prepare('SELECT version FROM schema_migrations WHERE version=?')
      .get(version);
    if (!migration)
      sqlite.transaction(() => {
        sqlite.exec(readFileSync(resolve(PROJECT_ROOT, 'server/migrations', file), 'utf8'));
        sqlite
          .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)')
          .run(version, new Date().toISOString());
      })();
  }
  return { sqlite, db: drizzle(sqlite), databasePath: path };
}
