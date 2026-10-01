import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';
import type { TransactionInput } from '../shared/types';

let service: FinanceService;
const transaction = (extra: Partial<TransactionInput> = {}) =>
  service.createTransaction({
    type: 'EXPENSE',
    amount: '100',
    currency: 'TRY',
    description: 'Harcama',
    category: 'Eski kategori',
    ...extra,
  });

beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => service.close());

describe('actual spending by transaction label', () => {
  it('resolves omitted legacy category assignments from the existing active catalog only', () => {
    const label = service.createLabel({ name: 'İŞ GİDERİ' });
    const saved = transaction({ category: ' iş   gideri ' });
    expect(saved.labelId).toBe(label.id);
    expect(transaction({ category: 'İş gideri', labelId: null }).labelId).toBeNull();
    expect(transaction({ category: 'Yeni olmayan tanım' }).labelId).toBeNull();
    service.archiveLabel(label.id);
    expect(transaction({ category: 'İş gideri' }).labelId).toBeNull();
    expect(service.listLabels(true)).toHaveLength(1);
  });

  it('uses an existing label when paying matching scheduled definitions without overriding explicit none', () => {
    const label = service.createLabel({ name: 'Ev gideri' });
    const obligation = service.createObligation({
      name: 'Aidat',
      amount: '100',
      currency: 'TRY',
      category: ' ev   gideri ',
      frequency: 'MONTHLY',
      dueDate: '2026-10-01',
    });
    const subscription = service.createSubscription({
      service: 'İnternet',
      amount: '50',
      currency: 'TRY',
      category: 'Ev gideri',
      frequency: 'MONTHLY',
      nextRenewal: '2026-10-01',
    });
    const input = {
      type: 'EXPENSE',
      amount: '100',
      currency: 'TRY',
      description: 'Ödeme',
      timestamp: '2026-10-01T12:00:00Z',
    } as const;
    expect(service.payObligation(obligation.id, input).labelId).toBe(label.id);
    expect(
      service.paySubscription(subscription.id, { ...input, amount: '50', labelId: null }).labelId,
    ).toBeNull();
    expect(service.listLabels(true)).toHaveLength(1);
  });

  it('has no synthetic label spending before transactions exist', () => {
    service.createLabel({ name: 'Ev' });
    expect(service.getContext().labelTotals).toEqual([]);
  });

  it('nets refunds in their transaction currency and leaves other financial movement out', () => {
    const label = service.createLabel({ name: 'Market' });
    transaction({ amount: '0.10', labelId: label.id });
    transaction({ amount: '0.20', labelId: label.id });
    transaction({ type: 'REFUND', amount: '0.05', labelId: label.id });
    transaction({ amount: '20.25', currency: 'USD', amountTRY: '810.00', labelId: label.id });
    transaction({ type: 'REFUND', amount: '1.25', currency: 'USD', labelId: label.id });
    transaction({ amount: '3.50' });
    transaction({ type: 'INCOME', amount: '1000', labelId: label.id });
    transaction({ type: 'SAVINGS', amount: '10', labelId: label.id });
    const debt = service.createDebt({
      name: 'Borç',
      type: 'LOAN',
      currency: 'TRY',
      openingBalance: '20',
    });
    transaction({ type: 'DEBT_PAYMENT', amount: '10', debtId: debt.id, labelId: label.id });

    const context = service.getContext();
    expect(context.labelTotals).toEqual([
      { labelId: label.id, label: 'Market', totals: { TRY: '0.25', USD: '19.00' } },
      { labelId: null, label: 'Etiketsiz', totals: { TRY: '3.50' } },
    ]);
    expect(context.categoryTotals).toEqual([
      { category: 'Eski kategori', totals: { TRY: '3.75', USD: '19.00' } },
    ]);
    expect(context.metrics.expenses).toEqual({ TRY: '3.75', USD: '19.00' });
  });

  it('groups by stable IDs with current and archived names, independently of category names', () => {
    const oldLabel = service.createLabel({ name: 'Ev' });
    transaction({ labelId: oldLabel.id, category: 'Yiyecek' });
    service.archiveLabel(oldLabel.id);
    const newLabel = service.createLabel({ name: 'Ev' });
    transaction({ amount: '25', labelId: newLabel.id, category: 'Yiyecek' });
    const before = service.getContext();
    expect(before.labelTotals).toEqual([
      { labelId: oldLabel.id, label: 'Ev', totals: { TRY: '100.00' } },
      { labelId: newLabel.id, label: 'Ev', totals: { TRY: '25.00' } },
    ]);
    service.updateLabel(oldLabel.id, { name: 'Geçmiş ev' });
    expect(service.getContext().labelTotals?.[0]).toEqual({
      labelId: oldLabel.id,
      label: 'Geçmiş ev',
      totals: { TRY: '100.00' },
    });
    expect(service.getContext().categoryTotals).toEqual(before.categoryTotals);
    expect(service.getContext().metrics).toEqual(before.metrics);
  });

  it('matches selected periods and excludes deleted records without altering balances', () => {
    const label = service.createLabel({ name: 'Ev' });
    transaction({ amount: '200', labelId: label.id, timestamp: '2026-09-30T12:00:00Z' });
    const current = transaction({
      amount: '50',
      labelId: label.id,
      timestamp: '2026-10-01T12:00:00Z',
    });
    transaction({
      type: 'REFUND',
      amount: '10',
      labelId: label.id,
      timestamp: '2026-10-02T12:00:00Z',
    });
    transaction({ amount: '500', labelId: label.id, timestamp: '2026-10-03T12:00:00Z' });
    const options = { from: '2026-10-01', to: '2026-10-02' };
    expect(service.getContext(options).labelTotals).toEqual([
      { labelId: label.id, label: 'Ev', totals: { TRY: '40.00' } },
    ]);
    service.deleteTransaction(current.id);
    expect(service.getContext(options).labelTotals).toEqual([
      { labelId: label.id, label: 'Ev', totals: { TRY: '-10.00' } },
    ]);
    service.restoreTransaction(current.id);
    expect(service.getContext(options).labelTotals?.[0].totals).toEqual({ TRY: '40.00' });
  });

  it('includes the complete period beyond the recent-transaction display limit', () => {
    const label = service.createLabel({ name: 'Ulaşım' });
    for (let index = 0; index < 25; index++) transaction({ amount: '1', labelId: label.id });
    const context = service.getContext();
    expect(context.recentTransactions).toHaveLength(20);
    expect(context.labelTotals).toEqual([
      { labelId: label.id, label: 'Ulaşım', totals: { TRY: '25.00' } },
    ]);
  });
});
