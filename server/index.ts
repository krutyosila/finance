import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createApp } from './app';
import { FinanceService } from './core/service';
import { PROJECT_ROOT } from './core/database';
import { assertApiStopped } from './maintenance';

let databasePath = resolve(process.env.FINANCE_DB ?? join(PROJECT_ROOT, 'data/finance.sqlite'));
const port = Number(process.env.FINANCE_PORT ?? '4317');
let pidPath = join(dirname(databasePath), 'api.pid');
function releaseMarker() {
  if (!existsSync(pidPath)) return;
  try {
    if (JSON.parse(readFileSync(pidPath, 'utf8')).pid === process.pid) rmSync(pidPath);
  } catch {
    /* Başka bir sürecin işaretini koru. */
  }
}
function start() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('FINANCE_PORT, 1024 ile 65535 arasında bir tam sayı olmalıdır.');
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  databasePath = existsSync(databasePath)
    ? realpathSync(databasePath)
    : join(realpathSync(dirname(databasePath)), basename(databasePath));
  pidPath = join(dirname(databasePath), 'api.pid');
  const claimPath = `${pidPath}.claim`;
  // Eski marker temizliği de özel başlatma kilidi içinde yapılır.
  try {
    writeFileSync(claimPath, JSON.stringify({ pid: process.pid, databasePath }), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    throw new Error(
      'Bu veritabanı için başka bir API başlatılıyor. Eski api.pid.claim dosyası kaldıysa süreçlerin durduğunu kontrol edin.',
    );
  }
  try {
    if (existsSync(pidPath)) {
      assertApiStopped(databasePath);
      rmSync(pidPath);
    }
    // Dinlemeye/veritabanı açmaya başlamadan önce atomik olarak sahiplen.
    writeFileSync(pidPath, JSON.stringify({ pid: process.pid, databasePath }), {
      mode: 0o600,
      flag: 'wx',
    });
  } finally {
    rmSync(claimPath, { force: true });
  }
  let service: FinanceService | undefined;
  try {
    service = new FinanceService(databasePath);
    const finance = service;
    const app = createApp(finance);
    const closeAuth = () => {
      if (app.locals.authOwned && app.locals.authService?.sqlite.open)
        app.locals.authService.close();
    };
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Still Finance API hazır: http://127.0.0.1:${port}`);
    });
    server.on('error', (error) => {
      console.error(error.message);
      closeAuth();
      finance.close();
      releaseMarker();
      process.exitCode = 1;
    });
    let stopping = false;
    function stop() {
      if (stopping) return;
      stopping = true;
      server.close(() => {
        closeAuth();
        finance.close();
        releaseMarker();
        process.exit(0);
      });
      server.closeIdleConnections();
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    service?.close();
    releaseMarker();
    throw error;
  }
}
try {
  start();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'API başlatılamadı.');
  process.exitCode = 1;
}
