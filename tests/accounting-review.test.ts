import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';

describe('Financial invariants across source record changes', () => {
  let service: FinanceService;
  beforeEach(() => {
    service = new FinanceService(':memory:');
  });
  afterEach(() => {
    service.close();
  });

  it('initializes no financial records or accounts', () => {
    const context = service.getContext();
    expect(context.transactionCount).toBe(0);
    expect(context.accounts).toEqual([]);
    expect(context.debts).toEqual([]);
    expect(context.subscriptions).toEqual([]);
    expect(context.recurringObligations).toEqual([]);
    expect(service.listCycles()).toEqual([]);
    expect(context.metrics.income.TRY ?? '0.00').toBe('0.00');
    expect(context.metrics.expenses.TRY ?? '0.00').toBe('0.00');
  });

  it('distinguishes liability purchases, cash repayments, and available credit', () => {
    const bank = service.createAccount({
      name: 'My bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const card = service.createAccount({
      name: 'My card',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      currentDebt: '0',
      creditLimit: '50000',
    });
    const debt = service.listDebts().find((d) => d.accountId === card.id)!;
    expect(debt).toBeDefined();
    service.createTransaction({
      type: 'EXPENSE',
      amount: '300',
      currency: 'TRY',
      description: 'Purchase',
      accountId: card.id,
    });
    service.createTransaction({
      type: 'DEBT_PAYMENT',
      amount: '100',
      currency: 'TRY',
      description: 'Repayment',
      accountId: bank.id,
      debtId: debt.id,
    });
    const context = service.getContext();
    expect(context.metrics.availableCash.TRY).toBe('900.00');
    expect(context.metrics.expenses.TRY).toBe('300.00');
    expect(context.metrics.cashOutflow.TRY).toBe('100.00');
    expect(context.metrics.debt.TRY).toBe('200.00');
    expect(context.metrics.assets.TRY).toBe('900.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('700.00');
  });

  it('moves savings without changing total owned assets or net position', () => {
    const bank = service.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const savings = service.createAccount({
      name: 'Savings',
      type: 'SAVINGS',
      currency: 'TRY',
      openingBalance: '0',
    });
    service.createTransaction({
      type: 'SAVINGS',
      amount: '250',
      currency: 'TRY',
      description: 'Set aside',
      accountId: bank.id,
      destinationAccountId: savings.id,
    });
    const context = service.getContext();
    expect(context.metrics.availableCash.TRY).toBe('750.00');
    expect(context.metrics.savings.TRY).toBe('250.00');
    expect(context.metrics.assets.TRY).toBe('1000.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('1000.00');
    expect(context.metrics.expenses.TRY ?? '0.00').toBe('0.00');
    expect(context.metrics.cashOutflow.TRY ?? '0.00').toBe('0.00');
  });

  it('keeps cash outflow gross when a purchase is refunded', () => {
    service.createTransaction({
      type: 'INCOME',
      amount: '1000',
      currency: 'TRY',
      description: 'Received',
    });
    service.createTransaction({
      type: 'EXPENSE',
      amount: '200',
      currency: 'TRY',
      description: 'Purchase',
    });
    service.createTransaction({
      type: 'REFUND',
      amount: '50',
      currency: 'TRY',
      description: 'Partial return',
    });
    const context = service.getContext();
    expect(context.metrics.expenses.TRY).toBe('150.00');
    expect(context.metrics.cashOutflow.TRY).toBe('200.00');
    expect(context.metrics.availableCash.TRY).toBe('850.00');
    expect(context.metrics.netCashFlow.TRY).toBe('850.00');
  });

  it('does not turn provided reporting conversions into native-currency bank movement', () => {
    const usd = service.createAccount({
      name: 'USD',
      type: 'BANK',
      currency: 'USD',
      openingBalance: '100',
    });
    service.createTransaction({
      type: 'EXPENSE',
      amount: '24',
      currency: 'USD',
      amountTRY: '1000',
      description: 'Renewal',
      accountId: usd.id,
    });
    const context = service.getContext();
    expect(context.metrics.availableCash.USD).toBe('76.00');
    expect(context.metrics.availableCash.TRY ?? '0.00').toBe('0.00');
    expect(context.metrics.expenses.USD).toBe('24.00');
    expect(context.recentTransactions[0].amountTRY).toBe('1000.00');
  });

  it('uses an explicitly provided TRY charge when a foreign purchase settles in a TRY account', () => {
    const bank = service.createAccount({
      name: 'TRY bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '2000',
    });
    service.createTransaction({
      type: 'EXPENSE',
      amount: '24',
      currency: 'USD',
      amountTRY: '1000',
      description: 'Actual card charge',
      accountId: bank.id,
    });
    const context = service.getContext();
    expect(context.metrics.availableCash.TRY).toBe('1000.00');
    expect(context.metrics.cashOutflow.TRY).toBe('1000.00');
    expect(context.metrics.expenses.USD).toBe('24.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('1000.00');
  });

  it('recomputes totals from edits, soft deletion, and restoration', () => {
    service.createTransaction({
      type: 'INCOME',
      amount: '1000',
      currency: 'TRY',
      description: 'Received',
    });
    const expense = service.createTransaction({
      type: 'EXPENSE',
      amount: '100',
      currency: 'TRY',
      description: 'Purchase',
    });
    service.updateTransaction(expense.id, { amount: '225.50', category: 'Food' });
    expect(service.getContext().metrics.availableCash.TRY).toBe('774.50');
    service.deleteTransaction(expense.id);
    expect(service.getContext().metrics.availableCash.TRY).toBe('1000.00');
    service.restoreTransaction(expense.id);
    expect(service.getContext().metrics.availableCash.TRY).toBe('774.50');
    const audit = service.listAudit(expense.id);
    expect(audit.map((a) => a.action.toLowerCase())).toEqual(
      expect.arrayContaining(['create', 'edit', 'delete', 'restore']),
    );
  });

  it('keeps planned recurring costs out of expenses', () => {
    service.createObligation({
      name: 'A planned bill',
      amount: '750',
      currency: 'TRY',
      frequency: 'MONTHLY',
      dueDate: '2026-10-05',
      category: 'Housing',
    });
    service.createSubscription({
      service: 'A planned renewal',
      amount: '24',
      currency: 'USD',
      frequency: 'YEARLY',
      nextRenewal: '2026-10-10',
    });
    const context = service.getContext();
    expect(context.transactionCount).toBe(0);
    expect(Object.values(context.metrics.expenses).every((v) => v === '0.00')).toBe(true);
    expect(context.subscriptions).toHaveLength(1);
    expect(context.recurringObligations).toHaveLength(1);
  });

  it('treats a borrowing and its repayment as position-neutral movements', () => {
    const debt = service.createDebt({
      name: 'Credit line',
      type: 'OVERDRAFT',
      currency: 'TRY',
      openingBalance: '0',
    });
    service.createTransaction({
      type: 'DEBT_USAGE',
      amount: '1000',
      currency: 'TRY',
      description: 'Draw',
      debtId: debt.id,
    });
    expect(service.getContext().metrics.netFinancialPosition.TRY).toBe('0.00');
    service.createTransaction({
      type: 'DEBT_PAYMENT',
      amount: '250',
      currency: 'TRY',
      description: 'Repay',
      debtId: debt.id,
    });
    const context = service.getContext();
    expect(context.metrics.availableCash.TRY).toBe('750.00');
    expect(context.metrics.debt.TRY).toBe('750.00');
    expect(context.metrics.expenses.TRY ?? '0.00').toBe('0.00');
    expect(context.metrics.income.TRY ?? '0.00').toBe('0.00');
    expect(context.metrics.netFinancialPosition.TRY).toBe('0.00');
  });
});
