import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';

let service: FinanceService;
beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => service.close());
const obligation = (category: string, active = true) =>
  service.createObligation({
    name: 'Aidat',
    amount: '100',
    currency: 'TRY',
    frequency: 'MONTHLY',
    dueDate: '2026-10-01',
    category,
    active,
  });
const subscription = (category: string, active = true) =>
  service.createSubscription({
    service: 'İnternet',
    amount: '50',
    currency: 'TRY',
    frequency: 'MONTHLY',
    nextRenewal: '2026-10-01',
    category,
    active,
  });
const payment = {
  type: 'EXPENSE',
  amount: '100',
  currency: 'TRY',
  description: 'Ödeme',
  timestamp: '2026-10-01T12:00:00Z',
} as const;

describe('scheduled classification follows managed label names', () => {
  it('renames matching active, inactive and deleted definitions with auditable source edits while preserving transaction categories', () => {
    const label = service.createLabel({ name: 'İŞ GİDERİ' });
    const active = obligation(' iş  gideri ');
    const inactive = subscription('İş gideri', false);
    const deleted = obligation('İŞ GİDERİ');
    service.deleteObligation(deleted.id);
    const other = subscription('Başka etiket');
    const saved = service.createTransaction({
      ...payment,
      category: 'Dokunulmamış tarihsel alan',
      labelId: label.id,
    });
    const before = service.getContext().metrics;
    const oldActive = service.listObligations().find((item) => item.id === active.id)!;
    service.updateLabel(label.id, { name: 'İş giderleri' });
    expect(service.listObligations().find((item) => item.id === active.id)).toMatchObject({
      category: 'İş giderleri',
      createdAt: oldActive.createdAt,
      dueDate: oldActive.dueDate,
      amount: oldActive.amount,
    });
    expect(service.listObligations().find((item) => item.id === active.id)?.updatedAt).not.toBe(
      oldActive.updatedAt,
    );
    expect(service.listSubscriptions().find((item) => item.id === inactive.id)).toMatchObject({
      category: 'İş giderleri',
      active: false,
    });
    expect(
      service.sqlite
        .prepare('SELECT category,deleted_at FROM obligations WHERE id=?')
        .get(deleted.id),
    ).toMatchObject({ category: 'İş giderleri', deleted_at: expect.any(String) });
    expect(service.listSubscriptions().find((item) => item.id === other.id)?.category).toBe(
      'Başka etiket',
    );
    expect(service.getTransaction(saved.id).category).toBe('Dokunulmamış tarihsel alan');
    expect(service.getContext().metrics).toEqual(before);
    expect(service.listAudit(active.id).at(-1)).toMatchObject({
      action: 'EDIT',
      before: { category: ' iş  gideri ' },
      after: { category: 'İş giderleri' },
    });
    expect(service.payObligation(active.id, payment).labelId).toBe(label.id);
    service.updateSubscription(inactive.id, { active: true });
    expect(service.paySubscription(inactive.id, { ...payment, amount: '50' }).labelId).toBe(
      label.id,
    );
  });

  it('moves archived-only historical names without stealing matching schedules from an active replacement label', () => {
    const old = service.createLabel({ name: 'Ev' });
    service.archiveLabel(old.id);
    const inactive = subscription('Ev', false);
    service.updateLabel(old.id, { name: 'Geçmiş ev' });
    expect(service.listSubscriptions().find((item) => item.id === inactive.id)?.category).toBe(
      'Geçmiş ev',
    );
    const activeLabel = service.createLabel({ name: 'Geçmiş ev' });
    const current = obligation('Geçmiş ev');
    service.updateLabel(old.id, { name: 'Eski ev' });
    expect(service.listObligations().find((item) => item.id === current.id)?.category).toBe(
      'Geçmiş ev',
    );
    expect(service.listSubscriptions().find((item) => item.id === inactive.id)?.category).toBe(
      'Geçmiş ev',
    );
    expect(service.payObligation(current.id, payment).labelId).toBe(activeLabel.id);
  });

  it('keeps catalog, schedules and audits unchanged on name collision or a later schedule write failure', () => {
    const label = service.createLabel({ name: 'Ev' });
    service.createLabel({ name: 'Market' });
    obligation('Ev');
    subscription('Ev');
    const before = service.snapshot();
    expect(() => service.updateLabel(label.id, { name: 'MARKET' })).toThrow('etkin bir etiket');
    expect(service.snapshot().labels).toEqual(before.labels);
    expect(service.snapshot().obligations).toEqual(before.obligations);
    expect(service.snapshot().subscriptions).toEqual(before.subscriptions);
    expect(service.snapshot().audit).toEqual(before.audit);
    service.sqlite.exec(
      "CREATE TRIGGER fail_schedule_label BEFORE UPDATE ON subscriptions WHEN NEW.category='Yeni ev' BEGIN SELECT RAISE(ABORT,'etiket senkronizasyon hatası'); END;",
    );
    expect(() => service.updateLabel(label.id, { name: 'Yeni ev' })).toThrow('senkronizasyon');
    expect(service.snapshot().labels).toEqual(before.labels);
    expect(service.snapshot().obligations).toEqual(before.obligations);
    expect(service.snapshot().subscriptions).toEqual(before.subscriptions);
    expect(service.snapshot().audit).toEqual(before.audit);
  });
});
