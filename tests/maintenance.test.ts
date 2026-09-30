import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { FinanceService } from '../server/core/service';
import { backupDatabase, exportFinancialState, restoreDatabase } from '../server/maintenance';

const roots: string[] = [];
const services: FinanceService[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'finance-maintenance-'));
  roots.push(root);
  const databasePath = join(root, 'data', 'finance.sqlite');
  const service = new FinanceService(databasePath);
  services.push(service);
  return { root, service, databasePath };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
describe('local database maintenance', () => {
  it('allows only one API process per database, including symlink aliases, and keeps its restore protection marker', async () => {
    const { service, databasePath, root } = setup();
    const backup = await backupDatabase(service);
    service.close();
    const project = fileURLToPath(new URL('..', import.meta.url));
    const freePort = () =>
      new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            server.close();
            reject(new Error('No port'));
            return;
          }
          server.close(() => resolve(address.port));
        });
      });
    const firstPort = await freePort();
    let secondPort = await freePort();
    while (secondPort === firstPort) secondPort = await freePort();
    writeFileSync(join(root, 'data', 'api.pid'), JSON.stringify({ pid: 999999999, databasePath }));
    const start = (port: number, path = databasePath) =>
      spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        cwd: project,
        env: { ...process.env, FINANCE_DB: path, FINANCE_PORT: String(port) },
      });
    const first = start(firstPort);
    let second: ReturnType<typeof spawn> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('API startup timed out')), 5000);
        first.stdout.on('data', (data) => {
          if (String(data).includes('API hazır')) {
            clearTimeout(timer);
            resolve();
          }
        });
        first.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        first.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`API exited ${code}`));
        });
      });
      const alias = join(root, 'alias', 'finance.sqlite');
      mkdirSync(dirname(alias));
      symlinkSync(databasePath, alias);
      second = start(secondPort, alias);
      const exit = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Second API did not reject a database already in use')),
          3000,
        );
        second!.once('exit', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        second!.stdout!.on('data', (data) => {
          if (String(data).includes('API hazır')) {
            clearTimeout(timer);
            resolve(0);
          }
        });
        second!.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      expect(exit).not.toBe(0);
      expect(JSON.parse(readFileSync(join(root, 'data', 'api.pid'), 'utf8')).pid).toBe(first.pid);
      await expect(restoreDatabase(databasePath, backup)).rejects.toThrow(/çalışıyor|durdurun/i);
    } finally {
      const children = [first, second].filter(
        (child): child is ReturnType<typeof spawn> => !!child,
      );
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null) {
                resolve();
                return;
              }
              child.once('exit', () => resolve());
              child.kill('SIGTERM');
            }),
        ),
      );
    }
  });
  it('keeps backups distinct when separate CLI processes choose a name concurrently', async () => {
    const { service, databasePath, root } = setup();
    service.close();
    const marker = join(root, 'release-backups');
    const project = fileURLToPath(new URL('..', import.meta.url));
    const script = `
      import { existsSync, writeFileSync } from 'node:fs';
      import { FinanceService } from ${JSON.stringify(join(project, 'server/core/service.ts'))};
      import { backupDatabase } from ${JSON.stringify(join(project, 'server/maintenance.ts'))};
      const service = new FinanceService(process.env.FINANCE_DB);
      const originalPrepare = service.sqlite.prepare.bind(service.sqlite);
      service.sqlite.prepare = (sql) => {
        const statement = originalPrepare(sql);
        if (sql === 'VACUUM INTO ?') {
          const originalRun = statement.run.bind(statement);
          statement.run = (...args) => {
            writeFileSync(process.env.BACKUP_READY, 'ready');
            while (!existsSync(process.env.BACKUP_RELEASE)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            return originalRun(...args);
          };
        }
        return statement;
      };
      try { console.log(await backupDatabase(service, { now: new Date('2026-09-30T10:11:00Z') })); }
      finally { service.close(); }
    `;
    const ready = [join(root, 'a-ready'), join(root, 'b-ready')];
    const completions = ready.map(
      (path) =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', '--input-type=module', '-e', script],
            {
              cwd: project,
              env: {
                ...process.env,
                FINANCE_DB: databasePath,
                BACKUP_READY: path,
                BACKUP_RELEASE: marker,
              },
            },
          );
          let output = '',
            error = '';
          child.stdout.on('data', (chunk) => {
            output += chunk;
          });
          child.stderr.on('data', (chunk) => {
            error += chunk;
          });
          child.on('error', reject);
          child.on('close', (code) =>
            code === 0 ? resolve(output.trim()) : reject(new Error(error)),
          );
        }),
    );
    const deadline = Date.now() + 5000;
    while (ready.some((path) => !existsSync(path)) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    writeFileSync(marker, 'release');
    const paths = await Promise.all(completions);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths.every((path) => existsSync(path) && existsSync(`${path}.metadata.json`))).toBe(
      true,
    );
  });
  it('creates collision-safe, consistent SQLite backups including committed WAL records', async () => {
    const { service } = setup();
    service.createTransaction({
      type: 'INCOME',
      amount: '50.00',
      currency: 'TRY',
      description: 'Payment',
    });
    const a = await backupDatabase(service, { now: new Date('2026-09-30T10:11:00Z') });
    const b = await backupDatabase(service, { now: new Date('2026-09-30T10:11:00Z') });
    expect(a).not.toBe(b);
    expect(a).toMatch(/finance-2026-09-30-\d{4}\.sqlite$/);
    const backup = new FinanceService(a);
    expect(backup.listTransactions()).toHaveLength(1);
    backup.close();
    const raw = new Database(a, { readonly: true });
    expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    raw.close();
  });
  it('saves full state and CSV with spreadsheet-safe text and decimal money', async () => {
    const { service } = setup();
    const transaction = service.createTransaction({
      type: 'EXPENSE',
      amount: '24.10',
      currency: 'USD',
      description: '=HYPERLINK("evil")',
      category: '+Services',
    });
    service.deleteTransaction(transaction.id);
    service.createTransaction({
      type: 'ADJUSTMENT',
      amount: '-10.00',
      currency: 'TRY',
      description: 'Signed correction',
    });
    const paths = await exportFinancialState(service);
    const snapshot = JSON.parse(readFileSync(paths.snapshot, 'utf8'));
    expect(snapshot.transactions).toHaveLength(2);
    expect(
      snapshot.transactions.find((record: { id: string }) => record.id === transaction.id)
        .deletedAt,
    ).toBeTruthy();
    expect(snapshot.audit.length).toBeGreaterThan(0);
    const csv = readFileSync(paths.csv, 'utf8');
    expect(csv).toContain('24.10');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+Services");
    expect(csv).toContain('"-10.00"');
    expect(csv).not.toContain("'-10.00");
  });
  it('validates and restores a backup while retaining a safety backup of the current database', async () => {
    const { service, databasePath } = setup();
    const backup = await backupDatabase(service);
    service.createTransaction({
      type: 'INCOME',
      amount: '50',
      currency: 'TRY',
      description: 'Later payment',
    });
    service.close();
    const result = await restoreDatabase(databasePath, backup);
    expect(existsSync(result.safetyBackup)).toBe(true);
    const restored = new FinanceService(databasePath);
    expect(restored.listTransactions()).toHaveLength(0);
    restored.close();
    const safety = new FinanceService(result.safetyBackup);
    expect(safety.listTransactions()).toHaveLength(1);
    safety.close();
  });
  it('refuses active API, wrong source and invalid backups without overwriting records', async () => {
    const { service, root, databasePath } = setup();
    const backup = await backupDatabase(service);
    service.createTransaction({
      type: 'INCOME',
      amount: '75',
      currency: 'TRY',
      description: 'Keep me',
    });
    const pidFile = join(root, 'data', 'api.pid');
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, databasePath }));
    await expect(restoreDatabase(databasePath, backup)).rejects.toThrow(/çalışıyor|durdurun/i);
    rmSync(pidFile);
    const other = setup();
    await expect(restoreDatabase(other.databasePath, backup)).rejects.toThrow(/kaynak|veritabanı/i);
    const metadata = `${backup}.metadata.json`;
    writeFileSync(
      metadata,
      JSON.stringify({ sourcePath: databasePath, schema: 'wrong', formatVersion: 1 }),
    );
    await expect(restoreDatabase(databasePath, backup)).rejects.toThrow(/şema/i);
    expect(service.listTransactions()).toHaveLength(1);
  });

  it('refuses restoration during an API startup claim', async () => {
    const { service, root, databasePath } = setup();
    const backup = await backupDatabase(service);
    service.close();
    writeFileSync(
      join(root, 'data', 'api.pid.claim'),
      JSON.stringify({ pid: process.pid, databasePath }),
    );
    await expect(restoreDatabase(databasePath, backup)).rejects.toThrow(
      /kilit|başlatılıyor|işlem/i,
    );
  });
});
