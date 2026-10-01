import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FinanceService } from '../server/core/service';

const roots: string[] = [];
const time = '2026-09-01T12:00:00.000Z';
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function legacyDatabase() {
  const root = mkdtempSync(join(tmpdir(), 'finance-category-label-migration-'));
  roots.push(root);
  const path = join(root, 'legacy.sqlite');
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  for (const file of ['0001_initial.sql', '0002_ai_entry_receipts.sql', '0003_labels.sql'])
    db.exec(readFileSync(resolve('server/migrations', file), 'utf8'));
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'legacy'),(2,'legacy'),(3,'legacy')",
  );
  const label = (id: string, name: string, archived = false) =>
    db
      .prepare(
        'INSERT INTO labels(id,name,normalized_name,description,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        name,
        name.normalize('NFKC').toLocaleLowerCase('tr'),
        null,
        Number(archived),
        time,
        time,
      );
  const transaction = (
    id: string,
    category: string,
    labelId: string | null = null,
    deleted = false,
  ) =>
    db
      .prepare(
        `INSERT INTO transactions(id,timestamp,type,amount_minor,currency,category,label_id,description,notes,scope,debt_component,created_at,updated_at,deleted_at)
     VALUES(?,?,'EXPENSE',12345,'TRY',?,?,?,'Saklanan not','PERSONAL','PRINCIPAL',?,?,?)`,
      )
      .run(id, time, category, labelId, `Eski işlem ${id}`, time, time, deleted ? time : null);
  return { path, db, label, transaction };
}

describe('one-time legacy category classification migration', () => {
  it('backfills legacy categories including deleted history without changing financial source or audit fields', () => {
    const { path, db, transaction } = legacyDatabase();
    transaction('active', '  Market alışverişi  ');
    transaction('deleted', 'Market alışverişi', null, true);
    transaction('empty', '   ');
    db.prepare(
      "INSERT INTO audit VALUES('old-audit','TRANSACTION','active','CREATE','{\"before\":true}','{\"after\":true}',?)",
    ).run(time);
    const before = db.prepare('SELECT * FROM transactions ORDER BY id').all() as Record<
      string,
      unknown
    >[];
    const audit = db.prepare('SELECT * FROM audit').all();
    db.close();
    const service = new FinanceService(path);
    try {
      const labels = service.listLabels(true);
      expect(labels).toHaveLength(1);
      expect(labels[0].name).toBe('Market alışverişi');
      expect(service.getTransaction('active').labelId).toBe(labels[0].id);
      expect(service.getTransaction('deleted').labelId).toBe(labels[0].id);
      expect(service.getTransaction('empty').labelId).toBeNull();
      const after = service.sqlite
        .prepare('SELECT * FROM transactions ORDER BY id')
        .all() as Record<string, unknown>[];
      expect(after.map(({ label_id: _ignored, ...row }) => row)).toEqual(
        before.map(({ label_id: _ignored, ...row }) => row),
      );
      expect(service.sqlite.prepare('SELECT * FROM audit').all()).toEqual(audit);
      expect(service.sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(service.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      service.close();
    }
  });

  it('reuses Turkish and compatibility-equivalent catalog names, preferring active labels without changing explicit assignments', () => {
    const { path, db, label, transaction } = legacyDatabase();
    label('archived-work', 'İŞ GİDERİ', true);
    label('active-work', 'İŞ GİDERİ');
    label('archived-abc', 'ＡＢＣ', true);
    label('explicit', 'Başka etiket');
    transaction('work', ' iş   gideri ');
    transaction('compatibility', 'abc');
    transaction('explicit-tx', 'İş gideri', 'explicit');
    db.close();
    const service = new FinanceService(path);
    try {
      expect(service.getTransaction('work').labelId).toBe('active-work');
      expect(service.getTransaction('compatibility').labelId).toBe('archived-abc');
      expect(service.getTransaction('explicit-tx').labelId).toBe('explicit');
      expect(service.listLabels(true)).toHaveLength(4);
      expect(service.listLabels(true).find((entry) => entry.id === 'archived-abc')?.archived).toBe(
        true,
      );
    } finally {
      service.close();
    }
  });

  it('respects deliberate label clearing recorded by a prior edit or scan', () => {
    const { path, db, transaction } = legacyDatabase();
    transaction('cleared', 'Market');
    transaction('never-labeled', 'Market');
    db.prepare("INSERT INTO audit VALUES('clear-audit','TRANSACTION','cleared','EDIT',?,?,?)").run(
      JSON.stringify({ labelId: 'previous-label', category: 'Market' }),
      JSON.stringify({ labelId: null, category: 'Market' }),
      time,
    );
    db.close();
    const service = new FinanceService(path);
    try {
      expect(service.getTransaction('cleared').labelId).toBeNull();
      expect(service.getTransaction('never-labeled').labelId).toBe(service.listLabels()[0]?.id);
    } finally {
      service.close();
    }
  });

  it('preserves full legacy category names beyond the new-label entry limit and remains idempotent', () => {
    const { path, db, transaction } = legacyDatabase();
    const name = 'Eski kategori '.padEnd(100, 'x');
    transaction('long', name);
    db.close();
    const first = new FinanceService(path);
    let snapshot;
    try {
      expect(first.listLabels()[0]?.name).toBe(name);
      expect(first.getTransaction('long').category).toBe(name);
      expect(first.getTransaction('long').labelId).toBe(first.listLabels()[0]?.id);
      const labelId = first.listLabels()[0].id;
      expect(first.updateLabel(labelId, { description: 'Açıklama güncellendi' })).toMatchObject({
        name,
        description: 'Açıklama güncellendi',
      });
      expect(first.updateLabel(labelId, { name, description: 'İsim aynen korunuyor' }).name).toBe(
        name,
      );
      expect(() => first.updateLabel(labelId, { name: 'y'.repeat(81) })).toThrow();
      expect(first.archiveLabel(labelId).name).toBe(name);
      snapshot = first.snapshot();
    } finally {
      first.close();
    }
    const reopened = new FinanceService(path);
    try {
      expect(reopened.snapshot().labels).toEqual(snapshot?.labels);
      expect(reopened.snapshot().transactions).toEqual(snapshot?.transactions);
      expect(reopened.snapshot().audit).toEqual(snapshot?.audit);
      reopened.updateTransaction('long', { labelId: null });
      expect(() => reopened.createLabel({ name: 'x'.repeat(81) })).toThrow();
    } finally {
      reopened.close();
    }
    const cleared = new FinanceService(path);
    try {
      expect(cleared.getTransaction('long').labelId).toBeNull();
      expect(
        cleared.sqlite.prepare('SELECT version FROM schema_migrations WHERE version=4').all(),
      ).toHaveLength(1);
    } finally {
      cleared.close();
    }
  });

  it('imports unspent recurring and subscription classification names without changing the plan source', () => {
    const { path, db } = legacyDatabase();
    db.prepare(
      "INSERT INTO obligations(id,name,amount_minor,currency,frequency,due_date,category,active,scope,created_at,updated_at) VALUES('old-recurring','Aidat',10000,'TRY','MONTHLY','2026-10-01',' ev  gideri ',1,'PERSONAL',?,?)",
    ).run(time, time);
    const longName = 'Eski abonelik '.padEnd(150, 'x');
    db.prepare(
      "INSERT INTO subscriptions(id,service,amount_minor,currency,frequency,next_renewal,category,active,scope,created_at,updated_at) VALUES('old-subscription','İnternet',5000,'TRY','MONTHLY','2026-10-01',?,1,'PERSONAL',?,?)",
    ).run(longName, time, time);
    const schedules = {
      obligations: db.prepare('SELECT * FROM obligations').all(),
      subscriptions: db.prepare('SELECT * FROM subscriptions').all(),
    };
    db.close();
    const service = new FinanceService(path);
    try {
      const labels = service.listLabels();
      expect(labels.map((item) => item.name).sort()).toEqual(['ev gideri', longName].sort());
      expect(service.sqlite.prepare('SELECT * FROM obligations').all()).toEqual(
        schedules.obligations,
      );
      expect(service.sqlite.prepare('SELECT * FROM subscriptions').all()).toEqual(
        schedules.subscriptions,
      );
      expect(service.listAudit()).toEqual([]);
      expect(service.getContext().expenses).toEqual({});
      const payment = {
        type: 'EXPENSE',
        amount: '100',
        currency: 'TRY',
        description: 'Ödeme',
        timestamp: '2026-10-01T12:00:00Z',
      } as const;
      expect(service.payObligation('old-recurring', payment).labelId).toBe(
        labels.find((item) => item.name === 'ev gideri')?.id,
      );
      expect(
        service.paySubscription('old-subscription', { ...payment, amount: '50' }).labelId,
      ).toBe(labels.find((item) => item.name === longName)?.id);
      service.updateSubscription('old-subscription', { nextRenewal: '2026-11-01' });
      expect(
        service.paySubscription('old-subscription', {
          ...payment,
          amount: '50',
          timestamp: '2026-11-01T12:00:00Z',
          labelId: null,
        }).labelId,
      ).toBeNull();
    } finally {
      service.close();
    }
  });

  it('rolls back replacement and backfill together if final reference validation fails', () => {
    const { path, db, transaction } = legacyDatabase();
    db.pragma('foreign_keys = OFF');
    transaction('broken-link', 'Market', 'missing-label');
    transaction('needs-backfill', 'Ev');
    const rows = db.prepare('SELECT * FROM transactions ORDER BY id').all();
    const labelSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='labels'").get();
    db.close();
    expect(() => new FinanceService(path)).toThrow('geçersiz kayıt bağlantısı');
    const reopened = new Database(path);
    try {
      expect(reopened.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(rows);
      expect(reopened.prepare('SELECT * FROM labels').all()).toEqual([]);
      expect(reopened.prepare("SELECT sql FROM sqlite_master WHERE name='labels'").get()).toEqual(
        labelSchema,
      );
      expect(
        reopened.prepare("SELECT name FROM sqlite_master WHERE name='labels_next'").all(),
      ).toEqual([]);
      expect(
        reopened.prepare('SELECT version FROM schema_migrations WHERE version=4').all(),
      ).toEqual([]);
      expect(reopened.pragma('defer_foreign_keys', { simple: true })).toBe(0);
    } finally {
      reopened.close();
    }
  });
});
