import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FinanceService } from './core/service';

interface MaintenanceOptions {
  root?: string;
  now?: Date;
}
interface BackupMetadata {
  formatVersion: 1;
  sourcePath: string;
  schema: string;
  createdAt: string;
}
type DatabaseSource = Pick<FinanceService, 'databasePath' | 'sqlite'>;
function rootFor(path: string, root?: string) {
  return root ? resolve(root) : resolve(dirname(path), '..');
}
function canonical(path: string) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}
function schema(sqlite: Database.Database): string {
  const records = sqlite
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  return createHash('sha256')
    .update(JSON.stringify({ version: sqlite.pragma('user_version', { simple: true }), records }))
    .digest('hex');
}
function assertIntegrity(sqlite: Database.Database) {
  if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok')
    throw new Error('Yedek SQLite bütünlük doğrulamasını geçemedi.');
  if ((sqlite.pragma('foreign_key_check') as unknown[]).length !== 0)
    throw new Error('Yedekte geçersiz yabancı anahtar referansları var.');
}
function atomicWrite(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export async function backupDatabase(
  source: DatabaseSource,
  options: MaintenanceOptions = {},
): Promise<string> {
  const root = rootFor(source.databasePath, options.root);
  const directory = join(root, 'backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const now = options.now ?? new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const base = join(directory, `finance-${date}-${time}`);
  let path = `${base}.sqlite`,
    suffix = 1;
  // Reserve the filename exclusively, so separate CLI/API processes cannot collide.
  for (;;) {
    if (existsSync(`${path}.metadata.json`)) {
      path = `${base}-${suffix++}.sqlite`;
      continue;
    }
    try {
      closeSync(openSync(path, 'wx', 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      path = `${base}-${suffix++}.sqlite`;
    }
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  let metadataCreated = false;
  try {
    // SQLite creates a consistent snapshot, including committed WAL data, without copying a live file.
    source.sqlite.prepare('VACUUM INTO ?').run(temporary);
    chmodSync(temporary, 0o600);
    const snapshot = new Database(temporary, { readonly: true });
    let fingerprint: string;
    try {
      assertIntegrity(snapshot);
      fingerprint = schema(snapshot);
    } finally {
      snapshot.close();
    }
    const metadata: BackupMetadata = {
      formatVersion: 1,
      sourcePath: canonical(source.databasePath),
      schema: fingerprint,
      createdAt: now.toISOString(),
    };
    writeFileSync(`${path}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    metadataCreated = true;
    renameSync(temporary, path);
    return path;
  } catch (error) {
    if (metadataCreated) rmSync(`${path}.metadata.json`, { force: true });
    rmSync(path, { force: true });
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function assertApiStopped(databasePath: string, root?: string) {
  const marker = root
    ? join(resolve(root), 'data', 'api.pid')
    : join(dirname(resolve(databasePath)), 'api.pid');
  if (!existsSync(marker)) return;
  let pid: number;
  try {
    const content = readFileSync(marker, 'utf8');
    const entry = JSON.parse(content);
    pid = typeof entry === 'number' ? entry : entry.pid;
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Geçersiz süreç işareti');
  } catch {
    throw new Error(
      'API süreç işareti doğrulanamadı. Geri yüklemeden önce uygulamayı durdurun ve eski data/api.pid dosyasını kaldırın.',
    );
  }
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw new Error('API durumunu kontrol edemiyorum. Geri yüklemeden önce uygulamayı durdurun.');
  }
  throw new Error(
    'Yerel API çalışıyor. Yedek geri yüklemeden önce uygulamayı Ctrl+C ile durdurun.',
  );
}

export async function restoreDatabase(
  databasePath: string,
  backupPath: string,
  options: MaintenanceOptions = {},
): Promise<{ path: string; safetyBackup: string }> {
  databasePath = canonical(databasePath);
  assertApiStopped(databasePath, options.root);
  const claimPath = join(dirname(databasePath), 'api.pid.claim');
  try {
    writeFileSync(claimPath, JSON.stringify({ pid: process.pid, databasePath }), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    throw new Error(
      'Veritabanı başlatma/bakım kilidi kullanımda. Diğer API veya geri yükleme işlemini durdurun.',
    );
  }
  try {
    return await restoreUnlocked(databasePath, backupPath, options);
  } finally {
    rmSync(claimPath, { force: true });
  }
}

async function restoreUnlocked(
  databasePath: string,
  backupPath: string,
  options: MaintenanceOptions,
): Promise<{ path: string; safetyBackup: string }> {
  databasePath = canonical(databasePath);
  backupPath = canonical(backupPath);
  assertApiStopped(databasePath, options.root);
  if (databasePath === backupPath)
    throw new Error('Yedek, etkin veritabanından farklı bir dosya olmalıdır.');
  if (!existsSync(databasePath))
    throw new Error(
      'Hedef veritabanı bulunamadı. Geri yüklemeden önce uygulamayı bir kez başlatın.',
    );
  if (!existsSync(backupPath) || !existsSync(`${backupPath}.metadata.json`))
    throw new Error('Yedek ve .metadata.json yan dosyası birlikte gereklidir.');
  let metadata: BackupMetadata;
  try {
    metadata = JSON.parse(readFileSync(`${backupPath}.metadata.json`, 'utf8'));
  } catch {
    throw new Error('Yedek üstverisi geçersiz.');
  }
  if (metadata.formatVersion !== 1 || canonical(metadata.sourcePath ?? '') !== databasePath)
    throw new Error('Yedeğin kaynak veritabanı yolu bu veritabanıyla eşleşmiyor.');
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  const active = new Database(databasePath, { fileMustExist: true });
  let safetyBackup: string;
  const temporary = `${databasePath}.${randomUUID()}.restore`;
  try {
    try {
      assertIntegrity(backup);
      if (schema(backup) !== metadata.schema || schema(active) !== metadata.schema)
        throw new Error('Yedek şeması etkin veritabanı şemasıyla eşleşmiyor.');
      safetyBackup = await backupDatabase({ databasePath, sqlite: active }, options);
      const checkpoint = active.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
      if (checkpoint.some((row) => row.busy))
        throw new Error('Veritabanı meşgul. Geri yüklemeden önce tüm finans komutlarını durdurun.');
      // VACUUM handles a backup opened in WAL mode during inspection, too.
      backup.prepare('VACUUM INTO ?').run(temporary);
      chmodSync(temporary, 0o600);
    } finally {
      active.close();
      backup.close();
    }
    assertApiStopped(databasePath, options.root);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    renameSync(temporary, databasePath);
    return { path: databasePath, safetyBackup };
  } finally {
    rmSync(temporary, { force: true });
  }
}

function csvCell(value: unknown, monetary = false): string {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Text beginning with formula or control characters is quoted as literal spreadsheet text.
  const safeDecimal = monetary && /^-?\d+(?:\.\d+)?$/.test(text);
  if (!safeDecimal && (/^[=+\-@\t\r\n]/.test(text) || /^\s+[=+\-@]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export async function exportFinancialState(
  service: FinanceService,
  options: MaintenanceOptions = {},
): Promise<{ snapshot: string; csv: string }> {
  const directory = join(rootFor(service.databasePath, options.root), 'exports');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = service.snapshot();
  const paths = {
    snapshot: join(directory, 'financial_snapshot.json'),
    csv: join(directory, 'transactions.csv'),
  };
  const columns = [
    'id',
    'timestamp',
    'type',
    'amount',
    'currency',
    'amountTRY',
    'exchangeRate',
    'category',
    'description',
    'accountId',
    'destinationAccountId',
    'destinationAmount',
    'debtId',
    'counterparty',
    'paymentMethod',
    'notes',
    'scope',
    'debtComponent',
    'obligationId',
    'subscriptionId',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];
  const transactions = state.transactions as unknown as Record<string, unknown>[];
  const monetaryColumns = new Set(['amount', 'amountTRY', 'destinationAmount', 'exchangeRate']);
  const csv =
    [
      columns.map((column) => csvCell(column)).join(','),
      ...transactions.map((transaction) =>
        columns
          .map((column) => csvCell(transaction[column], monetaryColumns.has(column)))
          .join(','),
      ),
    ].join('\r\n') + '\r\n';
  atomicWrite(paths.snapshot, `${JSON.stringify(state, null, 2)}\n`);
  atomicWrite(paths.csv, csv);
  return paths;
}
