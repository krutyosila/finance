#!/usr/bin/env node
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const databasePath = resolve(process.env.FINANCE_AUTH_DB ?? 'data/auth.sqlite');
const financePath = resolve(process.env.FINANCE_DB ?? 'data/finance.sqlite');
const directory = resolve(
  process.env.FINANCE_AUTH_BACKUP_DIR ?? join(dirname(financePath), '..', 'auth-backups'),
);
let source;
let destination;
let temporary;
try {
  if (!existsSync(databasePath))
    throw new Error('Kimlik veritabanı bulunamadı; boş yedek oluşturulmadı.');
  source = new Database(databasePath, { readonly: true, fileMustExist: true });
  if (source.pragma('integrity_check', { simple: true }) !== 'ok')
    throw new Error('Kimlik veritabanı bütünlük doğrulamasını geçemedi.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = join(
    directory,
    `auth-${new Date()
      .toISOString()
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z')}`,
  );
  let suffix = 0;
  for (;;) {
    destination = `${base}${suffix ? `-${suffix}` : ''}.sqlite`;
    try {
      closeSync(openSync(destination, 'wx', 0o600));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      suffix++;
    }
  }
  temporary = `${destination}.${randomUUID()}.tmp`;
  source.prepare('VACUUM INTO ?').run(temporary);
  chmodSync(temporary, 0o600);
  const check = new Database(temporary, { readonly: true, fileMustExist: true });
  try {
    if (check.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('Kimlik yedeği doğrulanamadı.');
  } finally {
    check.close();
  }
  renameSync(temporary, destination);
  console.log(JSON.stringify({ path: destination }));
} catch (error) {
  if (destination) rmSync(destination, { force: true });
  console.error(
    JSON.stringify({ error: error instanceof Error ? error.message : 'Kimlik yedeklenemedi.' }),
  );
  process.exitCode = 1;
} finally {
  source?.close();
  if (temporary) rmSync(temporary, { force: true });
}
