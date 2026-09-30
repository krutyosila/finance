import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import type { TransactionInput } from '../shared/types';
let service: FinanceService;
const tx = (
  type: TransactionInput['type'],
  amount: string,
  extra: Partial<TransactionInput> = {},
) => service.createTransaction({ type, amount, currency: 'TRY', description: type, ...extra });
beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => service?.close());
describe('source derived financial engine', () => {
  it('starts entirely empty without producing fake daily charts', () => {
    const context = service.getContext();
    expect(context.transactionCount).toBe(0);
    expect(context.accounts).toEqual([]);
    expect(context.debts).toEqual([]);
    expect(context.subscriptions).toEqual([]);
    expect(context.recurringObligations).toEqual([]);
    expect(context.metrics.assets).toEqual({});
    expect(context.charts.daily).toEqual([]);
  });
  it('derives accountless cash from exact income and actual expenses', () => {
    tx('INCOME', '128000');
    tx('EXPENSE', '1200');
    tx('EXPENSE', '0.10');
    tx('EXPENSE', '0.20');
    expect(service.getContext().metrics.availableCash.TRY).toBe('126799.70');
    expect(service.getContext().expenses.TRY).toBe('1200.30');
  });
  it('debt payment reduces cash and debt without counting new consumption', () => {
    const debt = service.createDebt({
      name: 'Loan',
      type: 'LOAN',
      currency: 'TRY',
      openingBalance: '20000',
    });
    tx('INCOME', '30000');
    tx('DEBT_PAYMENT', '15000', { debtId: debt.id });
    const c = service.getContext();
    expect(c.metrics.availableCash.TRY).toBe('15000.00');
    expect(c.metrics.debt.TRY).toBe('5000.00');
    expect(c.expenses.TRY ?? '0.00').toBe('0.00');
    expect(c.metrics.netFinancialPosition.TRY).toBe('10000.00');
  });
  it('debt usage creates cash and debt, with no income or expense', () => {
    const debt = service.createDebt({ name: 'KMH', type: 'OVERDRAFT', currency: 'TRY' });
    tx('DEBT_USAGE', '5000', { debtId: debt.id });
    const c = service.getContext();
    expect(c.metrics.availableCash.TRY).toBe('5000.00');
    expect(c.debtUsage.TRY).toBe('5000.00');
    expect(c.income.TRY).toBeUndefined();
    expect(c.expenses.TRY).toBeUndefined();
    expect(c.netFinancialPosition.TRY).toBe('0.00');
  });
  it('credit card purchases increase expense and debt but do not spend available cash', () => {
    const account = service.createAccount({
      name: 'Card',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      currentDebt: '100',
      creditLimit: '50000',
    });
    tx('EXPENSE', '250', { accountId: account.id });
    const c = service.getContext();
    expect(c.debts).toHaveLength(1);
    expect(c.metrics.debt.TRY).toBe('350.00');
    expect(c.expenses.TRY).toBe('250.00');
    expect(c.metrics.cashOutflow.TRY).toBeUndefined();
    expect(c.metrics.assets.TRY).toBeUndefined();
    expect(c.accounts[0].currentBalance).toBe('-350.00');
  });
  it('transfers preserve assets without income, expense, or external cash outflow', () => {
    const a = service.createAccount({
      name: 'A',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const b = service.createAccount({ name: 'B', type: 'CASH', currency: 'TRY' });
    tx('TRANSFER', '300', { accountId: a.id, destinationAccountId: b.id });
    const c = service.getContext();
    expect(c.accounts.find((x) => x.id === a.id)?.currentBalance).toBe('700.00');
    expect(c.accounts.find((x) => x.id === b.id)?.currentBalance).toBe('300.00');
    expect(c.metrics.assets.TRY).toBe('1000.00');
    expect(c.income).toEqual({});
    expect(c.expenses).toEqual({});
    expect(c.cashOutflow).toEqual({});
  });
  it('savings moves assets out of available cash to virtual savings', () => {
    tx('INCOME', '1000');
    tx('SAVINGS', '250');
    const c = service.getContext();
    expect(c.metrics.availableCash.TRY).toBe('750.00');
    expect(c.metrics.savings.TRY).toBe('250.00');
    expect(c.metrics.assets.TRY).toBe('1000.00');
    expect(c.metrics.expenses).toEqual({});
  });
  it('savings account transfers reduce available cash and preserve assets', () => {
    const a = service.createAccount({
      name: 'A',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const b = service.createAccount({ name: 'Saved', type: 'SAVINGS', currency: 'TRY' });
    tx('SAVINGS', '250', { accountId: a.id, destinationAccountId: b.id });
    expect(service.getContext().metrics.availableCash.TRY).toBe('750.00');
    expect(service.getContext().metrics.savings.TRY).toBe('250.00');
    expect(service.getContext().metrics.assets.TRY).toBe('1000.00');
  });
  it('cash refunds restore cash and reduce consumption', () => {
    tx('EXPENSE', '500', { category: 'Shopping' });
    tx('REFUND', '100', { category: 'Shopping' });
    expect(service.getContext().expenses.TRY).toBe('400.00');
    expect(service.getContext().metrics.availableCash.TRY).toBe('-400.00');
  });
  it('preserves foreign currency and accepts only explicit conversions', () => {
    tx('EXPENSE', '24', { currency: 'USD' });
    expect(service.getContext().expenses).toEqual({ USD: '24.00' });
    expect(service.listTransactions()[0].amountTRY).toBeNull();
    const t = tx('EXPENSE', '10', { currency: 'EUR', exchangeRate: '35.1234' });
    expect(t.amountTRY).toBe('351.23');
    expect(service.getContext().expenses.TRY).toBeUndefined();
  });
  it('requires received value for cross currency transfers', () => {
    const a = service.createAccount({
      name: 'A',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const b = service.createAccount({ name: 'USD', type: 'BANK', currency: 'USD' });
    expect(() => tx('TRANSFER', '300', { accountId: a.id, destinationAccountId: b.id })).toThrow();
    tx('TRANSFER', '300', { accountId: a.id, destinationAccountId: b.id, destinationAmount: '10' });
    const c = service.getContext();
    expect(c.metrics.assets).toEqual({ TRY: '700.00', USD: '10.00' });
  });
  it('updates, deletes, restores, duplicates and audits source records', () => {
    const a = tx('INCOME', '1000');
    service.updateTransaction(a.id, { amount: '1200' });
    expect(service.getContext().metrics.availableCash.TRY).toBe('1200.00');
    service.deleteTransaction(a.id);
    expect(service.getContext().transactionCount).toBe(0);
    service.restoreTransaction(a.id);
    expect(service.getContext().metrics.availableCash.TRY).toBe('1200.00');
    service.duplicateTransaction(a.id);
    expect(service.getContext().metrics.availableCash.TRY).toBe('2400.00');
    expect(service.listAudit(a.id).map((x) => x.action)).toEqual([
      'CREATE',
      'EDIT',
      'DELETE',
      'RESTORE',
    ]);
  });
  it('rolls back invalid debt edits/deletes and validates historical debt balances', () => {
    const d = service.createDebt({ name: 'D', type: 'LOAN', currency: 'TRY' });
    const usage = tx('DEBT_USAGE', '100', { debtId: d.id, timestamp: '2026-09-01T12:00:00Z' });
    tx('DEBT_PAYMENT', '80', { debtId: d.id, timestamp: '2026-09-02T12:00:00Z' });
    expect(() => service.updateTransaction(usage.id, { amount: '50' })).toThrow();
    expect(() => service.deleteTransaction(usage.id)).toThrow();
    expect(() => tx('DEBT_PAYMENT', '30', { debtId: d.id })).toThrow();
    expect(service.listDebts()[0].currentBalance).toBe('20.00');
  });
  it('validates foreign keys, amount precision, dates and checked overflow', () => {
    expect(() => tx('EXPENSE', '1', { accountId: 'missing' })).toThrow();
    expect(() => tx('INCOME', '1.001')).toThrow();
    expect(() => tx('INCOME', '1', { timestamp: 'bogus' })).toThrow();
    expect(() => tx('INCOME', '90071992547410')).toThrow();
    tx('INCOME', '90071992547409.90');
    expect(() => tx('INCOME', '0.10')).toThrow();
    expect(service.getContext().transactionCount).toBe(1);
  });
  it('allows signed adjustments without treating them as income or expense', () => {
    tx('ADJUSTMENT', '-10');
    expect(service.getContext().metrics.availableCash.TRY).toBe('-10.00');
    expect(service.getContext().income).toEqual({});
    expect(service.getContext().expenses).toEqual({});
  });
  it('keeps obligations planned until paid with a real transaction and supports renewal', () => {
    const o = service.createObligation({
      name: 'Rent',
      amount: '1000',
      currency: 'TRY',
      frequency: 'MONTHLY',
      dueDate: '2026-09-30',
    });
    expect(service.getContext().expenses).toEqual({});
    const t = service.payObligation(o.id, {
      type: 'EXPENSE',
      amount: '1000',
      currency: 'TRY',
      description: 'Rent',
      timestamp: '2026-09-30T12:00:00Z',
    });
    expect(service.listObligations()[0].status).toBe('PAID');
    service.deleteTransaction(t.id);
    expect(service.listObligations()[0].status).not.toBe('PAID');
    service.restoreTransaction(t.id);
    service.updateObligation(o.id, { dueDate: '2026-10-30' });
    expect(service.listObligations()[0].status).toBe('UPCOMING');
  });
  it('pays subscriptions atomically and cancellation makes no actual expense', () => {
    const s = service.createSubscription({
      service: 'Server',
      amount: '24',
      currency: 'USD',
      frequency: 'YEARLY',
      nextRenewal: '2026-09-30',
      scope: 'BUSINESS',
    });
    service.paySubscription(s.id, {
      type: 'EXPENSE',
      amount: '24',
      currency: 'USD',
      description: 'Server',
      timestamp: '2026-09-30T12:00:00Z',
      scope: 'BUSINESS',
    });
    expect(service.listSubscriptions()[0].status).toBe('PAID');
    expect(service.getContext().scopeTotals.BUSINESS.USD).toBe('24.00');
    service.updateSubscription(s.id, { active: false });
    expect(service.listSubscriptions()[0].status).toBe('CANCELLED');
  });
  it('cycles report actual opening and closing positions and period flows', () => {
    tx('INCOME', '1000', { timestamp: '2026-09-01T12:00:00Z' });
    const c = service.startCycle({ name: 'October', start: '2026-09-10T00:00:00Z' });
    tx('EXPENSE', '100', { timestamp: '2026-09-15T12:00:00Z' });
    service.endCycle(c.id, '2026-09-20T23:59:59Z');
    tx('INCOME', '500', { timestamp: '2026-09-22T12:00:00Z' });
    const context = service.getContext({ cycleId: c.id });
    expect(context.openingPosition.TRY).toBe('1000.00');
    expect(context.netFinancialPosition.TRY).toBe('900.00');
    expect(context.positionChange.TRY).toBe('-100.00');
    expect(context.income).toEqual({});
    expect(context.expenses.TRY).toBe('100.00');
  });
  it('audits every user entity and rejects deleting referenced accounts and debts', () => {
    const a = service.createAccount({ name: 'A', type: 'BANK', currency: 'TRY' });
    service.updateAccount(a.id, { name: 'B' });
    const d = service.createDebt({ name: 'D', type: 'LOAN', currency: 'TRY' });
    tx('DEBT_USAGE', '10', { debtId: d.id, accountId: a.id });
    expect(() => service.deleteAccount(a.id)).toThrow();
    expect(() => service.deleteDebt(d.id)).toThrow();
    expect(service.listAudit(a.id).map((x) => x.action)).toEqual(['CREATE', 'EDIT']);
  });
});
it('reports gross external cash outflow separately from cash refunds', () => {
  tx('INCOME', '1000');
  tx('EXPENSE', '500');
  tx('REFUND', '100');
  tx('SAVINGS', '50');
  const c = service.getContext();
  expect(c.cashOutflow.TRY).toBe('500.00');
  expect(c.expenses.TRY).toBe('400.00');
  expect(c.metrics.netCashFlow.TRY).toBe('550.00');
});
it('rejects entity edits that invalidate existing transaction currency or debt balance', () => {
  const a = service.createAccount({ name: 'A', type: 'BANK', currency: 'TRY' });
  tx('INCOME', '10', { accountId: a.id });
  expect(() => service.updateAccount(a.id, { currency: 'USD' })).toThrow();
  const d = service.createDebt({ name: 'D', type: 'LOAN', currency: 'TRY', openingBalance: '100' });
  tx('DEBT_PAYMENT', '90', { debtId: d.id });
  expect(() => service.updateDebt(d.id, { openingBalance: '50' })).toThrow();
});
it('records interest and fees on debt as real expenses without cash', () => {
  const d = service.createDebt({ name: 'D', type: 'LOAN', currency: 'TRY' });
  tx('EXPENSE', '10', { debtId: d.id, debtComponent: 'INTEREST' });
  tx('EXPENSE', '5', { debtId: d.id, debtComponent: 'FEE' });
  expect(service.listDebts()[0]).toMatchObject({
    currentBalance: '15.00',
    interest: '10.00',
    fees: '5.00',
    newUsage: '0.00',
  });
  expect(service.getContext().expenses.TRY).toBe('15.00');
  expect(service.getContext().cashOutflow).toEqual({});
});
it('uses manually entered opening balances as initial ledger baseline', () => {
  service.createAccount({ name: 'Future', type: 'BANK', currency: 'TRY', openingBalance: '1000' });
  tx('INCOME', '10', { timestamp: '2020-01-01T12:00:00Z' });
  const c = service.getContext({ from: '2020-01-01', to: '2020-01-02' });
  expect(c.metrics.availableCash.TRY).toBe('1010.00');
  expect(c.charts.daily[0].cashBalance.TRY).toBe('1010.00');
});
it('rejects contradictory debt linkage and source destination combinations', () => {
  const a = service.createAccount({ name: 'A', type: 'BANK', currency: 'TRY' });
  const b = service.createAccount({ name: 'B', type: 'BANK', currency: 'TRY' });
  expect(() => tx('TRANSFER', '10', { accountId: a.id, destinationAccountId: a.id })).toThrow();
  expect(() => tx('EXPENSE', '10', { destinationAccountId: b.id })).toThrow();
  const card = service.createAccount({ name: 'Card', type: 'CREDIT_CARD', currency: 'TRY' });
  const d = service.createDebt({ name: 'Other', type: 'LOAN', currency: 'TRY' });
  expect(() => tx('EXPENSE', '10', { accountId: card.id, debtId: d.id })).toThrow();
});
it('settles a foreign purchase from TRY cash only using user supplied charge', () => {
  const a = service.createAccount({
    name: 'TRY',
    type: 'BANK',
    currency: 'TRY',
    openingBalance: '2000',
  });
  expect(() => tx('EXPENSE', '24', { currency: 'USD', accountId: a.id })).toThrow();
  tx('EXPENSE', '24', { currency: 'USD', accountId: a.id, amountTRY: '1000' });
  const c = service.getContext();
  expect(c.metrics.availableCash.TRY).toBe('1000.00');
  expect(c.expenses.USD).toBe('24.00');
  expect(c.cashOutflow.TRY).toBe('1000.00');
});
it('rounds signed explicit conversions away from zero safely', () => {
  expect(tx('ADJUSTMENT', '-1', { currency: 'USD', exchangeRate: '1.005' }).amountTRY).toBe(
    '-1.01',
  );
});
it('withdraws virtual savings with signed SAVINGS without changing assets', () => {
  tx('INCOME', '1000');
  tx('SAVINGS', '300');
  tx('SAVINGS', '-100');
  const c = service.getContext();
  expect(c.metrics.availableCash.TRY).toBe('800.00');
  expect(c.savings.TRY).toBe('200.00');
  expect(c.metrics.assets.TRY).toBe('1000.00');
  expect(() => tx('SAVINGS', '-201')).toThrow();
});
it('preserves actual payments when recurring plans are deleted', () => {
  const o = service.createObligation({
    name: 'Bill',
    amount: '100',
    currency: 'TRY',
    frequency: 'MONTHLY',
    dueDate: '2026-09-30',
  });
  service.payObligation(o.id, {
    type: 'EXPENSE',
    amount: '100',
    currency: 'TRY',
    description: 'Bill',
  });
  service.deleteObligation(o.id);
  expect(service.getContext().expenses.TRY).toBe('100.00');
  const s = service.createSubscription({
    service: 'Server',
    amount: '24',
    currency: 'USD',
    frequency: 'YEARLY',
    nextRenewal: '2026-09-30',
  });
  service.paySubscription(s.id, {
    type: 'EXPENSE',
    amount: '24',
    currency: 'USD',
    description: 'Server',
  });
  service.deleteSubscription(s.id);
  expect(service.getContext().expenses.USD).toBe('24.00');
});
it('rejects liability accounts as cash sources for debt payments or draws', () => {
  const a = service.createAccount({
    name: 'Card',
    type: 'CREDIT_CARD',
    currency: 'TRY',
    currentDebt: '100',
  });
  const d = service.listDebts()[0];
  expect(() => tx('DEBT_PAYMENT', '10', { accountId: a.id, debtId: d.id })).toThrow();
});
it('replays equal timestamps in durable insertion order for deposits and repayments', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
  try {
    const d = service.createDebt({ name: 'D', type: 'LOAN', currency: 'TRY' });
    tx('INCOME', '100');
    for (let i = 0; i < 50; i++) {
      const timestamp = '2026-09-20T12:00:00Z';
      tx('SAVINGS', '1', { timestamp });
      tx('SAVINGS', '-1', { timestamp });
      tx('DEBT_USAGE', '1', { debtId: d.id, timestamp });
      tx('DEBT_PAYMENT', '1', { debtId: d.id, timestamp });
    }
    expect(service.getContext().savings.TRY).toBe('0.00');
    expect(service.listDebts()[0].currentBalance).toBe('0.00');
  } finally {
    vi.useRealTimers();
  }
});
it('counts principal card purchases as newly created debt, keeping interest separate', () => {
  const a = service.createAccount({ name: 'Card', type: 'CREDIT_CARD', currency: 'TRY' });
  tx('EXPENSE', '100', { accountId: a.id });
  tx('EXPENSE', '5', { accountId: a.id, debtComponent: 'INTEREST' });
  expect(service.getContext().debtUsage.TRY).toBe('100.00');
  expect(service.getContext().metrics.debt.TRY).toBe('105.00');
});
it('rejects rolled-over invalid timestamp calendar days', () => {
  expect(() => tx('INCOME', '10', { timestamp: '2026-02-30T12:00:00Z' })).toThrow();
});
it('rejects savings overdrafts and opposite-signed received savings amounts', () => {
  const saved = service.createAccount({
    name: 'Saved',
    type: 'SAVINGS',
    currency: 'TRY',
    openingBalance: '10',
  });
  expect(() => tx('EXPENSE', '11', { accountId: saved.id })).toThrow();
  const usd = service.createAccount({
    name: 'USD saved',
    type: 'SAVINGS',
    currency: 'USD',
    openingBalance: '100',
  });
  expect(() =>
    tx('SAVINGS', '-10', { destinationAccountId: usd.id, destinationAmount: '1' }),
  ).toThrow();
});
it('rejects a new open cycle that starts before an existing closed cycle', () => {
  const c = service.startCycle({ start: '2026-09-10T00:00:00Z' });
  service.endCycle(c.id, '2026-09-20T00:00:00Z');
  expect(() => service.startCycle({ start: '2026-09-01T00:00:00Z' })).toThrow();
});
it('reports daily balances from one chronological ledger including period opening cash', () => {
  tx('INCOME', '1000', { timestamp: '2026-09-01T12:00:00Z' });
  tx('EXPENSE', '100', { timestamp: '2026-09-02T12:00:00Z' });
  tx('REFUND', '20', { timestamp: '2026-09-02T13:00:00Z' });
  tx('SAVINGS', '50', { timestamp: '2026-09-03T12:00:00Z' });
  const c = service.getContext({ from: '2026-09-02', to: '2026-09-03' });
  expect(c.charts.daily).toMatchObject([
    { date: '2026-09-02', expenses: { TRY: '80.00' }, cashBalance: { TRY: '920.00' } },
    { date: '2026-09-03', cashBalance: { TRY: '870.00' } },
  ]);
});
it('records received cash in its native currency when withdrawing foreign held savings', () => {
  const savings = service.createAccount({
    name: 'USD saved',
    type: 'SAVINGS',
    currency: 'USD',
    openingBalance: '100',
  });
  const cash = service.createAccount({ name: 'TRY', type: 'BANK', currency: 'TRY' });
  tx('TRANSFER', '10', {
    currency: 'USD',
    accountId: savings.id,
    destinationAccountId: cash.id,
    destinationAmount: '400',
  });
  const c = service.getContext();
  expect(c.metrics.netCashFlow).toEqual({ TRY: '400.00' });
  expect(c.metrics.availableCash.TRY).toBe('400.00');
  expect(c.savings.USD).toBe('90.00');
});
it('supports all activity and explicit reports without inheriting active cycle bounds', () => {
  tx('INCOME', '1000', { timestamp: '2026-09-01T12:00:00Z' });
  service.startCycle({ start: '2026-09-10T00:00:00Z' });
  tx('EXPENSE', '100', { timestamp: '2026-09-15T12:00:00Z' });
  expect(service.getContext().income).toEqual({});
  expect(service.getContext({ all: true }).income.TRY).toBe('1000.00');
  expect(service.getContext({ from: '2026-09-01', to: '2026-09-02' }).income.TRY).toBe('1000.00');
});
it('recalculates explicit rate conversions when transaction amount or rate changes', () => {
  const t = tx('EXPENSE', '10', { currency: 'USD', exchangeRate: '30' });
  expect(service.updateTransaction(t.id, { amount: '20' }).amountTRY).toBe('600.00');
  expect(service.updateTransaction(t.id, { exchangeRate: '40' }).amountTRY).toBe('800.00');
  expect(service.updateTransaction(t.id, { amount: '25', amountTRY: '950' }).amountTRY).toBe(
    '950.00',
  );
});

it('uses Turkish defaults while preserving user supplied text and categories', () => {
  const t = tx('EXPENSE', '10', { description: 'Custom description' });
  expect(t.category).toBe('Diğer');
  const custom = tx('EXPENSE', '1', {
    category: 'Food',
    description: 'My words',
    notes: 'Keep these',
  });
  expect(custom.category).toBe('Food');
  expect(custom.description).toBe('My words');
  expect(custom.notes).toBe('Keep these');
  expect(() => service.getTransaction('missing')).toThrow('İşlem bulunamadı');
});
