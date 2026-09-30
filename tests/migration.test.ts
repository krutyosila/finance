import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
it('migrates FINANCE_DB in a temporary directory without touching the default database', () => {
  const root = mkdtempSync(join(tmpdir(), 'finance-migration-test-')),
    target = join(root, 'configured.sqlite'),
    decoy = join(root, 'obsolete-env.sqlite'),
    personal = resolve('data/finance.sqlite');
  const fingerprint = () =>
      existsSync(personal)
        ? { mtime: statSync(personal).mtimeMs, size: statSync(personal).size }
        : null,
    before = fingerprint();
  try {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'server/migrate.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, FINANCE_DB: target, FINANCE_DB_PATH: decoy },
      encoding: 'utf8',
    });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(decoy)).toBe(false);
    expect(child.stdout).toContain(target);
    expect(fingerprint()).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
