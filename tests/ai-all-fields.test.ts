import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import { AiPlanService } from '../server/ai/plan';
import {
  ACCOUNT_TYPES,
  CURRENCIES,
  DEBT_TYPES,
  type AiPlan,
  type AiRecordDraft,
  type TransactionInput,
} from '../shared/types';

const fixtures: FinanceService[] = [];
function setup(items: AiRecordDraft[]) {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  const plan: AiPlan = {
    text: 'Synthetic complete finance entry',
    certain: true,
    issues: [],
    items,
  };
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('Only the universal entry provider is used');
    },
    interpretPlan: async () => plan,
  });
  return { finance, plan, service };
}
function transaction(
  key: string,
  type: TransactionInput['type'],
  amount: string,
  extra: Partial<TransactionInput> = {},
): AiRecordDraft {
  return {
    key,
    kind: 'transaction',
    data: {
      type,
      amount,
      currency: 'TRY',
      description: key,
      timestamp: '2026-10-01T12:00:00+03:00',
      ...extra,
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fixtures.splice(0).forEach((finance) => finance.close());
});

describe('universal AI entry field and ledger coverage', () => {
  it.each([undefined, ''])(
    'includes undated movements in the same-plan cycle with start %s even when definitions take time',
    (start) => {
      vi.useFakeTimers();
      vi.setSystemTime('2026-10-01T09:00:00.000Z');
      const { finance, plan, service } = setup([
        { key: 'period', kind: 'cycle', data: { name: 'New period', start } },
        transaction('salary', 'INCOME', '1000', { timestamp: undefined }),
        transaction('food', 'EXPENSE', '100', { timestamp: undefined }),
      ]);
      const startCycle = finance.startCycle.bind(finance);
      vi.spyOn(finance, 'startCycle').mockImplementation((input) => {
        vi.advanceTimersByTime(5);
        return startCycle(input);
      });
      expect(service.confirm(plan, 'cycle-shared-time').saved).toBe(true);
      const context = finance.getContext();
      expect(context.transactionCount).toBe(2);
      expect(context.income).toEqual({ TRY: '1000.00' });
      expect(context.expenses).toEqual({ TRY: '100.00' });
      expect(context.openingPosition).toEqual({});
      expect(context.positionChange).toEqual({ TRY: '900.00' });
    },
  );

  it('uses one time for omitted and blank transaction timestamps in economic order', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-01T09:00:00.000Z');
    const { finance, plan, service } = setup([
      transaction('income', 'INCOME', '100', { timestamp: undefined }),
      transaction('expense', 'EXPENSE', '10', { timestamp: '' }),
    ]);
    const normalize = finance.normalizeTransactionTimestamp.bind(finance);
    vi.spyOn(finance, 'normalizeTransactionTimestamp').mockImplementation((value) => {
      vi.advanceTimersByTime(5);
      return normalize(value);
    });
    expect(service.confirm(plan, 'blank-shared-time').saved).toBe(true);
    const timestamps = finance.listTransactions().map((entry) => entry.timestamp);
    expect(new Set(timestamps).size).toBe(1);
    expect(finance.getContext().metrics).toMatchObject({
      income: { TRY: '100.00' },
      expenses: { TRY: '10.00' },
    });
  });

  it.each(ACCOUNT_TYPES)(
    'preserves complete %s account definitions without creating income',
    async (type) => {
      const credit = type === 'CREDIT_CARD' || type === 'OVERDRAFT';
      const { finance, plan, service } = setup([
        {
          key: 'account',
          kind: 'account',
          data: {
            name: `Complete ${type}`,
            owner: 'Synthetic owner',
            type,
            currency: 'EUR',
            openingBalance: '125.25',
            currentDebt: credit ? '125.25' : null,
            creditLimit: credit ? '5000.50' : null,
            notes: 'Existing position, not new money received',
          },
        },
      ]);
      expect((await service.preview(plan.text)).certain).toBe(true);
      expect(finance.listAccounts()).toEqual([]);
      expect(service.confirm(plan, `all-fields-${type}`).saved).toBe(true);
      expect(finance.listAccounts()[0]).toMatchObject({
        name: `Complete ${type}`,
        owner: 'Synthetic owner',
        type,
        currency: 'EUR',
        openingBalance: '125.25',
        currentBalance: credit ? '-125.25' : '125.25',
        currentDebt: credit ? '125.25' : null,
        creditLimit: credit ? '5000.50' : null,
        notes: 'Existing position, not new money received',
      });
      expect(finance.listDebts()).toHaveLength(credit ? 1 : 0);
      if (credit)
        expect(finance.listDebts()[0]).toMatchObject({
          accountId: finance.listAccounts()[0].id,
          type,
          openingBalance: '125.25',
          currentBalance: '125.25',
          creditLimit: '5000.50',
        });
      expect(finance.getContext().income).toEqual({});
      expect(finance.getContext().expenses).toEqual({});
    },
  );

  it.each(DEBT_TYPES)(
    'preserves complete standalone %s debt definitions without borrowing cash',
    async (type) => {
      const { finance, plan, service } = setup([
        {
          key: 'debt',
          kind: 'debt',
          data: {
            name: `Complete ${type}`,
            type,
            currency: 'USD',
            openingBalance: '420.75',
            creditLimit: '1000.25',
            accountId: null,
            notes: 'Debt existed before tracking started',
          },
        },
      ]);
      expect((await service.preview(plan.text)).certain).toBe(true);
      expect(finance.listDebts()).toEqual([]);
      expect(service.confirm(plan, `full-debt-${type}`).saved).toBe(true);
      expect(finance.listDebts()[0]).toMatchObject({
        name: `Complete ${type}`,
        type,
        currency: 'USD',
        openingBalance: '420.75',
        currentBalance: '420.75',
        creditLimit: '1000.25',
        accountId: null,
        notes: 'Debt existed before tracking started',
        newUsage: '0.00',
        payments: '0.00',
        interest: '0.00',
        fees: '0.00',
      });
      expect(finance.getContext().metrics.availableCash).toEqual({});
      expect(finance.getContext().income).toEqual({});
      expect(finance.getContext().expenses).toEqual({});
    },
  );

  it.each(
    (['obligation', 'subscription'] as const).flatMap((kind) =>
      (['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const).map((frequency) => ({
        kind,
        frequency,
        active: frequency !== 'QUARTERLY',
      })),
    ),
  )(
    'stores all $kind fields for $frequency planning without recording spending',
    async ({ kind, frequency, active }) => {
      const common = {
        amount: '123.45',
        currency: 'USDT' as const,
        frequency,
        accountId: '@wallet',
        category: 'Business services',
        scope: 'BUSINESS' as const,
        active,
      };
      const definition: AiRecordDraft =
        kind === 'subscription'
          ? {
              key: 'schedule',
              kind,
              data: { ...common, service: 'Synthetic hosting', nextRenewal: '2026-11-05' },
            }
          : {
              key: 'schedule',
              kind,
              data: { ...common, name: 'Synthetic office', dueDate: '2026-11-05' },
            };
      const { finance, plan, service } = setup([
        definition,
        {
          key: 'wallet',
          kind: 'account',
          data: {
            name: 'Stablecoin wallet',
            type: 'WALLET',
            currency: 'USDT',
            openingBalance: '500',
          },
        },
      ]);
      expect((await service.preview(plan.text)).certain).toBe(true);
      expect(finance.listAudit()).toEqual([]);
      expect(service.confirm(plan, `schedule-${kind}-${frequency}`).saved).toBe(true);
      const schedule =
        kind === 'subscription' ? finance.listSubscriptions()[0] : finance.listObligations()[0];
      expect(schedule).toMatchObject({
        ...common,
        amount: '123.45',
        accountId: finance.listAccounts()[0].id,
        ...(kind === 'subscription'
          ? { service: 'Synthetic hosting', nextRenewal: '2026-11-05' }
          : { name: 'Synthetic office', dueDate: '2026-11-05' }),
      });
      if (kind === 'subscription' && !active) expect(schedule.status).toBe('CANCELLED');
      expect(finance.listAccounts()[0].currentBalance).toBe('500.00');
      expect(finance.getContext().expenses).toEqual({});
      expect(finance.listTransactions()).toEqual([]);
    },
  );

  it('applies every transaction type with exact balances, explicit FX, debt components and metadata', async () => {
    const { finance, plan, service } = setup([
      transaction('income', 'INCOME', '500', { accountId: '@bank' }),
      transaction('purchase', 'EXPENSE', '100', {
        accountId: '@bank',
        category: 'Supplies',
        counterparty: 'Synthetic shop',
        paymentMethod: 'Bank card',
        notes: 'Invoice example',
        scope: 'BUSINESS',
      }),
      transaction('return', 'REFUND', '20', {
        accountId: '@bank',
        category: 'Supplies',
        scope: 'BUSINESS',
      }),
      transaction('borrow', 'DEBT_USAGE', '200', {
        accountId: '@bank',
        debtId: '@loan',
        debtComponent: 'PRINCIPAL',
      }),
      transaction('fee', 'EXPENSE', '15', {
        debtId: '@loan',
        debtComponent: 'FEE',
        category: 'Loan fees',
      }),
      transaction('interest', 'EXPENSE', '10', {
        debtId: '@loan',
        debtComponent: 'INTEREST',
        category: 'Interest',
      }),
      transaction('payment', 'DEBT_PAYMENT', '150', { accountId: '@bank', debtId: '@loan' }),
      transaction('conversion', 'TRANSFER', '10', {
        currency: 'USD',
        accountId: '@dollars',
        destinationAccountId: '@bank',
        destinationAmount: '400',
        amountTRY: '400',
        exchangeRate: '40',
      }),
      transaction('save', 'SAVINGS', '200', { accountId: '@bank', destinationAccountId: '@saved' }),
      transaction('withdraw', 'SAVINGS', '-50', {
        accountId: '@bank',
        destinationAccountId: '@saved',
      }),
      transaction('correction', 'ADJUSTMENT', '-5', { accountId: '@bank' }),
      {
        key: 'period',
        kind: 'cycle',
        data: { name: 'October finance', start: '2026-10-01T00:00:00+03:00' },
      },
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Synthetic loan', type: 'LOAN', currency: 'TRY', openingBalance: '100' },
      },
      {
        key: 'saved',
        kind: 'account',
        data: { name: 'Savings', type: 'SAVINGS', currency: 'TRY', openingBalance: '0' },
      },
      {
        key: 'dollars',
        kind: 'account',
        data: { name: 'Dollar wallet', type: 'WALLET', currency: 'USD', openingBalance: '100' },
      },
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'Main bank', type: 'BANK', currency: 'TRY', openingBalance: '1000' },
      },
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain, preview.issues.join(' ')).toBe(true);
    expect(finance.listAudit()).toEqual([]);
    expect(finance.getContext().transactionCount).toBe(0);
    const result = service.confirm(preview, 'all-transaction-types');
    expect(result.saved, !result.saved ? result.confirmation.issues.join(' ') : '').toBe(true);
    expect(finance.listTransactions()).toHaveLength(11);
    const context = finance.getContext();
    expect(context.accounts.find((a) => a.name === 'Main bank')?.currentBalance).toBe('1715.00');
    expect(context.accounts.find((a) => a.name === 'Savings')?.currentBalance).toBe('150.00');
    expect(context.accounts.find((a) => a.name === 'Dollar wallet')?.currentBalance).toBe('90.00');
    expect(context.debts[0]).toMatchObject({
      currentBalance: '175.00',
      payments: '150.00',
      newUsage: '200.00',
      fees: '15.00',
      interest: '10.00',
      netChange: '75.00',
    });
    expect(context.income).toEqual({ TRY: '500.00' });
    expect(context.expenses).toEqual({ TRY: '105.00' });
    expect(context.cashOutflow).toEqual({ TRY: '250.00' });
    expect(context.metrics.debtUsage).toEqual({ TRY: '200.00' });
    expect(context.metrics.debtPayments).toEqual({ TRY: '150.00' });
    expect(context.metrics.savingsAdded).toEqual({ TRY: '150.00' });
    expect(context.metrics.assets).toEqual({ TRY: '1865.00', USD: '90.00' });
    expect(context.netFinancialPosition).toEqual({ TRY: '1690.00', USD: '90.00' });
    expect(context.scopeTotals.BUSINESS).toEqual({ TRY: '80.00' });
    expect(context.currentCycle).toMatchObject({
      name: 'October finance',
      start: '2026-09-30T21:00:00.000Z',
    });
    expect(finance.listTransactions().find((t) => t.description === 'purchase')).toMatchObject({
      category: 'Supplies',
      timestamp: '2026-10-01T09:00:00.000Z',
      counterparty: 'Synthetic shop',
      paymentMethod: 'Bank card',
      notes: 'Invoice example',
      scope: 'BUSINESS',
    });
    expect(finance.listTransactions().find((t) => t.description === 'conversion')).toMatchObject({
      amount: '10.00',
      currency: 'USD',
      destinationAmount: '400.00',
      amountTRY: '400.00',
      exchangeRate: '40',
    });
    expect(service.confirm(preview, 'all-transaction-types')).toEqual(result);
    expect(finance.listTransactions()).toHaveLength(11);
  });

  it.each(CURRENCIES)(
    'keeps %s income and account balances in the declared currency',
    async (currency) => {
      const { finance, plan, service } = setup([
        transaction('received', 'INCOME', '12.34', { currency, accountId: '@cash' }),
        {
          key: 'cash',
          kind: 'account',
          data: { name: 'Currency cash', type: 'CASH', currency, openingBalance: '0' },
        },
      ]);
      expect((await service.preview(plan.text)).certain).toBe(true);
      expect(service.confirm(plan, `income-${currency}`).saved).toBe(true);
      expect(finance.getContext().income).toEqual({ [currency]: '12.34' });
      expect(finance.getContext().metrics.availableCash).toEqual({ [currency]: '12.34' });
      expect(finance.listTransactions()[0].amountTRY).toBeNull();
    },
  );

  it.each(['obligation', 'subscription'] as const)(
    'creates and pays a %s with inherited fields once',
    async (kind) => {
      const definition: AiRecordDraft =
        kind === 'subscription'
          ? {
              key: 'schedule',
              kind,
              data: {
                service: 'Synthetic software',
                amount: '150.30',
                currency: 'TRY',
                frequency: 'MONTHLY',
                nextRenewal: '2026-10-01',
                accountId: '@bank',
                category: 'Software',
                scope: 'BUSINESS',
                active: true,
              },
            }
          : {
              key: 'schedule',
              kind,
              data: {
                name: 'Synthetic office rent',
                amount: '150.30',
                currency: 'TRY',
                frequency: 'MONTHLY',
                dueDate: '2026-10-01',
                accountId: '@bank',
                category: 'Rent',
                scope: 'BUSINESS',
                active: true,
              },
            };
      const linkField = kind === 'subscription' ? 'subscriptionId' : 'obligationId';
      const { finance, plan, service } = setup([
        transaction('paid', 'EXPENSE', '150.30', {
          [linkField]: '@schedule',
          counterparty: 'Synthetic supplier',
          paymentMethod: 'Direct debit',
          notes: 'Actually paid',
        }),
        definition,
        {
          key: 'bank',
          kind: 'account',
          data: { name: 'Business bank', type: 'BANK', currency: 'TRY', openingBalance: '500' },
        },
      ]);
      const preview = await service.preview(plan.text);
      expect(preview.certain, preview.issues.join(' ')).toBe(true);
      expect(service.confirm(preview, `paid-${kind}-fields`).saved).toBe(true);
      const schedule =
        kind === 'subscription' ? finance.listSubscriptions()[0] : finance.listObligations()[0];
      expect(schedule.status).toBe('PAID');
      expect(finance.listTransactions()[0]).toMatchObject({
        accountId: finance.listAccounts()[0].id,
        category: kind === 'subscription' ? 'Software' : 'Rent',
        scope: 'BUSINESS',
        [linkField]: schedule.id,
        counterparty: 'Synthetic supplier',
        paymentMethod: 'Direct debit',
        notes: 'Actually paid',
      });
      expect(finance.getContext().metrics.availableCash).toEqual({ TRY: '349.70' });
      expect(finance.getContext().scopeTotals.BUSINESS).toEqual({ TRY: '150.30' });
      const auditCount = finance.listAudit().length;
      const duplicate: AiPlan = {
        ...plan,
        items: [transaction('repeat', 'EXPENSE', '150.30', { [linkField]: schedule.id })],
      };
      expect(service.confirm(duplicate, `repeat-${kind}-fields`).saved).toBe(false);
      expect(finance.listTransactions()).toHaveLength(1);
      expect(finance.listAudit()).toHaveLength(auditCount);
    },
  );

  it.each(['BANK', 'CREDIT_CARD'] as const)(
    'settles a foreign purchase and refund on a TRY %s using explicit real TRY amounts',
    (type) => {
      const credit = type === 'CREDIT_CARD';
      const { finance, plan, service } = setup([
        transaction('foreign_purchase', 'EXPENSE', '10', {
          currency: 'EUR',
          amountTRY: '450',
          exchangeRate: '45',
          accountId: '@account',
          category: 'Travel',
          counterparty: 'Synthetic European merchant',
          paymentMethod: 'Card',
          notes: 'Actual statement settlement',
          scope: 'BUSINESS',
        }),
        transaction('foreign_refund', 'REFUND', '2', {
          currency: 'EUR',
          amountTRY: '90',
          exchangeRate: '45',
          accountId: '@account',
          category: 'Travel',
          scope: 'BUSINESS',
        }),
        {
          key: 'account',
          kind: 'account',
          data: {
            name: 'Foreign purchase source',
            type,
            currency: 'TRY',
            openingBalance: credit ? '0' : '1000',
            currentDebt: credit ? '0' : null,
            creditLimit: credit ? '5000' : null,
          },
        },
      ]);
      expect(service.confirm(plan, `foreign-card-${type}`).saved).toBe(true);
      expect(finance.listAccounts()[0].currentBalance).toBe(credit ? '-360.00' : '640.00');
      expect(finance.getContext().expenses).toEqual({ EUR: '8.00' });
      expect(finance.getContext().scopeTotals.BUSINESS).toEqual({ EUR: '8.00' });
      expect(finance.getContext().cashOutflow).toEqual(credit ? {} : { TRY: '450.00' });
      expect(finance.getContext().metrics.debt).toEqual(credit ? { TRY: '360.00' } : {});
      expect(
        finance.listTransactions().find((t) => t.description === 'foreign_purchase'),
      ).toMatchObject({
        amount: '10.00',
        currency: 'EUR',
        amountTRY: '450.00',
        exchangeRate: '45',
        counterparty: 'Synthetic European merchant',
        notes: 'Actual statement settlement',
        paymentMethod: 'Card',
      });
    },
  );

  it.each(['obligation', 'subscription'] as const)(
    'rolls back every new definition when payment targets an inactive %s',
    async (kind) => {
      const definition: AiRecordDraft =
        kind === 'subscription'
          ? {
              key: 'inactive',
              kind,
              data: {
                service: 'Inactive service',
                amount: '20',
                currency: 'TRY',
                frequency: 'YEARLY',
                nextRenewal: '2026-10-01',
                active: false,
                accountId: '@bank',
              },
            }
          : {
              key: 'inactive',
              kind,
              data: {
                name: 'Inactive payment',
                amount: '20',
                currency: 'TRY',
                frequency: 'WEEKLY',
                dueDate: '2026-10-01',
                active: false,
                accountId: '@bank',
              },
            };
      const { finance, plan, service } = setup([
        {
          key: 'bank',
          kind: 'account',
          data: { name: 'New payment bank', type: 'BANK', currency: 'TRY', openingBalance: '200' },
        },
        definition,
        transaction('paid', 'EXPENSE', '20', {
          [kind === 'subscription' ? 'subscriptionId' : 'obligationId']: '@inactive',
        }),
      ]);
      expect((await service.preview(plan.text)).certain).toBe(false);
      expect(service.confirm(plan, `inactive-${kind}-test`).saved).toBe(false);
      expect(finance.listAccounts()).toEqual([]);
      expect(finance.listObligations()).toEqual([]);
      expect(finance.listSubscriptions()).toEqual([]);
      expect(finance.listTransactions()).toEqual([]);
      expect(finance.listAudit()).toEqual([]);
      expect(finance.sqlite.prepare('SELECT count(*) n FROM ai_entry_receipts').get()).toEqual({
        n: 0,
      });
    },
  );

  it('rejects a debt account link that would create a second liability for one credit account', () => {
    const { finance, plan, service } = setup([
      {
        key: 'card',
        kind: 'account',
        data: {
          name: 'Linked card',
          type: 'CREDIT_CARD',
          currency: 'TRY',
          currentDebt: '200',
          creditLimit: '1000',
        },
      },
      {
        key: 'debt',
        kind: 'debt',
        data: {
          name: 'Separate card debt',
          type: 'CREDIT_CARD',
          currency: 'TRY',
          openingBalance: '200',
          creditLimit: '1000',
          accountId: '@card',
          notes: 'Would double the liability',
        },
      },
    ]);
    expect(service.confirm(plan, 'duplicate-link-debt').saved).toBe(false);
    expect(finance.listAccounts()).toEqual([]);
    expect(finance.listDebts()).toEqual([]);
    expect(finance.listAudit()).toEqual([]);
  });
});
