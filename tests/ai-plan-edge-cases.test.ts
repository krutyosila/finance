import { afterEach, describe, expect, it } from 'vitest';
import { AiError } from '../server/ai/errors';
import { AiPlanService } from '../server/ai/plan';
import { FinanceService } from '../server/core/service';
import type { AiPlan, AiRecordDraft, TransactionInput } from '../shared/types';

const fixtures: FinanceService[] = [];
const tables = [
  'accounts',
  'debts',
  'obligations',
  'subscriptions',
  'cycles',
  'transactions',
  'audit',
  'ai_entry_receipts',
] as const;
function setup(items: AiRecordDraft[] = []) {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  const plan: AiPlan = { text: 'Synthetic finance note', certain: true, issues: [], items };
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('Legacy interpreter must not be used');
    },
    interpretPlan: async () => structuredClone(plan),
  });
  return { finance, service, plan };
}
function snapshot(finance: FinanceService) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      finance.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}
function bank(key = 'bank', openingBalance = '1000'): AiRecordDraft {
  return {
    key,
    kind: 'account',
    data: { name: key, type: 'BANK', currency: 'TRY', openingBalance },
  };
}
function tx(key: string, data: Partial<TransactionInput> = {}): AiRecordDraft {
  return {
    key,
    kind: 'transaction',
    data: {
      type: 'EXPENSE',
      amount: '10',
      currency: 'TRY',
      description: key,
      timestamp: '2026-10-01T12:00:00Z',
      ...data,
    },
  };
}
async function expectBlocked(service: AiPlanService, plan: AiPlan) {
  const preview = await service.preview(plan.text);
  expect(preview.certain).toBe(false);
  expect(preview.issues.length).toBeGreaterThan(0);
  const result = service.confirm(plan, 'blocked-edge-plan');
  expect(result.saved).toBe(false);
  if (!result.saved) expect(result.confirmation.issues.length).toBeGreaterThan(0);
}
afterEach(() => fixtures.splice(0).forEach((finance) => finance.close()));

describe('AI plan validation at untrusted field boundaries', () => {
  it('accepts nullable optional fields without mistaking them for wrong primitive types', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'bank',
        kind: 'account',
        data: {
          name: 'Bank',
          type: 'BANK',
          currency: 'TRY',
          openingBalance: '1000',
          owner: null,
          creditLimit: null,
          notes: null,
        },
      } as unknown as AiRecordDraft,
      {
        key: 'music',
        kind: 'subscription',
        data: {
          service: 'Music',
          amount: '10',
          currency: 'TRY',
          frequency: 'MONTHLY',
          nextRenewal: '2026-10-01',
          accountId: '@bank',
          active: null,
          category: null,
          scope: null,
        },
      } as unknown as AiRecordDraft,
      tx('income', {
        type: 'INCOME',
        accountId: '@bank',
        timestamp: null,
        notes: null,
      } as unknown as Partial<TransactionInput>),
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(finance.listAudit()).toHaveLength(0);
    expect(service.confirm(plan, 'nullable-optional-fields').saved).toBe(true);
    expect(finance.listAccounts()[0].currentBalance).toBe('1010.00');
    expect(finance.listSubscriptions()[0]).toMatchObject({ active: true, scope: 'PERSONAL' });
    expect(finance.listTransactions()[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each([
    [
      'transaction timestamp',
      {
        key: 't',
        kind: 'transaction',
        data: {
          type: 'INCOME',
          amount: '1',
          currency: 'TRY',
          description: 'Income',
          timestamp: false,
        },
      },
    ],
    [
      'account owner',
      {
        key: 'a',
        kind: 'account',
        data: { name: 'Bank', type: 'BANK', currency: 'TRY', openingBalance: '0', owner: true },
      },
    ],
    [
      'debt notes',
      {
        key: 'd',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0', notes: false },
      },
    ],
    [
      'obligation active flag',
      {
        key: 'o',
        kind: 'obligation',
        data: {
          name: 'Rent',
          amount: '10',
          currency: 'TRY',
          frequency: 'MONTHLY',
          dueDate: '2026-10-01',
          active: 'false',
        },
      },
    ],
    [
      'subscription active flag',
      {
        key: 's',
        kind: 'subscription',
        data: {
          service: 'Music',
          amount: '10',
          currency: 'TRY',
          frequency: 'MONTHLY',
          nextRenewal: '2026-10-01',
          active: 'true',
        },
      },
    ],
    ['cycle start', { key: 'c', kind: 'cycle', data: { name: 'October', start: false } }],
  ] as const)('rejects a wrong primitive type for %s before any writes', async (_name, item) => {
    const { finance, service, plan } = setup([item as unknown as AiRecordDraft]);
    const before = snapshot(finance);
    await expect(service.preview(plan.text)).rejects.toMatchObject({
      name: 'AiError',
      statusCode: 400,
    });
    expect(() => service.confirm(plan, 'malformed-edge-field')).toThrow(AiError);
    try {
      service.confirm(plan, 'malformed-edge-field');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
    }
    expect(snapshot(finance)).toEqual(before);
  });

  it.each([
    ['empty plan', []],
    ['missing local source', [tx('purchase', { accountId: '@absent' })]],
    [
      'local source with debt kind',
      [
        {
          key: 'loan',
          kind: 'debt',
          data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
        },
        tx('purchase', { accountId: '@loan' }),
      ],
    ],
    [
      'cash account used as a debt',
      [bank(), tx('repay', { type: 'DEBT_PAYMENT', accountId: '@bank', debtId: '@bank' })],
    ],
    [
      'cyclic local references',
      [
        {
          key: 'first',
          kind: 'debt',
          data: {
            name: 'First',
            type: 'LOAN',
            currency: 'TRY',
            openingBalance: '0',
            accountId: '@second',
          },
        },
        {
          key: 'second',
          kind: 'debt',
          data: {
            name: 'Second',
            type: 'LOAN',
            currency: 'TRY',
            openingBalance: '0',
            accountId: '@first',
          },
        },
      ],
    ],
    [
      'source and destination equal',
      [bank(), tx('move', { type: 'TRANSFER', accountId: '@bank', destinationAccountId: '@bank' })],
    ],
    [
      'different same-currency received amount',
      [
        bank(),
        bank('destination', '0'),
        tx('move', {
          type: 'TRANSFER',
          accountId: '@bank',
          destinationAccountId: '@destination',
          destinationAmount: '9',
        }),
      ],
    ],
    [
      'credit account destination',
      [
        bank(),
        {
          key: 'card',
          kind: 'account',
          data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY', currentDebt: '0' },
        },
        tx('move', { type: 'TRANSFER', accountId: '@bank', destinationAccountId: '@card' }),
      ],
    ],
  ] as [string, AiRecordDraft[]][])(
    'blocks %s and preserves every source table',
    async (_name, items) => {
      const { finance, service, plan } = setup(items);
      finance.createAccount({
        name: 'Untouched',
        type: 'CASH',
        currency: 'EUR',
        openingBalance: '12.34',
      });
      const before = snapshot(finance);
      await expectBlocked(service, plan);
      expect(snapshot(finance)).toEqual(before);
    },
  );

  it.each(['0', '-1', '1.001', '1e3', 'NaN', 'Infinity', '1,50', '90071992547409.92'])(
    'blocks invalid expense amount %s without saving a preceding income',
    async (amount) => {
      const { finance, service, plan } = setup([
        bank(),
        tx('income', { type: 'INCOME', amount: '20', accountId: '@bank' }),
        tx('bad-expense', { amount, accountId: '@bank' }),
      ]);
      const before = snapshot(finance);
      await expectBlocked(service, plan);
      expect(snapshot(finance)).toEqual(before);
    },
  );

  it('rejects a deleted existing account ID without restoring or editing it', async () => {
    const { finance, service, plan } = setup();
    const account = finance.createAccount({
      name: 'Deleted bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '50',
    });
    finance.deleteAccount(account.id);
    plan.items = [tx('income', { type: 'INCOME', accountId: account.id })];
    const before = snapshot(finance);
    await expectBlocked(service, plan);
    expect(snapshot(finance)).toEqual(before);
  });

  it('requires actual foreign destination proceeds even when a TRY reporting rate was provided', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'eur',
        kind: 'account',
        data: { name: 'EUR wallet', type: 'WALLET', currency: 'EUR', openingBalance: '100' },
      },
      {
        key: 'usd',
        kind: 'account',
        data: { name: 'USD wallet', type: 'WALLET', currency: 'USD', openingBalance: '0' },
      },
      tx('convert', {
        type: 'TRANSFER',
        amount: '10',
        currency: 'EUR',
        accountId: '@eur',
        destinationAccountId: '@usd',
        exchangeRate: '45',
      }),
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toContain('USD');
    expect(preview.items.find((item) => item.key === 'convert')?.data).not.toHaveProperty(
      'destinationAmount',
    );
    expect(service.confirm(preview, 'missing-foreign-total').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listTransactions()).toHaveLength(0);
  });
});

describe('atomic AI schedule and debt workflows', () => {
  it('rolls back saved definitions, schedule payment, income and audit when a later repayment overpays debt', async () => {
    const { finance, service, plan } = setup([
      bank(),
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'PERSONAL', currency: 'TRY', openingBalance: '0' },
      },
      {
        key: 'music',
        kind: 'subscription',
        data: {
          service: 'Music',
          amount: '10',
          currency: 'TRY',
          frequency: 'MONTHLY',
          nextRenewal: '2026-10-01',
          accountId: '@bank',
        },
      },
      {
        key: 'rent',
        kind: 'obligation',
        data: {
          name: 'Rent',
          amount: '30',
          currency: 'TRY',
          frequency: 'MONTHLY',
          dueDate: '2026-10-05',
          accountId: '@bank',
        },
      },
      { key: 'period', kind: 'cycle', data: { name: 'October', start: '2026-10-01' } },
      tx('pay-music', { accountId: '@bank', subscriptionId: '@music' }),
      tx('income', { type: 'INCOME', amount: '100', accountId: '@bank' }),
      tx('overpay', {
        type: 'DEBT_PAYMENT',
        amount: '1',
        debtId: '@loan',
        accountId: '@bank',
        timestamp: '2026-10-02T12:00:00Z',
      }),
    ]);
    const before = snapshot(finance);
    await expectBlocked(service, plan);
    expect(snapshot(finance)).toEqual(before);
  });

  it.each(['subscription', 'obligation'] as const)(
    'rolls back two payments for one %s occurrence, then accepts a corrected retry once',
    async (kind) => {
      const schedule: AiRecordDraft =
        kind === 'subscription'
          ? {
              key: 'schedule',
              kind,
              data: {
                service: 'Music',
                nextRenewal: '2026-10-01',
                amount: '10',
                currency: 'TRY',
                frequency: 'MONTHLY',
                accountId: '@bank',
              },
            }
          : {
              key: 'schedule',
              kind,
              data: {
                name: 'Rent',
                dueDate: '2026-10-01',
                amount: '10',
                currency: 'TRY',
                frequency: 'MONTHLY',
                accountId: '@bank',
              },
            };
      const link =
        kind === 'subscription' ? { subscriptionId: '@schedule' } : { obligationId: '@schedule' };
      const { finance, service, plan } = setup([
        bank(),
        schedule,
        tx('first', link),
        tx('second', link),
      ]);
      const before = snapshot(finance);
      await expectBlocked(service, plan);
      expect(snapshot(finance)).toEqual(before);
      plan.items = plan.items.filter((item) => item.key !== 'second');
      const saved = service.confirm(plan, 'blocked-edge-plan');
      expect(saved.saved).toBe(true);
      expect(service.confirm(plan, 'blocked-edge-plan')).toEqual(saved);
      expect(finance.listTransactions()).toHaveLength(1);
      expect(finance.listAccounts()[0].currentBalance).toBe('990.00');
      const records =
        kind === 'subscription' ? finance.listSubscriptions() : finance.listObligations();
      expect(records[0].status).toBe('PAID');
      expect(finance.sqlite.prepare('SELECT COUNT(*) n FROM ai_entry_receipts').get()).toEqual({
        n: 1,
      });
    },
  );

  it.each(['subscription', 'obligation'] as const)(
    'blocks payment of an inactive %s while preserving existing records',
    async (kind) => {
      const { finance, service, plan } = setup();
      const account = finance.createAccount({
        name: 'Bank',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '1000',
      });
      const common = {
        amount: '10',
        currency: 'TRY' as const,
        frequency: 'MONTHLY' as const,
        accountId: account.id,
        active: false,
      };
      const schedule =
        kind === 'subscription'
          ? finance.createSubscription({ ...common, service: 'Music', nextRenewal: '2026-10-01' })
          : finance.createObligation({ ...common, name: 'Rent', dueDate: '2026-10-01' });
      plan.items = [
        bank('new-bank'),
        tx('pay', { [kind === 'subscription' ? 'subscriptionId' : 'obligationId']: schedule.id }),
      ];
      const before = snapshot(finance);
      await expectBlocked(service, plan);
      expect(snapshot(finance)).toEqual(before);
    },
  );

  it('keeps foreign credit purchases, linked debt repayment and actual TRY cash separate', async () => {
    const { finance, service, plan } = setup([
      bank('bank', '5000'),
      {
        key: 'card',
        kind: 'account',
        data: {
          name: 'Card',
          type: 'CREDIT_CARD',
          currency: 'TRY',
          currentDebt: '0',
          creditLimit: '10000',
        },
      },
      tx('software', {
        amount: '24',
        currency: 'USD',
        amountTRY: '1000',
        accountId: '@card',
        debtId: '@card',
        category: 'Yazılım',
        scope: 'BUSINESS',
      }),
      tx('repay', {
        type: 'DEBT_PAYMENT',
        amount: '500',
        accountId: '@bank',
        debtId: '@card',
        timestamp: '2026-10-02T12:00:00Z',
      }),
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(service.confirm(plan, 'foreign-card-payment').saved).toBe(true);
    expect(finance.listDebts()[0]).toMatchObject({
      currentBalance: '500.00',
      payments: '500.00',
      newUsage: '1000.00',
    });
    expect(finance.listAccounts().find((account) => account.name === 'bank')?.currentBalance).toBe(
      '4500.00',
    );
    expect(finance.getContext().metrics).toMatchObject({
      expenses: { USD: '24.00' },
      cashOutflow: { TRY: '500.00' },
      debt: { TRY: '500.00' },
      debtPayments: { TRY: '500.00' },
    });
  });

  it('replays out-of-order debt draw, interest, fee and repayment against the same local debt', async () => {
    const { finance, service, plan } = setup([
      tx('repay', {
        type: 'DEBT_PAYMENT',
        amount: '60',
        debtId: '@loan',
        accountId: '@bank',
        timestamp: '2026-10-04',
      }),
      tx('fee', { amount: '5', debtId: '@loan', debtComponent: 'FEE', timestamp: '2026-10-03' }),
      tx('interest', {
        amount: '10',
        debtId: '@loan',
        debtComponent: 'INTEREST',
        timestamp: '2026-10-02',
      }),
      tx('draw', {
        type: 'DEBT_USAGE',
        amount: '100',
        debtId: '@loan',
        accountId: '@bank',
        timestamp: '2026-10-01',
      }),
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
      },
      bank('bank', '0'),
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    const saved = service.confirm(plan, 'debt-components-chain');
    expect(saved.saved).toBe(true);
    expect(finance.listDebts()[0]).toMatchObject({
      currentBalance: '55.00',
      payments: '60.00',
      newUsage: '100.00',
      interest: '10.00',
      fees: '5.00',
    });
    expect(finance.listAccounts()[0].currentBalance).toBe('40.00');
    expect(finance.getContext().metrics).toMatchObject({
      income: {},
      expenses: { TRY: '15.00' },
      cashOutflow: { TRY: '60.00' },
      debtUsage: { TRY: '100.00' },
    });
  });

  it('preserves assets through virtual saving, withdrawal, expense and refund without counting transfers as spending', async () => {
    const { finance, service, plan } = setup([
      bank(),
      tx('save', { type: 'SAVINGS', amount: '300', accountId: '@bank', timestamp: '2026-10-01' }),
      tx('withdraw', {
        type: 'SAVINGS',
        amount: '-100',
        accountId: '@bank',
        timestamp: '2026-10-02',
      }),
      tx('purchase', { amount: '50', accountId: '@bank', timestamp: '2026-10-03' }),
      tx('refund', { type: 'REFUND', amount: '20', accountId: '@bank', timestamp: '2026-10-04' }),
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(service.confirm(plan, 'savings-refund-chain').saved).toBe(true);
    expect(finance.listAccounts()[0].currentBalance).toBe('770.00');
    expect(finance.getContext().metrics).toMatchObject({
      availableCash: { TRY: '770.00' },
      savings: { TRY: '200.00' },
      assets: { TRY: '970.00' },
      expenses: { TRY: '30.00' },
      cashOutflow: { TRY: '50.00' },
      income: {},
    });
  });

  it('returns a durable receipt even when later account changes would make matching ambiguous', async () => {
    const { finance, service, plan } = setup([
      { key: 'wallet', kind: 'account', data: { name: 'Wallet', type: 'WALLET', currency: 'USD' } },
      tx('income', { type: 'INCOME', amount: '100', currency: 'USD', accountId: '@wallet' }),
    ]);
    const first = service.confirm(plan, 'receipt-before-ambiguity');
    expect(first.saved).toBe(true);
    finance.createAccount({ name: 'Wallet', type: 'BANK', currency: 'USD', openingBalance: '0' });
    const before = snapshot(finance);
    expect(service.confirm(plan, 'receipt-before-ambiguity')).toEqual(first);
    expect(snapshot(finance)).toEqual(before);
    const fresh = service.confirm(plan, 'fresh-ambiguous-attempt');
    expect(fresh.saved).toBe(false);
    if (!fresh.saved) expect(fresh.confirmation.issues.join(' ')).toContain('birden fazla');
    expect(finance.listTransactions()).toHaveLength(1);
  });
});
