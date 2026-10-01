import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FinanceService } from '../server/core/service';
import { AiPlanService } from '../server/ai/plan';
import { AuthError } from '../server/auth';
import type { AiPlan, AiRecordDraft } from '../shared/types';
const fixtures: { finance: FinanceService; root: string }[] = [];
function setup(items: AiRecordDraft[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'finance-plan-'));
  const finance = new FinanceService(join(root, 'db.sqlite'));
  fixtures.push({ finance, root });
  const plan: AiPlan = { text: 'Finance note', certain: true, issues: [], items };
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('legacy');
    },
    interpretPlan: async () => plan,
  });
  return { finance, service, plan };
}
const account: AiRecordDraft = {
  key: 'bank',
  kind: 'account',
  data: { name: 'Bank', type: 'BANK', currency: 'TRY', openingBalance: '500' },
};
const subscription: AiRecordDraft = {
  key: 'music',
  kind: 'subscription',
  data: {
    service: 'Music',
    amount: '20',
    currency: 'TRY',
    frequency: 'MONTHLY',
    nextRenewal: '2026-10-01',
    accountId: '@bank',
  },
};
afterEach(() =>
  fixtures.splice(0).forEach(({ finance, root }) => {
    finance.close();
    rmSync(root, { recursive: true, force: true });
  }),
);
describe('atomic finance AI plans', () => {
  it('previews all record kinds under rollback and resolves reversed dependencies', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'pay',
        kind: 'transaction',
        data: {
          type: 'EXPENSE',
          amount: '20',
          currency: 'TRY',
          description: 'Music',
          timestamp: '2026-10-01',
          accountId: '@bank',
          subscriptionId: '@music',
        },
      },
      subscription,
      account,
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '100' },
      },
      {
        key: 'rent',
        kind: 'obligation',
        data: {
          name: 'Rent',
          amount: '50',
          currency: 'TRY',
          frequency: 'MONTHLY',
          dueDate: '2026-11-01',
          accountId: '@bank',
        },
      },
      { key: 'month', kind: 'cycle', data: { name: 'October', start: '2026-10-01' } },
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(finance.listAudit()).toHaveLength(0);
    expect(finance.listAccounts()).toHaveLength(0);
    const result = service.confirm(plan, 'all-kinds-id');
    expect(result.saved).toBe(true);
    if (result.saved) expect(result.records).toHaveLength(6);
    expect(finance.listSubscriptions()[0].accountId).toBe(finance.listAccounts()[0].id);
    expect(finance.listTransactions()).toHaveLength(1);
    expect(finance.listCycles()).toHaveLength(1);
  });
  it('maps local credit account debt references to the automatically linked debt', () => {
    const { finance, service, plan } = setup([
      {
        key: 'use',
        kind: 'transaction',
        data: {
          type: 'DEBT_USAGE',
          amount: '15',
          currency: 'TRY',
          description: 'Usage',
          timestamp: '2026-10-01',
          debtId: '@card',
        },
      },
      {
        key: 'card',
        kind: 'account',
        data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY', currentDebt: '10' },
      },
    ]);
    expect(service.confirm(plan, 'credit-plan-id').saved).toBe(true);
    expect(finance.listTransactions()[0].debtId).toBe(finance.listDebts()[0].id);
  });
  it.each(
    [
      [{ ...account, data: { name: 'Bank', type: 'BANK', currency: 'TRY' } }],
      [
        {
          ...subscription,
          data: { ...subscription.data, accountId: null, nextRenewal: undefined },
        },
      ],
      [
        {
          key: 'tx',
          kind: 'transaction',
          data: { type: 'EXPENSE', amount: '1', currency: 'TRY' },
        },
      ],
      [{ ...account, data: { ...account.data, openingBalance: '1.001' } }],
      [account, { ...account, key: 'other' }],
      [account, { ...subscription, data: { ...subscription.data, currency: 'USD' } }],
      [account, { ...subscription, data: { ...subscription.data, nextRenewal: '2026-02-30' } }],
      [account, { ...subscription, data: { ...subscription.data, accountId: '@missing' } }],
    ].map((items) => [items]),
  )('returns invalid batches without any records, audits or receipts %#', (items) => {
    const { finance, service, plan } = setup(items as AiRecordDraft[]);
    expect(service.confirm(plan, 'invalid-plan-id').saved).toBe(false);
    expect(finance.listAudit()).toHaveLength(0);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.sqlite.prepare('SELECT count(*) n FROM ai_entry_receipts').get()).toEqual({
      n: 0,
    });
  });
  it('retries persistent receipts, canonicalizes object keys and rejects changed payloads', () => {
    const { finance, service, plan } = setup([account]);
    const first = service.confirm(plan, 'persistent-plan');
    const reordered = { items: plan.items, issues: [], certain: true, text: plan.text };
    expect(new AiPlanService(finance, {} as never).confirm(reordered, 'persistent-plan')).toEqual(
      first,
    );
    expect(() => service.confirm({ ...plan, text: 'changed' }, 'persistent-plan')).toThrow();
    expect(finance.listAccounts()).toHaveLength(1);
    const fixture = fixtures.find((value) => value.finance === finance)!;
    finance.close();
    fixture.finance = new FinanceService(join(fixture.root, 'db.sqlite'));
    expect(
      new AiPlanService(fixture.finance, {} as never).confirm(plan, 'persistent-plan'),
    ).toEqual(first);
    expect(fixture.finance.listAccounts()).toHaveLength(1);
  });
  it('does not swallow authorization failures, including receipt retries', () => {
    const { finance, service, plan } = setup([account]);
    const error = new AuthError('Denied', 403);
    expect(() =>
      service.confirm(plan, 'auth-plan-id', () => {
        expect(finance.sqlite.inTransaction).toBe(true);
        throw error;
      }),
    ).toThrow(error);
    expect(finance.listAccounts()).toHaveLength(0);
    service.confirm(plan, 'auth-plan-id');
    expect(() =>
      service.confirm(plan, 'auth-plan-id', () => {
        throw error;
      }),
    ).toThrow(error);
  });
  it('uses existing transaction and cycle defaults but never schedule date defaults', async () => {
    const { finance, service, plan } = setup([
      {
        key: '1',
        kind: 'transaction',
        data: { type: 'EXPENSE', amount: '1', currency: 'TRY', description: 'Purchase' },
      },
      { key: 'cycle', kind: 'cycle', data: {} },
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(service.confirm(plan, 'default-time-id').saved).toBe(true);
    expect(finance.listCycles()[0].name).toBe('Finans dönemi');
    expect(finance.listTransactions()[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('rejects duplicate existing definitions while allowing same account names with different currencies or types', () => {
    const { finance, service, plan } = setup([account]);
    finance.createAccount(account.data as never);
    expect(service.confirm(plan, 'existing-bank').saved).toBe(false);
    const distinct: AiPlan = {
      ...plan,
      items: [
        { ...account, key: 'usd', data: { ...account.data, currency: 'USD' } },
        { ...account, key: 'cash', data: { ...account.data, type: 'CASH' } },
      ],
    };
    expect(service.confirm(distinct, 'distinct-banks').saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(3);
  });
  it('rejects a separately defined debt duplicating a credit account automatic debt', () => {
    const { finance, service, plan } = setup([
      {
        key: 'card',
        kind: 'account',
        data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY', currentDebt: '10' },
      },
      {
        key: 'duplicate',
        kind: 'debt',
        data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY', openingBalance: '10' },
      },
    ]);
    expect(service.confirm(plan, 'duplicate-card').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
  });
  it('provides Turkish required field labels', () => {
    const { service, plan } = setup([{ ...subscription, data: { service: 'Music' } }]);
    const result = service.confirm(plan, 'turkish-labels');
    expect(result.saved).toBe(false);
    if (!result.saved) expect(result.confirmation.issues.join(' ')).toContain('tutar');
  });
  it('executes definitions before transactions and debt transactions in ledger chronology while returning input order', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'payment',
        kind: 'transaction',
        data: {
          type: 'DEBT_PAYMENT',
          amount: '100',
          currency: 'TRY',
          description: 'Pay',
          timestamp: '2026-10-02',
          debtId: '@loan',
        },
      },
      {
        key: 'usage',
        kind: 'transaction',
        data: {
          type: 'DEBT_USAGE',
          amount: '100',
          currency: 'TRY',
          description: 'Borrow',
          timestamp: '2026-10-01',
          debtId: '@loan',
        },
      },
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
      },
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(finance.listAudit()).toHaveLength(0);
    const result = service.confirm(plan, 'chronology-plan');
    expect(result.saved).toBe(true);
    if (result.saved)
      expect(result.records.map(({ key }) => key)).toEqual(['payment', 'usage', 'loan']);
    expect(finance.listDebts()[0].currentBalance).toBe('0.00');
  });
  it('uses actual normalized instants when sorting mixed date and timezone debt movements', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'payment',
        kind: 'transaction',
        data: {
          type: 'DEBT_PAYMENT',
          amount: '100',
          currency: 'TRY',
          description: 'Pay',
          timestamp: '2026-10-01T01:00:00+03:00',
          debtId: '@loan',
        },
      },
      {
        key: 'usage',
        kind: 'transaction',
        data: {
          type: 'DEBT_USAGE',
          amount: '100',
          currency: 'TRY',
          description: 'Borrow',
          timestamp: '2026-10-01',
          debtId: '@loan',
        },
      },
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
      },
    ]);
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(service.confirm(plan, 'mixed-date-plan').saved).toBe(true);
    expect(finance.listDebts()[0].currentBalance).toBe('0.00');
  });
  it.each(['subscription', 'obligation'] as const)(
    'previews and applies missing defaults from an existing %s payment',
    async (kind) => {
      const { finance, service, plan } = setup([]);
      const bank = finance.createAccount(account.data as never);
      const common = {
        amount: '100',
        currency: 'TRY' as const,
        frequency: 'MONTHLY' as const,
        accountId: bank.id,
        category: 'Software',
        scope: 'BUSINESS' as const,
      };
      const schedule =
        kind === 'subscription'
          ? finance.createSubscription({ ...common, service: 'Netflix', nextRenewal: '2026-10-01' })
          : finance.createObligation({ ...common, name: 'Rent', dueDate: '2026-10-01' });
      plan.items = [
        {
          key: 'pay',
          kind: 'transaction',
          data: {
            type: 'EXPENSE',
            amount: '100',
            currency: 'TRY',
            description: 'Payment',
            [kind === 'subscription' ? 'subscriptionId' : 'obligationId']: schedule.id,
          },
        },
      ];
      const preview = await service.preview(plan.text);
      expect(preview.certain).toBe(true);
      expect(preview.items[0].data).toMatchObject({
        accountId: bank.id,
        category: 'Software',
        scope: 'BUSINESS',
      });
      expect(finance.listAccounts()[0].currentBalance).toBe('500.00');
      expect(service.confirm(preview, `existing-${kind}`).saved).toBe(true);
      expect(finance.listAccounts()[0].currentBalance).toBe('400.00');
      expect(finance.listTransactions()[0]).toMatchObject({
        accountId: bank.id,
        category: 'Software',
        scope: 'BUSINESS',
      });
    },
  );
  it.each(['subscription', 'obligation'] as const)(
    'retains raw local references when previewing defaults from a same-plan %s',
    async (kind) => {
      const data =
        kind === 'subscription'
          ? { service: 'Netflix', nextRenewal: '2026-10-01' }
          : { name: 'Rent', dueDate: '2026-10-01' };
      const { finance, service, plan } = setup([
        {
          key: 'pay',
          kind: 'transaction',
          data: {
            type: 'EXPENSE',
            amount: '100',
            currency: 'TRY',
            description: 'Payment',
            [kind === 'subscription' ? 'subscriptionId' : 'obligationId']: '@schedule',
          },
        },
        {
          key: 'schedule',
          kind,
          data: {
            ...data,
            amount: '100',
            currency: 'TRY',
            frequency: 'MONTHLY',
            accountId: '@bank',
            category: 'Software',
            scope: 'BUSINESS',
          },
        } as AiRecordDraft,
        account,
      ]);
      const label = finance.createLabel({ name: 'Software' });
      const originalAudit = finance.listAudit();
      const preview = await service.preview(plan.text);
      expect(preview.certain).toBe(true);
      expect(preview.items[0].data).toMatchObject({
        accountId: '@bank',
        category: 'Software',
        scope: 'BUSINESS',
      });
      expect(finance.listAudit()).toEqual(originalAudit);
      expect(service.confirm(preview, `local-${kind}`).saved).toBe(true);
      expect(finance.listTransactions()[0].labelId).toBe(label.id);
      expect(finance.listAccounts()[0].currentBalance).toBe('400.00');
    },
  );
  it('includes effective schedule defaults in a returned confirmation after validation fails', () => {
    const { finance, service, plan } = setup([]);
    const bank = finance.createAccount(account.data as never);
    const schedule = finance.createSubscription({
      service: 'Netflix',
      amount: '100',
      currency: 'TRY',
      frequency: 'MONTHLY',
      nextRenewal: '2026-10-01',
      accountId: bank.id,
      category: 'Software',
      scope: 'BUSINESS',
    });
    plan.items = [
      {
        key: 'pay',
        kind: 'transaction',
        data: {
          type: 'EXPENSE',
          currency: 'TRY',
          description: 'Missing amount',
          subscriptionId: schedule.id,
        },
      },
    ];
    const result = service.confirm(plan, 'invalid-schedule-pay');
    expect(result.saved).toBe(false);
    if (!result.saved)
      expect(result.confirmation.items[0].data).toMatchObject({
        accountId: bank.id,
        category: 'Software',
        scope: 'BUSINESS',
      });
    expect(finance.listTransactions()).toHaveLength(0);
  });
  it('preserves explicit schedule-payment overrides', async () => {
    const { finance, service, plan } = setup([]);
    const entertainment = finance.createLabel({ name: 'Entertainment' });
    const bank = finance.createAccount(account.data as never);
    const cash = finance.createAccount({
      name: 'Cash',
      type: 'CASH',
      currency: 'TRY',
      openingBalance: '500',
    });
    const schedule = finance.createSubscription({
      service: 'Netflix',
      amount: '100',
      currency: 'TRY',
      frequency: 'MONTHLY',
      nextRenewal: '2026-10-01',
      accountId: bank.id,
      category: 'Software',
      scope: 'BUSINESS',
    });
    plan.items = [
      {
        key: 'pay',
        kind: 'transaction',
        data: {
          type: 'EXPENSE',
          amount: '100',
          currency: 'TRY',
          description: 'Payment',
          subscriptionId: schedule.id,
          accountId: cash.id,
          labelId: entertainment.id,
          scope: 'PERSONAL',
        },
      },
    ];
    const preview = await service.preview(plan.text);
    expect(preview.items[0].data).toMatchObject({
      accountId: cash.id,
      labelId: entertainment.id,
      scope: 'PERSONAL',
    });
    expect(service.confirm(preview, 'override-payment').saved).toBe(true);
    expect(finance.listTransactions()[0].labelId).toBe(entertainment.id);
    expect(finance.listAccounts().find((a) => a.id === bank.id)?.currentBalance).toBe('500.00');
    expect(finance.listAccounts().find((a) => a.id === cash.id)?.currentBalance).toBe('400.00');
  });
  it('allows distinct debt types with the same normalized name and currency', () => {
    const { finance, service, plan } = setup([
      {
        key: 'personal',
        kind: 'debt',
        data: { name: 'Loan', type: 'PERSONAL', currency: 'TRY', openingBalance: '10' },
      },
    ]);
    finance.createDebt({ name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '20' });
    expect(service.confirm(plan, 'distinct-debt-types').saved).toBe(true);
    expect(finance.listDebts()).toHaveLength(2);
  });
  it('bounds untrusted notes and plans and preserves provider errors', async () => {
    const { finance, service, plan } = setup([account]);
    await expect(service.preview('x'.repeat(12001))).rejects.toMatchObject({ statusCode: 400 });
    expect(() =>
      service.confirm(
        { ...plan, items: Array.from({ length: 26 }, (_, i) => ({ ...account, key: `bank${i}` })) },
        'oversize-plan',
      ),
    ).toThrow();
    expect(() =>
      service.confirm({ ...plan, items: [{ ...account, key: '../unsafe' }] }, 'unsafe-key-id'),
    ).toThrow();
    const error = Error('Provider offline');
    await expect(
      new AiPlanService(finance, {
        interpret: async () => {
          throw error;
        },
        interpretPlan: async () => {
          throw error;
        },
      }).preview('note'),
    ).rejects.toBe(error);
    expect(finance.listAudit()).toHaveLength(0);
  });
  it('rolls back an earlier account when a later cycle violates ledger rules in preview and confirm', async () => {
    const { finance, service, plan } = setup([
      account,
      { key: 'cycle', kind: 'cycle', data: { name: 'New cycle', start: '2026-10-01' } },
    ]);
    finance.startCycle({ name: 'Existing cycle', start: '2026-09-01' });
    const auditCount = finance.listAudit().length;
    expect((await service.preview(plan.text)).certain).toBe(false);
    expect(service.confirm(plan, 'cycle-conflict').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(auditCount);
  });
  it('preserves arbitrary errors thrown by the authorization callback', () => {
    const { service, plan } = setup([account]);
    const error = Error('Authorization failed');
    expect(() =>
      service.confirm(plan, 'callback-error', () => {
        throw error;
      }),
    ).toThrow(error);
  });
  it('rejects uncertain plans, unknown fields, duplicate keys and wrong existing reference kinds', () => {
    const { finance, service, plan } = setup([account]);
    expect(service.confirm({ ...plan, certain: false }, 'uncertain-plan').saved).toBe(false);
    expect(() => service.confirm({ ...plan, extra: true }, 'unknown-fields')).toThrow();
    expect(() =>
      service.confirm({ ...plan, items: [account, account] }, 'duplicate-keys'),
    ).toThrow();
    const debt = finance.createDebt({ name: 'Old debt', type: 'LOAN', currency: 'TRY' });
    expect(
      service.confirm(
        {
          ...plan,
          items: [{ ...subscription, data: { ...subscription.data, accountId: debt.id } }],
        },
        'wrong-reference',
      ).saved,
    ).toBe(false);
  });
});
