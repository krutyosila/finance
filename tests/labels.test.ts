import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { Express } from 'express';
import { FinanceService } from '../server/core/service';
import { exportFinancialState } from '../server/maintenance';
import { createApp } from '../server/app';
import { AiSettingsService } from '../server/ai/settings';
import { AuthService } from '../server/auth';
import { runCli } from '../server/cli';
import type { Label, LabelScanSuggestion, Transaction, TransactionInput } from '../shared/types';

let finance: FinanceService;
const roots: string[] = [];
const transaction = (extra: Partial<TransactionInput> = {}) =>
  finance.createTransaction({
    type: 'EXPENSE',
    amount: '125.50',
    currency: 'TRY',
    description: 'Market alışverişi',
    category: 'Eski kategori',
    ...extra,
  });
beforeEach(() => {
  finance = new FinanceService(':memory:');
});
afterEach(() => {
  finance.close();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('managed transaction labels', () => {
  it('creates a separate label catalog with trimmed metadata and audited edits', () => {
    expect(finance.listLabels()).toEqual([]);
    const label = finance.createLabel({
      name: '  Ev alışverişi  ',
      description: '  Market ve temizlik  ',
    });
    expect(label).toMatchObject({
      name: 'Ev alışverişi',
      description: 'Market ve temizlik',
      archived: false,
    });
    expect(finance.getContext().labels).toEqual([label]);
    expect(finance.getContext().categoryTotals).toEqual([]);
    const edited = finance.updateLabel(label.id, { name: 'Ev', description: null });
    expect(edited).toMatchObject({ id: label.id, name: 'Ev', description: null });
    expect(finance.listAudit(label.id).map((entry) => entry.action)).toEqual(['CREATE', 'EDIT']);
    expect(finance.listAudit(label.id)[1].before).toMatchObject({ name: 'Ev alışverişi' });
    expect(finance.listAudit(label.id)[1].after).toMatchObject({ name: 'Ev' });
  });

  it('rejects invalid names and Turkish-equivalent active duplicates atomically', () => {
    const label = finance.createLabel({ name: 'İŞ  GİDERİ' });
    const auditCount = finance.listAudit().length;
    expect(() => finance.createLabel({ name: ' iş gideri ' })).toThrow(/etiket/i);
    expect(() => finance.createLabel({ name: '   ' })).toThrow();
    expect(() => finance.createLabel({ name: 'x'.repeat(81) })).toThrow();
    expect(() => finance.createLabel({ name: 'Geçerli', description: 'x'.repeat(501) })).toThrow();
    const other = finance.createLabel({ name: 'Ev' });
    expect(() => finance.updateLabel(other.id, { name: 'iş gideri' })).toThrow(/etiket/i);
    expect(finance.listLabels()).toHaveLength(2);
    expect(finance.listAudit()).toHaveLength(auditCount + 1);
    expect(finance.listLabels().find((item) => item.id === label.id)?.name).toBe('İŞ GİDERİ');
  });

  it('normalizes compatibility characters only for label uniqueness', () => {
    const label = finance.createLabel({ name: 'ＡＢＣ' });
    expect(label.name).toBe('ＡＢＣ');
    expect(() => finance.createLabel({ name: 'abc' })).toThrow(/etiket/i);
  });

  it('keeps labels independent of categories and financial balances on rename', () => {
    const label = finance.createLabel({ name: 'Ev', description: 'Kişisel alışveriş' });
    const saved = transaction({ labelId: label.id });
    const before = finance.getContext();
    finance.updateLabel(label.id, { name: 'Aile' });
    expect(finance.getTransaction(saved.id)).toMatchObject({
      labelId: label.id,
      category: 'Eski kategori',
    });
    expect(finance.getContext().labels?.[0].name).toBe('Aile');
    expect(finance.getContext().metrics).toEqual(before.metrics);
    expect(finance.getContext().categoryTotals).toEqual(before.categoryTotals);
    expect(finance.listTransactions({ search: 'aİle' }).map((item) => item.id)).toEqual([saved.id]);
    expect(finance.listLabels()[0].description).toBe('Kişisel alışveriş');
  });

  it('archives labels while retaining existing links and permitting unrelated transaction edits', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const saved = transaction({ labelId: label.id });
    const archived = finance.archiveLabel(label.id);
    expect(archived.archived).toBe(true);
    expect(finance.listLabels()).toEqual([]);
    expect(finance.listLabels(true)).toEqual([archived]);
    expect(finance.getContext().labels).toEqual([archived]);
    expect(finance.listAudit(label.id).at(-1)?.action).toBe('DELETE');
    expect(() => transaction({ labelId: label.id })).toThrow(/etiket/i);
    expect(finance.updateTransaction(saved.id, { notes: 'Düzeltilmiş not' }).labelId).toBe(
      label.id,
    );
    expect(finance.updateTransaction(saved.id, { labelId: label.id }).labelId).toBe(label.id);
    finance.deleteTransaction(saved.id);
    expect(finance.restoreTransaction(saved.id).labelId).toBe(label.id);
    const replacement = finance.createLabel({ name: 'ev' });
    expect(replacement.id).not.toBe(label.id);
    expect(finance.updateLabel(label.id, { name: 'Geçmiş ev' }).archived).toBe(true);
  });

  it('validates assignments atomically and distinguishes omitted labels from explicit clearing', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const saved = transaction({ labelId: label.id });
    const plain = transaction();
    const before = finance.snapshot();
    expect(() => transaction({ labelId: 'missing-label' })).toThrow(/etiket/i);
    expect(() =>
      finance.updateTransaction(saved.id, { labelId: 'missing-label', amount: '900' }),
    ).toThrow(/etiket/i);
    expect(finance.snapshot().transactions).toEqual(before.transactions);
    expect(finance.listAudit()).toEqual(before.audit);
    expect(finance.updateTransaction(saved.id, { amount: '10' }).labelId).toBe(label.id);
    const archived = finance.archiveLabel(label.id);
    expect(() => finance.updateTransaction(plain.id, { labelId: archived.id })).toThrow(/etiket/i);
    expect(finance.updateTransaction(saved.id, { labelId: null }).labelId).toBeNull();
    expect(finance.getTransaction(plain.id).labelId).toBeNull();
  });

  it('copies active labels and clears archived labels when duplicating', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const saved = transaction({ labelId: label.id });
    expect(finance.duplicateTransaction(saved.id).labelId).toBe(label.id);
    finance.archiveLabel(label.id);
    const duplicate = finance.duplicateTransaction(saved.id);
    expect(duplicate.labelId).toBeNull();
    expect(duplicate.category).toBe(saved.category);
    expect(finance.getTransaction(saved.id).labelId).toBe(label.id);
  });

  it('filters by stable label, archived labels and unassigned transactions', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const first = transaction({ labelId: label.id });
    const second = transaction();
    expect(finance.listTransactions({ labelId: label.id }).map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect(finance.listTransactions({ labelId: 'unassigned' }).map((item) => item.id)).toEqual([
      second.id,
    ]);
    finance.archiveLabel(label.id);
    expect(finance.listTransactions({ labelId: label.id }).map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect(finance.listTransactions({ search: 'ev' }).map((item) => item.id)).toEqual([first.id]);
  });

  it('exports archived label definitions and assignments without losing CSV safety', async () => {
    const root = mkdtempSync(join(tmpdir(), 'finance-label-export-'));
    roots.push(root);
    const label = finance.createLabel({ name: '=Ev', description: 'Özel açıklama' });
    const saved = transaction({ labelId: label.id });
    finance.archiveLabel(label.id);
    finance.deleteTransaction(saved.id);
    const paths = await exportFinancialState(finance, { root });
    const snapshot = JSON.parse(readFileSync(paths.snapshot, 'utf8'));
    expect(snapshot.labels).toEqual(finance.listLabels(true));
    expect(snapshot.sourceRecords.labels[0]).toMatchObject({ id: label.id, name: '=Ev' });
    expect(snapshot.transactions[0]).toMatchObject({
      labelId: label.id,
      category: 'Eski kategori',
    });
    const csv = readFileSync(paths.csv, 'utf8');
    expect(csv.split('\r\n')[0]).toContain('"labelId"');
    expect(csv.split('\r\n')[0]).toContain('"labelName"');
    expect(csv).toContain(label.id);
    expect(csv).toContain("'=Ev");
  });
});

function localApp(auth?: AuthService) {
  const root = mkdtempSync(join(tmpdir(), 'finance-label-api-'));
  roots.push(root);
  return createApp(finance, {
    publicUrl: auth ? 'https://finance.example.com' : null,
    auth,
    aiSettings: new AiSettingsService({
      path: join(root, 'ai.json'),
      databasePath: join(root, 'finance.sqlite'),
    }),
  });
}

function invoke<T = unknown>(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  hosted = false,
  encodedJson = false,
) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = path;
  req.headers = hosted
    ? {
        host: 'finance.example.com',
        origin: 'https://finance.example.com',
        'x-forwarded-proto': 'https',
      }
    : { host: 'localhost:4317', origin: 'http://localhost:4317' };
  if (encodedJson) {
    const encoded = JSON.stringify(body);
    req.headers['content-type'] = 'application/json';
    req.headers['content-length'] = String(Buffer.byteLength(encoded));
    req.push(encoded);
    req.push(null);
  } else Object.assign(req, { body });
  const res = new ServerResponse(req);
  return new Promise<{ status: number; body: T }>((resolve) => {
    res.end = ((chunk: unknown) => {
      resolve({ status: res.statusCode, body: JSON.parse(String(chunk)) as T });
      socket.destroy();
      return res;
    }) as typeof res.end;
    app(req, res);
  });
}

it('serves label CRUD and archived filters through the API', async () => {
  const app = localApp();
  const created = await invoke<Label>(app, 'POST', '/api/labels', {
    name: 'Ev',
    description: 'Market',
  });
  expect(created.status).toBe(201);
  const id = created.body.id;
  const edited = await invoke<Label>(app, 'PATCH', `/api/labels/${id}`, { name: 'Aile' });
  expect(edited).toMatchObject({ status: 200, body: { name: 'Aile', description: 'Market' } });
  const saved = transaction({ labelId: id });
  transaction();
  const filtered = await invoke<{ id: string }[]>(app, 'GET', `/api/transactions?labelId=${id}`);
  expect(filtered.body.map((item) => item.id)).toEqual([saved.id]);
  expect(
    (await invoke<unknown[]>(app, 'GET', '/api/transactions?labelId=unassigned')).body,
  ).toHaveLength(1);
  expect(await invoke<Label>(app, 'DELETE', `/api/labels/${id}`)).toMatchObject({
    status: 200,
    body: { archived: true },
  });
  expect((await invoke<Label[]>(app, 'GET', '/api/labels')).body).toEqual(finance.listLabels(true));
  expect(
    (
      await invoke(app, 'POST', '/api/transactions', {
        type: 'EXPENSE',
        amount: '1',
        currency: 'TRY',
        description: 'Yeni',
        labelId: id,
      })
    ).status,
  ).toBe(400);
});

it('protects every label endpoint with the existing hosted authentication middleware', async () => {
  const auth = new AuthService(':memory:');
  try {
    const app = localApp(auth);
    for (const [method, path] of [
      ['GET', '/api/labels'],
      ['POST', '/api/labels'],
      ['PATCH', '/api/labels/missing'],
      ['DELETE', '/api/labels/missing'],
      ['POST', '/api/ai/labels/apply'],
    ]) {
      expect((await invoke(app, method, path, { name: 'Unauthorized' }, true)).status).toBe(401);
    }
    expect(finance.listLabels(true)).toEqual([]);
    expect(finance.listAudit()).toEqual([]);
  } finally {
    auth.close();
  }
});

it('supports CLI label and unassigned transaction filters', async () => {
  const label = finance.createLabel({ name: 'Ev' });
  const tagged = transaction({ labelId: label.id });
  const plain = transaction();
  for (const [filter, expected] of [
    [label.id, tagged.id],
    ['unassigned', plain.id],
  ]) {
    let output = '';
    let error = '';
    const status = await runCli(['transactions', '--label-id', filter, '--json'], {
      service: finance,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        error += text;
      },
    });
    expect(error).toBe('');
    expect(status).toBe(0);
    expect(JSON.parse(output).map((item: { id: string }) => item.id)).toEqual([expected]);
  }
});

it('migrates existing records additively and backfills their legacy classification once', () => {
  const root = mkdtempSync(join(tmpdir(), 'finance-label-migration-'));
  roots.push(root);
  const path = join(root, 'legacy.sqlite');
  const legacy = new Database(path);
  legacy.exec(readFileSync(resolve('server/migrations/0001_initial.sql'), 'utf8'));
  legacy.exec(readFileSync(resolve('server/migrations/0002_ai_entry_receipts.sql'), 'utf8'));
  legacy.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'legacy'),(2,'legacy')",
  );
  legacy
    .prepare(
      'INSERT INTO transactions(id,timestamp,type,amount_minor,currency,category,description,scope,debt_component,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'old-income',
      '2026-10-01T12:00:00Z',
      'INCOME',
      10000,
      'TRY',
      'Dokunulmasın',
      'Eski gelir',
      'PERSONAL',
      'PRINCIPAL',
      'old',
      'old',
    );
  legacy.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const reopened = new FinanceService(path);
    try {
      expect(reopened.listLabels(true)).toHaveLength(1);
      expect(reopened.listLabels(true)[0].name).toBe('Dokunulmasın');
      expect(reopened.getTransaction('old-income')).toMatchObject({
        amount: '100.00',
        category: 'Dokunulmasın',
        labelId: reopened.listLabels(true)[0].id,
      });
      expect(reopened.getContext().metrics.availableCash).toEqual({ TRY: '100.00' });
      expect(
        reopened.sqlite.prepare('SELECT version FROM schema_migrations WHERE version=3').all(),
      ).toHaveLength(1);
      expect(reopened.sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      reopened.close();
    }
  }
});

const suggestion = (record: Transaction, labelId: string | null): LabelScanSuggestion => ({
  transactionId: record.id,
  labelId,
  previousLabelId: record.labelId ?? null,
  transactionUpdatedAt: record.updatedAt,
});

describe('historical label application', () => {
  it('reevaluates existing labels and clears labels without changing any financial field', () => {
    const firstLabel = finance.createLabel({ name: 'İlk' });
    const secondLabel = finance.createLabel({ name: 'Yeni' });
    const first = transaction({
      labelId: firstLabel.id,
      notes: 'Özel not',
      counterparty: 'Mağaza',
      amountTRY: '125.50',
    });
    const second = transaction({ labelId: firstLabel.id });
    const before = finance.getContext();
    const auditCount = finance.listAudit().length;
    const updated = finance.applyLabelScan([
      suggestion(first, secondLabel.id),
      suggestion(second, null),
    ]);
    expect(updated.map((record) => record.labelId)).toEqual([secondLabel.id, null]);
    for (const [index, original] of [first, second].entries()) {
      const { labelId: _oldLabel, updatedAt: _oldUpdate, ...oldFields } = original;
      const { labelId: _newLabel, updatedAt: _newUpdate, ...newFields } = updated[index];
      expect(newFields).toEqual(oldFields);
      expect(updated[index].updatedAt > original.updatedAt).toBe(true);
    }
    expect(finance.getContext().metrics).toEqual(before.metrics);
    expect(finance.getContext().categoryTotals).toEqual(before.categoryTotals);
    expect(finance.listAudit()).toHaveLength(auditCount + 2);
    expect(finance.listAudit(first.id).at(-1)).toMatchObject({
      action: 'EDIT',
      before: { labelId: firstLabel.id },
      after: { labelId: secondLabel.id },
    });
  });

  it('rejects a stale record and rolls back every assignment and audit entry', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const first = transaction();
    const second = transaction();
    const proposals = [suggestion(first, label.id), suggestion(second, label.id)];
    finance.updateTransaction(second.id, { notes: 'Tarama sırasında değişti' });
    const before = finance.snapshot();
    expect(() => finance.applyLabelScan(proposals)).toThrow(/değiş|tara/i);
    expect(finance.snapshot().transactions).toEqual(before.transactions);
    expect(finance.listAudit()).toEqual(before.audit);
  });

  it('detects description edits made within the same millisecond as the scan', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    try {
      const label = finance.createLabel({ name: 'Ev' });
      const scanned = transaction();
      const proposed = suggestion(scanned, label.id);
      const changed = finance.updateTransaction(scanned.id, {
        description: 'Tamamen farklı işlem',
      });
      expect(changed.updatedAt > scanned.updatedAt).toBe(true);
      expect(() => finance.applyLabelScan([proposed])).toThrow(/değiş|tara/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('revalidates active labels and current assignments before writing', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const first = transaction();
    const second = transaction();
    finance.archiveLabel(label.id);
    const before = finance.snapshot();
    expect(() =>
      finance.applyLabelScan([suggestion(first, null), suggestion(second, label.id)]),
    ).toThrow(/etiket/i);
    expect(() => finance.applyLabelScan([suggestion(first, 'missing-label')])).toThrow(/etiket/i);
    expect(() =>
      finance.applyLabelScan([{ ...suggestion(first, null), previousLabelId: label.id }]),
    ).toThrow(/değiş|tara/i);
    expect(finance.snapshot().transactions).toEqual(before.transactions);
    expect(finance.listAudit()).toEqual(before.audit);
  });

  it('rejects deleted records, duplicate proposals, oversized batches and financial fields', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const first = transaction();
    const proposal = suggestion(first, label.id);
    expect(() => finance.applyLabelScan([proposal, proposal])).toThrow(/benzersiz|tekrar/i);
    expect(() =>
      finance.applyLabelScan([{ ...proposal, amount: '999' } as LabelScanSuggestion]),
    ).toThrow();
    expect(() => finance.applyLabelScan(Array.from({ length: 5001 }, () => proposal))).toThrow();
    finance.deleteTransaction(first.id);
    const before = finance.snapshot();
    expect(() => finance.applyLabelScan([proposal])).toThrow(/etkin|değiş|tara/i);
    expect(finance.snapshot().transactions).toEqual(before.transactions);
    expect(finance.listAudit()).toEqual(before.audit);
  });

  it('leaves unchanged suggestions untouched and accepts an empty batch', () => {
    const label = finance.createLabel({ name: 'Ev' });
    const first = transaction({ labelId: label.id });
    const before = finance.snapshot();
    expect(finance.applyLabelScan([suggestion(first, label.id)])).toEqual([]);
    expect(finance.applyLabelScan([])).toEqual([]);
    expect(finance.snapshot().transactions).toEqual(before.transactions);
    expect(finance.listAudit()).toEqual(before.audit);
  });
});

it('applies historical labels through the API and rejects stale retries with 409', async () => {
  const app = localApp();
  const label = finance.createLabel({ name: 'Ev' });
  const first = transaction();
  const proposal = suggestion(first, label.id);
  expect(await invoke(app, 'POST', '/api/ai/labels/apply', { suggestions: [proposal] })).toEqual({
    status: 200,
    body: { updated: 1 },
  });
  expect(finance.getTransaction(first.id).labelId).toBe(label.id);
  expect(
    (await invoke(app, 'POST', '/api/ai/labels/apply', { suggestions: [proposal] })).status,
  ).toBe(409);
  expect(
    (
      await invoke(app, 'POST', '/api/ai/labels/apply', {
        suggestions: [{ ...suggestion(finance.getTransaction(first.id), null), amount: '999' }],
      })
    ).status,
  ).toBe(400);
});

it('allows bounded bulk JSON beyond 256KB while retaining the smaller limit elsewhere', async () => {
  const app = localApp();
  const first = transaction();
  const body = { suggestions: Array.from({ length: 5001 }, () => suggestion(first, null)) };
  expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(256 * 1024);
  expect((await invoke(app, 'POST', '/api/ai/labels/apply', body, false, true)).status).toBe(400);
  expect(
    (
      await invoke(
        app,
        'POST',
        '/api/labels',
        { name: 'Ev', description: 'x'.repeat(300 * 1024) },
        false,
        true,
      )
    ).status,
  ).toBe(413);
});
