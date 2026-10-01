import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import type { Account, DebtType, TransactionInput } from '../shared/types';

let service: FinanceService;
const timestamp = '2026-10-01T09:00:00.000Z';
const transaction = (
  type: TransactionInput['type'],
  amount: string,
  extra: Partial<TransactionInput> = {},
) =>
  service.createTransaction({
    type,
    amount,
    currency: 'TRY',
    description: type,
    timestamp,
    ...extra,
  });
function accounts(debt = '0', bankOpening = '5000') {
  const bank = service.createAccount({
    name: 'DenizBank TL',
    type: 'BANK',
    currency: 'TRY',
    openingBalance: bankOpening,
  });
  const card = service.createAccount({
    name: 'DenizBank kredi kartı',
    type: 'CREDIT_CARD',
    currency: 'TRY',
    currentDebt: debt,
  });
  const linked = service.listDebts().find((item) => item.accountId === card.id)!;
  return { bank, card, debt: linked };
}
function current(account: Account) {
  return service.listAccounts().find((item) => item.id === account.id)!;
}
function zero(value: string | undefined) {
  return value ?? '0.00';
}
function sources() {
  return {
    transactions: service.listTransactions(),
    deleted: service.listTransactions({ deleted: true }),
    accounts: service.listAccounts(),
    debts: service.listDebts(),
    audit: service.listAudit(),
  };
}

beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => {
  service.close();
  vi.useRealTimers();
});

describe('credit-card money deposited before spending', () => {
  it('moves 3000 TRY from a bank onto a zero-debt card without inventing debt or consumption', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    const context = service.getContext();
    expect(current(bank).currentBalance).toBe('2000.00');
    expect(current(card)).toMatchObject({ currentBalance: '3000.00', currentDebt: '0.00' });
    expect(context.debts[0]).toMatchObject({
      currentBalance: '-3000.00',
      payments: '0.00',
      newUsage: '0.00',
      netChange: '-3000.00',
    });
    expect(context.metrics.availableCash.TRY).toBe('2000.00');
    expect(context.metrics.assets.TRY).toBe('5000.00');
    expect(zero(context.metrics.debt.TRY)).toBe('0.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('5000.00');
    expect(context.metrics.netCashFlow.TRY).toBe('-3000.00');
    expect(zero(context.metrics.debtPayments.TRY)).toBe('0.00');
    expect(zero(context.metrics.cashOutflow.TRY)).toBe('0.00');
    expect(context.metrics.income).toEqual({});
    expect(context.metrics.expenses).toEqual({});
  });

  it('splits actual repayment from the excess amount deposited on the card', () => {
    const { bank, card, debt } = accounts('1000');
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    const { metrics, debts } = service.getContext();
    expect(current(card)).toMatchObject({ currentBalance: '2000.00', currentDebt: '0.00' });
    expect(debts[0]).toMatchObject({ currentBalance: '-2000.00', payments: '1000.00' });
    expect(metrics.debtPayments.TRY).toBe('1000.00');
    expect(metrics.cashOutflow.TRY).toBe('1000.00');
    expect(metrics.netCashFlow.TRY).toBe('-3000.00');
    expect(metrics.assets.TRY).toBe('4000.00');
    expect(metrics.netFinancialPosition.TRY).toBe('4000.00');
    expect(metrics.expenses).toEqual({});
  });

  it('does not subtract one card credit from an unrelated loan or another card debt', () => {
    const { bank, debt } = accounts();
    service.createDebt({ name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '1000' });
    service.createAccount({
      name: 'Other card',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      currentDebt: '500',
    });
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    const { metrics } = service.getContext();
    expect(metrics.debt.TRY).toBe('1500.00');
    expect(metrics.assets.TRY).toBe('5000.00');
    expect(metrics.availableCash.TRY).toBe('2000.00');
    expect(metrics.netFinancialPosition.TRY).toBe('3500.00');
  });

  it('spends card credit before creating new principal debt', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    transaction('EXPENSE', '1000', { accountId: card.id });
    let context = service.getContext();
    expect(current(card).currentBalance).toBe('2000.00');
    expect(context.debts[0].newUsage).toBe('0.00');
    expect(zero(context.metrics.debtUsage.TRY)).toBe('0.00');
    expect(context.metrics.expenses.TRY).toBe('1000.00');
    expect(context.metrics.assets.TRY).toBe('4000.00');
    transaction('EXPENSE', '2500', { accountId: card.id, timestamp: '2026-10-02T09:00:00Z' });
    context = service.getContext();
    expect(current(card)).toMatchObject({ currentBalance: '-500.00', currentDebt: '500.00' });
    expect(context.debts[0].newUsage).toBe('500.00');
    expect(context.metrics.debtUsage.TRY).toBe('500.00');
    expect(context.metrics.expenses.TRY).toBe('3500.00');
    expect(context.metrics.availableCash.TRY).toBe('2000.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('1500.00');
  });

  it('allows a refund to cross from outstanding debt into card credit', () => {
    const { card, debt } = accounts('500');
    transaction('REFUND', '1000', { accountId: card.id });
    const context = service.getContext();
    expect(current(card)).toMatchObject({ currentBalance: '500.00', currentDebt: '0.00' });
    expect(context.debts.find((item) => item.id === debt.id)?.currentBalance).toBe('-500.00');
    expect(zero(context.metrics.debt.TRY)).toBe('0.00');
    expect(context.metrics.assets.TRY).toBe('5500.00');
    expect(context.metrics.expenses.TRY).toBe('-1000.00');
    expect(context.metrics.income).toEqual({});
    expect(context.metrics.debtPayments).toEqual({});
  });

  it('keeps full interest and fee charges when they are paid from card credit', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    transaction('EXPENSE', '5', { accountId: card.id, debtComponent: 'INTEREST' });
    transaction('EXPENSE', '3', { accountId: card.id, debtComponent: 'FEE' });
    transaction('EXPENSE', '100', { accountId: card.id });
    const context = service.getContext();
    expect(context.debts[0]).toMatchObject({ interest: '5.00', fees: '3.00', newUsage: '0.00' });
    expect(current(card).currentBalance).toBe('2892.00');
    expect(context.metrics.expenses.TRY).toBe('108.00');
    expect(zero(context.metrics.debtUsage.TRY)).toBe('0.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('4892.00');
  });

  it('settles foreign purchases and refunds from a TRY card using the actual TRY charge', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    transaction('EXPENSE', '24', { accountId: card.id, currency: 'USD', amountTRY: '1000' });
    let context = service.getContext();
    expect(context.metrics.expenses.USD).toBe('24.00');
    expect(current(card).currentBalance).toBe('2000.00');
    expect(zero(context.metrics.debtUsage.TRY)).toBe('0.00');
    expect(context.metrics.assets.TRY).toBe('4000.00');
    transaction('REFUND', '24', { accountId: card.id, currency: 'USD', amountTRY: '1000' });
    context = service.getContext();
    expect(context.metrics.expenses.USD).toBe('0.00');
    expect(current(card).currentBalance).toBe('3000.00');
    expect(context.metrics.assets.TRY).toBe('5000.00');
    expect(context.metrics.assets.USD).toBeUndefined();
  });

  it('supports credit balances on a standalone credit-card debt without a duplicated asset', () => {
    const bank = service.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '5000',
    });
    const card = service.createDebt({
      name: 'Standalone card',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      openingBalance: '1000',
    });
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: card.id });
    const context = service.getContext();
    expect(context.accounts).toHaveLength(1);
    expect(context.debts[0]).toMatchObject({ currentBalance: '-2000.00', payments: '1000.00' });
    expect(context.metrics.availableCash.TRY).toBe('2000.00');
    expect(context.metrics.assets.TRY).toBe('4000.00');
    expect(zero(context.metrics.debt.TRY)).toBe('0.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('4000.00');
  });

  it('withdraws prepaid card money before recording any new borrowing', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    transaction('DEBT_USAGE', '1000', { accountId: bank.id, debtId: debt.id });
    let context = service.getContext();
    expect(current(bank).currentBalance).toBe('3000.00');
    expect(current(card).currentBalance).toBe('2000.00');
    expect(context.debts[0].newUsage).toBe('0.00');
    expect(zero(context.metrics.debtUsage.TRY)).toBe('0.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('5000.00');
    transaction('DEBT_USAGE', '2500', { accountId: bank.id, debtId: debt.id });
    context = service.getContext();
    expect(current(bank).currentBalance).toBe('5500.00');
    expect(current(card).currentDebt).toBe('500.00');
    expect(context.debts[0].newUsage).toBe('500.00');
    expect(context.metrics.debtUsage.TRY).toBe('500.00');
    expect(context.metrics.netCashFlow.TRY).toBe('500.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('5000.00');
    expect(context.metrics.income).toEqual({});
    expect(context.metrics.expenses).toEqual({});
  });

  it('permits an explicitly signed card adjustment to create a credit balance', () => {
    const { card } = accounts('500');
    transaction('ADJUSTMENT', '-800', { accountId: card.id });
    const { metrics } = service.getContext();
    expect(current(card)).toMatchObject({ currentBalance: '300.00', currentDebt: '0.00' });
    expect(metrics.assets.TRY).toBe('5300.00');
    expect(zero(metrics.debt.TRY)).toBe('0.00');
    expect(metrics.netFinancialPosition.TRY).toBe('5300.00');
    expect(metrics.income).toEqual({});
    expect(metrics.expenses).toEqual({});
    expect(metrics.netCashFlow).toEqual({});
  });

  it.each(['OVERDRAFT', 'LOAN', 'PERSONAL', 'OTHER'] as DebtType[])(
    'continues rejecting overpayments, over-refunds and negative balances for %s',
    (type) => {
      const debt = service.createDebt({ name: type, type, currency: 'TRY', openingBalance: '10' });
      const before = sources();
      expect(() => transaction('DEBT_PAYMENT', '11', { debtId: debt.id })).toThrow(
        'kalan borcu aşıyor',
      );
      expect(() => transaction('REFUND', '11', { debtId: debt.id })).toThrow('kalan borcu aşıyor');
      expect(() => transaction('ADJUSTMENT', '-11', { debtId: debt.id })).toThrow(
        'kalan borcu aşıyor',
      );
      expect(sources()).toEqual(before);
    },
  );

  it('preserves liability cash-source and transfer restrictions', () => {
    const { bank, card, debt } = accounts();
    expect(() =>
      transaction('TRANSFER', '10', { accountId: bank.id, destinationAccountId: card.id }),
    ).toThrow();
    expect(() =>
      transaction('TRANSFER', '10', { accountId: card.id, destinationAccountId: bank.id }),
    ).toThrow();
    expect(() =>
      transaction('DEBT_PAYMENT', '10', { accountId: card.id, debtId: debt.id }),
    ).toThrow();
    expect(service.listTransactions()).toEqual([]);
  });

  it('retains unsigned opening debt requirements for cards and standalone debts', () => {
    expect(() =>
      service.createAccount({
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        currentDebt: '-1',
      }),
    ).toThrow();
    expect(() =>
      service.createAccount({
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        openingBalance: '-1',
      }),
    ).toThrow();
    expect(() =>
      service.createDebt({
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        openingBalance: '-1',
      }),
    ).toThrow();
    expect(service.listAccounts()).toEqual([]);
    expect(service.listDebts()).toEqual([]);
    expect(service.listAudit()).toEqual([]);
  });

  it('derives historical stocks and period borrowing after prepaid funds are consumed', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', {
      accountId: bank.id,
      debtId: debt.id,
      timestamp: '2026-09-30T09:00:00Z',
    });
    transaction('EXPENSE', '3500', { accountId: card.id, timestamp: '2026-10-01T09:00:00Z' });
    const beforePurchase = service.getContext({ to: '2026-09-30' });
    expect(beforePurchase.accounts.find((item) => item.id === card.id)?.currentBalance).toBe(
      '3000.00',
    );
    expect(beforePurchase.metrics.assets.TRY).toBe('5000.00');
    expect(zero(beforePurchase.metrics.debt.TRY)).toBe('0.00');
    const purchaseDay = service.getContext({ from: '2026-10-01', to: '2026-10-01' });
    expect(purchaseDay.openingPosition.TRY).toBe('5000.00');
    expect(purchaseDay.metrics.netFinancialPosition.TRY).toBe('1500.00');
    expect(purchaseDay.positionChange.TRY).toBe('-3500.00');
    expect(purchaseDay.metrics.debtUsage.TRY).toBe('500.00');
    expect(purchaseDay.metrics.debtPayments).toEqual({});
    expect(purchaseDay.charts.daily[0]).toMatchObject({
      cashBalance: { TRY: '2000.00' },
      debtUsage: { TRY: '500.00' },
      expenses: { TRY: '3500.00' },
    });
  });

  it('uses durable insertion order for card deposits and purchases at the same timestamp', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(timestamp));
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    transaction('EXPENSE', '3500', { accountId: card.id });
    const purchaseFirstCard = service.createAccount({
      name: 'Purchase first',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      currentDebt: '0',
    });
    const purchaseFirstDebt = service
      .listDebts()
      .find((item) => item.accountId === purchaseFirstCard.id)!;
    transaction('EXPENSE', '3500', { accountId: purchaseFirstCard.id });
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: purchaseFirstDebt.id });
    const context = service.getContext();
    expect(context.debts.find((item) => item.id === debt.id)).toMatchObject({
      newUsage: '500.00',
      payments: '0.00',
    });
    expect(context.debts.find((item) => item.id === purchaseFirstDebt.id)).toMatchObject({
      newUsage: '3500.00',
      payments: '3000.00',
    });
    expect(context.metrics.debtUsage.TRY).toBe('4000.00');
    expect(context.metrics.debtPayments.TRY).toBe('3000.00');
    expect(context.metrics.debt.TRY).toBe('1000.00');
  });

  it('recalculates credit and borrowing when deposits or purchases are deleted and restored', () => {
    const { bank, card, debt } = accounts();
    const deposit = transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    const purchase = transaction('EXPENSE', '1000', { accountId: card.id });
    service.deleteTransaction(deposit.id);
    expect(current(card).currentDebt).toBe('1000.00');
    expect(service.getContext().metrics.debtUsage.TRY).toBe('1000.00');
    service.restoreTransaction(deposit.id);
    expect(current(card).currentBalance).toBe('2000.00');
    expect(zero(service.getContext().metrics.debtUsage.TRY)).toBe('0.00');
    service.deleteTransaction(purchase.id);
    expect(current(card).currentBalance).toBe('3000.00');
    expect(service.getContext().metrics.expenses).toEqual({});
    service.restoreTransaction(purchase.id);
    expect(current(card).currentBalance).toBe('2000.00');
    expect(service.getContext().metrics.expenses.TRY).toBe('1000.00');
  });

  it('recalculates the real repayment when a prepaid deposit is edited', () => {
    const { bank, card, debt } = accounts('1000');
    const deposit = transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    service.updateTransaction(deposit.id, { amount: '500' });
    expect(current(bank).currentBalance).toBe('4500.00');
    expect(current(card).currentDebt).toBe('500.00');
    expect(service.getContext().metrics.debtPayments.TRY).toBe('500.00');
    service.updateTransaction(deposit.id, { amount: '3000' });
    expect(current(card).currentBalance).toBe('2000.00');
    expect(service.getContext().metrics.debtPayments.TRY).toBe('1000.00');
    expect(service.getContext().metrics.netFinancialPosition.TRY).toBe('4000.00');
  });

  it('preserves prepaid credit for a no-op debt setter and rebases a positive snapshot from the signed balance', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    service.updateAccount(card.id, { currentDebt: '0' });
    expect(current(card)).toMatchObject({
      openingBalance: '0.00',
      currentBalance: '3000.00',
      currentDebt: '0.00',
    });
    expect(service.listDebts()[0]).toMatchObject({
      openingBalance: '0.00',
      currentBalance: '-3000.00',
      payments: '0.00',
    });
    expect(service.getContext().metrics.assets.TRY).toBe('5000.00');
    service.updateAccount(card.id, { currentDebt: '500' });
    expect(current(card)).toMatchObject({
      openingBalance: '3500.00',
      currentBalance: '-500.00',
      currentDebt: '500.00',
    });
    expect(service.listDebts()[0]).toMatchObject({
      openingBalance: '3500.00',
      currentBalance: '500.00',
      payments: '3000.00',
    });
    expect(service.getContext().metrics.assets.TRY).toBe('2000.00');
  });

  it('preserves prepaid credit when editing card details without an explicit debt snapshot', () => {
    const { bank, card, debt } = accounts();
    transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
    service.updateAccount(card.id, { name: 'Renamed card', creditLimit: '10000' });
    expect(current(card)).toMatchObject({
      name: 'Renamed card',
      openingBalance: '0.00',
      currentBalance: '3000.00',
      currentDebt: '0.00',
      creditLimit: '10000.00',
    });
    expect(service.getContext().metrics.assets.TRY).toBe('5000.00');
  });

  it('rejects current-debt rebases requiring a negative opening debt without changing sources', () => {
    const { card } = accounts();
    transaction('EXPENSE', '500', { accountId: card.id });
    const before = sources();
    expect(() => service.updateAccount(card.id, { currentDebt: '100' })).toThrow(
      'açılış borcunu negatif',
    );
    expect(sources()).toEqual(before);
  });

  it('rolls a valid card deposit and its audit back if another debt is overpaid in the same operation', () => {
    const { bank, debt } = accounts();
    const loan = service.createDebt({
      name: 'Loan',
      type: 'LOAN',
      currency: 'TRY',
      openingBalance: '10',
    });
    const before = sources();
    let depositAccepted = false;
    expect(() =>
      service.sqlite.transaction(() => {
        transaction('DEBT_PAYMENT', '3000', { accountId: bank.id, debtId: debt.id });
        depositAccepted = true;
        transaction('DEBT_PAYMENT', '11', { accountId: bank.id, debtId: loan.id });
      })(),
    ).toThrow('kalan borcu aşıyor');
    expect(depositAccepted).toBe(true);
    expect(sources()).toEqual(before);
  });

  it('still rejects deleting a noncard draw needed for a later repayment', () => {
    const loan = service.createDebt({
      name: 'Loan',
      type: 'LOAN',
      currency: 'TRY',
      openingBalance: '0',
    });
    const draw = transaction('DEBT_USAGE', '10', { debtId: loan.id });
    transaction('DEBT_PAYMENT', '10', { debtId: loan.id, timestamp: '2026-10-02T09:00:00Z' });
    const before = sources();
    expect(() => service.deleteTransaction(draw.id)).toThrow('kalan borcu aşıyor');
    expect(sources()).toEqual(before);
  });

  it('rejects asset total overflow caused by a card refund and rolls the source write back', () => {
    const { card } = accounts('0', '90071992547409.91');
    const before = sources();
    expect(() => transaction('REFUND', '0.01', { accountId: card.id })).toThrow(
      'güvenli hesaplama sınırını',
    );
    expect(sources()).toEqual(before);
  });
});
