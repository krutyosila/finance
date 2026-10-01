import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';
import type { TransactionInput } from '../shared/types';

let finance: FinanceService;
beforeEach(() => {
  finance = new FinanceService(':memory:');
});
afterEach(() => finance.close());

function loadedCard() {
  const bank = finance.createAccount({
    name: 'DenizBank TL',
    type: 'BANK',
    currency: 'TRY',
    openingBalance: '5000',
  });
  const card = finance.createAccount({
    name: 'DenizBank kredi kartı',
    type: 'CREDIT_CARD',
    currency: 'TRY',
    currentDebt: '0',
  });
  const debt = finance.listDebts()[0];
  finance.createTransaction({
    type: 'DEBT_PAYMENT',
    amount: '3000',
    currency: 'TRY',
    accountId: bank.id,
    debtId: debt.id,
    description: 'Kart yüklemesi',
    timestamp: '2026-09-30T09:00:00Z',
  });
  return { bank, card, debt };
}

function expense(accountId: string, amount: string, extra: Partial<TransactionInput> = {}) {
  return finance.createTransaction({
    type: 'EXPENSE',
    amount,
    currency: 'TRY',
    accountId,
    description: 'Kart alışverişi',
    timestamp: '2026-10-01T09:00:00Z',
    ...extra,
  });
}

describe('prepaid card consumption counts once as asset-funded cash outflow', () => {
  it('counts spending from prepaid funds while excluding the initial deposit', () => {
    const { card } = loadedCard();
    expect(finance.getContext({ all: true }).metrics.cashOutflow.TRY ?? '0.00').toBe('0.00');
    expense(card.id, '1000');
    const { metrics } = finance.getContext({ from: '2026-10-01', to: '2026-10-01' });
    expect(metrics.cashOutflow.TRY).toBe('1000.00');
    expect(metrics.expenses.TRY).toBe('1000.00');
    expect(metrics.debtUsage.TRY ?? '0.00').toBe('0.00');
    expect(metrics.availableCash.TRY).toBe('2000.00');
    expect(metrics.netCashFlow).toEqual({});
  });

  it('counts only the prepaid portion of a mixed purchase and the later actual debt payment', () => {
    const { bank, card, debt } = loadedCard();
    expense(card.id, '3500');
    let context = finance.getContext({ all: true });
    expect(context.metrics.cashOutflow.TRY).toBe('3000.00');
    expect(context.metrics.debtUsage.TRY).toBe('500.00');
    finance.createTransaction({
      type: 'DEBT_PAYMENT',
      amount: '500',
      currency: 'TRY',
      accountId: bank.id,
      debtId: debt.id,
      description: 'Kalan kart borcu ödemesi',
      timestamp: '2026-10-02T09:00:00Z',
    });
    context = finance.getContext({ all: true });
    expect(context.metrics.cashOutflow.TRY).toBe('3500.00');
    expect(context.metrics.debtPayments.TRY).toBe('500.00');
    expect(context.metrics.expenses.TRY).toBe('3500.00');
  });

  it('uses the actual TRY charge for foreign spending and keeps refunds out of gross outflow', () => {
    const { card } = loadedCard();
    expense(card.id, '24', { currency: 'USD', amountTRY: '1000' });
    finance.createTransaction({
      type: 'REFUND',
      amount: '24',
      currency: 'USD',
      amountTRY: '1000',
      accountId: card.id,
      description: 'Kart iadesi',
      timestamp: '2026-10-02T09:00:00Z',
    });
    const { metrics } = finance.getContext({ all: true });
    expect(metrics.cashOutflow).toEqual({ TRY: '1000.00' });
    expect(metrics.expenses.USD).toBe('0.00');
    expect(metrics.assets.TRY).toBe('5000.00');
  });

  it('counts prepaid-funded interest and fee expenses without calling them new borrowing', () => {
    const { card } = loadedCard();
    expense(card.id, '5', { debtComponent: 'INTEREST' });
    expense(card.id, '3', { debtComponent: 'FEE' });
    const { metrics, debts } = finance.getContext({ all: true });
    expect(metrics.cashOutflow.TRY).toBe('8.00');
    expect(metrics.debtUsage.TRY ?? '0.00').toBe('0.00');
    expect(debts[0]).toMatchObject({ interest: '5.00', fees: '3.00' });
  });

  it.each([false, true])(
    'rejects signed debt-change overflow atomically even with a later card withdrawal: %s',
    (futureWithdrawal) => {
      const maximum = '90071992547409.91';
      const bank = finance.createAccount({
        name: 'Bank',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: maximum,
      });
      const card = finance.createAccount({
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        currentDebt: maximum,
      });
      const debt = finance.listDebts()[0];
      finance.createTransaction({
        type: 'DEBT_PAYMENT',
        amount: maximum,
        currency: 'TRY',
        accountId: bank.id,
        debtId: debt.id,
        description: 'Tam kart borcu ödemesi',
        timestamp: '2026-09-30T09:00:00Z',
      });
      if (futureWithdrawal)
        finance.createTransaction({
          type: 'DEBT_USAGE',
          amount: '0.01',
          currency: 'TRY',
          accountId: bank.id,
          debtId: debt.id,
          description: 'Sonraki karttan çekim',
          timestamp: '2026-10-02T09:00:00Z',
        });
      const before = {
        transactions: finance.listTransactions(),
        accounts: finance.listAccounts(),
        debts: finance.listDebts(),
        audit: finance.listAudit(),
      };
      expect(() =>
        finance.createTransaction({
          type: 'REFUND',
          amount: '0.01',
          currency: 'TRY',
          accountId: card.id,
          description: 'İşaretli net değişimi taşıran iade',
          timestamp: '2026-10-01T09:00:00Z',
        }),
      ).toThrow('güvenli hesaplama sınırını');
      expect({
        transactions: finance.listTransactions(),
        accounts: finance.listAccounts(),
        debts: finance.listDebts(),
        audit: finance.listAudit(),
      }).toEqual(before);
      expect(() => finance.getContext({ all: true })).not.toThrow();
      expect(() => finance.getContext({ to: '2026-10-01' })).not.toThrow();
    },
  );
});
