import { afterEach, describe, expect, it } from 'vitest';
import type { AiReferences } from '../server/ai/client';
import { AiPlanService } from '../server/ai/plan';
import { FinanceService } from '../server/core/service';
import type { AiPlan, AiRecordDraft, TransactionInput } from '../shared/types';

const fixtures: FinanceService[] = [];
function setup(
  items: AiRecordDraft[] = [],
  duringInterpretation?: (finance: FinanceService) => void,
) {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  const references: AiReferences[] = [];
  const plan: AiPlan = { text: 'Synthetic finance note', certain: true, issues: [], items };
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('Legacy interpreter must not be used');
    },
    interpretPlan: async (_text, context) => {
      references.push(structuredClone(context));
      duringInterpretation?.(finance);
      return structuredClone(plan);
    },
  });
  return { finance, service, plan, references };
}
function tx(key: string, data: Partial<TransactionInput> = {}): AiRecordDraft {
  return {
    key,
    kind: 'transaction',
    data: {
      type: 'INCOME',
      amount: '100',
      currency: 'TRY',
      description: key,
      timestamp: '2026-10-01T12:00:00Z',
      ...data,
    },
  };
}
afterEach(() => fixtures.splice(0).forEach((finance) => finance.close()));

describe('short provider reference aliases', () => {
  it('sends per-kind aliases and aliased credit relationships instead of private persistent IDs', async () => {
    const { finance, service, plan, references } = setup([tx('income')]);
    const bank = finance.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '98765.43',
      notes: 'private account note',
    });
    const card = finance.createAccount({
      name: 'Card',
      type: 'CREDIT_CARD',
      currency: 'TRY',
      currentDebt: '12345.67',
    });
    const debt = finance.listDebts()[0];
    const subscription = finance.createSubscription({
      service: 'Music',
      amount: '123.45',
      currency: 'TRY',
      frequency: 'MONTHLY',
      nextRenewal: '2026-10-10',
      accountId: bank.id,
      category: 'Private subscription category',
      scope: 'BUSINESS',
    });
    const obligation = finance.createObligation({
      name: 'Rent',
      amount: '4321',
      currency: 'TRY',
      frequency: 'MONTHLY',
      dueDate: '2026-10-10',
      accountId: bank.id,
    });
    const cycle = finance.startCycle({ name: 'October', start: '2026-10-01' });
    expect((await service.preview(plan.text)).certain).toBe(true);
    expect(references[0].accounts.map(({ id }) => id)).toEqual([
      'existing_account_1',
      'existing_account_2',
    ]);
    expect(references[0].debts).toEqual([
      {
        id: 'existing_debt_1',
        name: 'Card',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        accountId: 'existing_account_2',
      },
    ]);
    expect(references[0].subscriptions).toEqual([
      { id: 'existing_subscription_1', service: 'Music', currency: 'TRY' },
    ]);
    expect(references[0].obligations).toEqual([
      { id: 'existing_obligation_1', name: 'Rent', currency: 'TRY' },
    ]);
    expect(references[0].currentCycle).toEqual({ id: 'existing_cycle', name: 'October' });
    const payload = JSON.stringify(references[0]);
    for (const id of [bank.id, card.id, debt.id, subscription.id, obligation.id, cycle.id])
      expect(payload).not.toContain(id);
    for (const privateValue of [
      '98765.43',
      '12345.67',
      '123.45',
      '4321',
      'private account note',
      'Private subscription category',
      'BUSINESS',
    ])
      expect(payload).not.toContain(privateValue);
    expect(finance.listTransactions()).toHaveLength(0);
  });

  it('returns persistent IDs for transfer aliases so a confirmed preview uses the intended accounts', async () => {
    const { finance, service, plan } = setup([
      tx('move', {
        type: 'TRANSFER',
        accountId: 'existing_account_1',
        destinationAccountId: 'existing_account_2',
      }),
    ]);
    const source = finance.createAccount({
      name: 'Source',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '500',
    });
    const destination = finance.createAccount({
      name: 'Destination',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({
      accountId: source.id,
      destinationAccountId: destination.id,
    });
    expect(finance.listTransactions()).toHaveLength(0);
    const saved = service.confirm(preview, 'alias-transfer-confirm');
    expect(saved.saved).toBe(true);
    expect(service.confirm(preview, 'alias-transfer-confirm')).toEqual(saved);
    expect(finance.listAccounts().map(({ currentBalance }) => currentBalance)).toEqual([
      '400.00',
      '300.00',
    ]);
    expect(finance.listTransactions()[0]).toMatchObject({
      accountId: source.id,
      destinationAccountId: destination.id,
    });
  });

  it('maps a debt alias and cash account alias to an existing repayment without creating definitions', async () => {
    const { finance, service, plan } = setup([
      tx('repay', {
        type: 'DEBT_PAYMENT',
        accountId: 'existing_account_1',
        debtId: 'existing_debt_1',
      }),
    ]);
    const account = finance.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    const debt = finance.createDebt({
      name: 'Loan',
      type: 'PERSONAL',
      currency: 'TRY',
      openingBalance: '500',
    });
    const auditCount = finance.listAudit().length;
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ accountId: account.id, debtId: debt.id });
    expect(finance.listAudit()).toHaveLength(auditCount);
    expect(service.confirm(preview, 'alias-debt-repayment').saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(finance.listDebts()[0].currentBalance).toBe('400.00');
    expect(finance.listAccounts()[0].currentBalance).toBe('900.00');
  });

  it.each(['subscription', 'obligation'] as const)(
    'resolves an existing %s alias before inheriting private payment defaults',
    async (kind) => {
      const link =
        kind === 'subscription'
          ? { subscriptionId: 'existing_subscription_1' }
          : { obligationId: 'existing_obligation_1' };
      const { finance, service, plan, references } = setup([
        tx('pay', { ...link, type: 'EXPENSE', amount: '20' }),
      ]);
      const account = finance.createAccount({
        name: 'Bank',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '1000',
      });
      const common = {
        amount: '20',
        currency: 'TRY' as const,
        frequency: 'MONTHLY' as const,
        accountId: account.id,
        category: 'Private billing category',
        scope: 'BUSINESS' as const,
      };
      const schedule =
        kind === 'subscription'
          ? finance.createSubscription({ ...common, service: 'Music', nextRenewal: '2026-10-01' })
          : finance.createObligation({ ...common, name: 'Rent', dueDate: '2026-10-01' });
      const auditCount = finance.listAudit().length;
      const preview = await service.preview(plan.text);
      expect(preview.certain).toBe(true);
      expect(preview.items[0].data).toMatchObject({
        [kind === 'subscription' ? 'subscriptionId' : 'obligationId']: schedule.id,
        accountId: account.id,
        category: 'Private billing category',
        scope: 'BUSINESS',
      });
      expect(JSON.stringify(references[0])).not.toContain('Private billing category');
      expect(JSON.stringify(references[0])).not.toContain('BUSINESS');
      expect(finance.listAudit()).toHaveLength(auditCount);
      expect(service.confirm(preview, `alias-${kind}-payment`).saved).toBe(true);
      expect(finance.listAccounts()[0].currentBalance).toBe('980.00');
      expect(finance.listTransactions()[0]).toMatchObject({
        category: 'Private billing category',
        scope: 'BUSINESS',
      });
    },
  );

  it('resolves against the snapshot sent to the provider when another record disappears during interpretation', async () => {
    let firstAccountId = '';
    const { finance, service, plan } = setup(
      [tx('income', { accountId: 'existing_account_2' })],
      (store) => store.deleteAccount(firstAccountId),
    );
    firstAccountId = finance.createAccount({
      name: 'First',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '0',
    }).id;
    const intended = finance.createAccount({
      name: 'Second',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ accountId: intended.id });
    expect(service.confirm(preview, 'stable-snapshot-alias').saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(finance.listAccounts()[0]).toMatchObject({ id: intended.id, currentBalance: '300.00' });
  });

  it('continues to accept exact known persistent IDs from a compatible interpreter', async () => {
    const { finance, service, plan } = setup();
    const account = finance.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    plan.items = [tx('income', { accountId: account.id })];
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ accountId: account.id });
    expect(service.confirm(preview, 'exact-compatible-reference').saved).toBe(true);
    expect(finance.listAccounts()[0].currentBalance).toBe('300.00');
  });

  it.each(['unknown alias', 'truncated persistent ID', 'wrong reference kind'])(
    'does not guess an account for an %s',
    async (variant) => {
      const { finance, service, plan } = setup();
      const account = finance.createAccount({
        name: 'Bank',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '200',
      });
      finance.createDebt({ name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '100' });
      const value =
        variant === 'unknown alias'
          ? 'existing_account_99'
          : variant === 'truncated persistent ID'
            ? account.id.slice(0, 8)
            : 'existing_debt_1';
      plan.items = [tx('income', { accountId: value })];
      const auditCount = finance.listAudit().length;
      const preview = await service.preview(plan.text);
      expect(preview.certain).toBe(false);
      expect(preview.issues.length).toBeGreaterThan(0);
      expect(service.confirm(preview, 'unknown-alias-blocked').saved).toBe(false);
      expect(finance.listTransactions()).toHaveLength(0);
      expect(finance.listAccounts()[0].currentBalance).toBe('200.00');
      expect(finance.listAudit()).toHaveLength(auditCount);
      expect(finance.sqlite.prepare('SELECT COUNT(*) n FROM ai_entry_receipts').get()).toEqual({
        n: 0,
      });
    },
  );
});

describe('provider local keys and alias namespaces', () => {
  it('normalizes exact bare local keys across account, destination, obligation and subscription dependencies', async () => {
    const { finance, service, plan } = setup([
      tx('move', { type: 'TRANSFER', accountId: 'bank', destinationAccountId: 'wallet' }),
      tx('pay-music', { type: 'EXPENSE', amount: '20', subscriptionId: 'music' }),
      tx('pay-rent', { type: 'EXPENSE', amount: '30', obligationId: 'rent' }),
      {
        key: 'music',
        kind: 'subscription',
        data: {
          service: 'Music',
          amount: '20',
          currency: 'TRY',
          frequency: 'MONTHLY',
          nextRenewal: '2026-10-01',
          accountId: 'bank',
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
          dueDate: '2026-10-01',
          accountId: 'bank',
        },
      },
      {
        key: 'wallet',
        kind: 'account',
        data: { name: 'Wallet', type: 'WALLET', currency: 'TRY', openingBalance: '0' },
      },
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'Bank', type: 'BANK', currency: 'TRY', openingBalance: '1000' },
      },
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items.find((item) => item.key === 'move')?.data).toMatchObject({
      accountId: '@bank',
      destinationAccountId: '@wallet',
    });
    expect(preview.items.find((item) => item.key === 'pay-music')?.data).toMatchObject({
      subscriptionId: '@music',
      accountId: '@bank',
    });
    expect(preview.items.find((item) => item.key === 'pay-rent')?.data).toMatchObject({
      obligationId: '@rent',
      accountId: '@bank',
    });
    expect(preview.items.find((item) => item.key === 'music')?.data).toMatchObject({
      accountId: '@bank',
    });
    expect(finance.listAudit()).toHaveLength(0);
    expect(service.confirm(preview, 'bare-local-dependencies').saved).toBe(true);
    expect(finance.listAccounts().find((account) => account.name === 'Bank')?.currentBalance).toBe(
      '850.00',
    );
    expect(
      finance.listAccounts().find((account) => account.name === 'Wallet')?.currentBalance,
    ).toBe('100.00');
    expect(finance.listTransactions()).toHaveLength(3);
  });

  it('normalizes a bare credit account key as its linked debt reference', async () => {
    const { finance, service, plan } = setup([
      tx('purchase', { type: 'EXPENSE', debtId: 'card' }),
      {
        key: 'card',
        kind: 'account',
        data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY', currentDebt: '0' },
      },
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ debtId: '@card' });
    expect(service.confirm(preview, 'bare-credit-debt-reference').saved).toBe(true);
    expect(finance.listTransactions()[0].debtId).toBe(finance.listDebts()[0].id);
    expect(finance.listDebts()[0].currentBalance).toBe('100.00');
  });

  it('normalizes a bare standalone debt key while retaining draw and repayment chronology', async () => {
    const { finance, service, plan } = setup([
      tx('draw', { type: 'DEBT_USAGE', amount: '100', debtId: 'loan', timestamp: '2026-10-01' }),
      tx('repay', { type: 'DEBT_PAYMENT', amount: '100', debtId: 'loan', timestamp: '2026-10-02' }),
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Loan', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
      },
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ debtId: '@loan' });
    expect(preview.items[1].data).toMatchObject({ debtId: '@loan' });
    expect(finance.listAudit()).toHaveLength(0);
    expect(service.confirm(preview, 'bare-standalone-debt').saved).toBe(true);
    expect(finance.listDebts()[0]).toMatchObject({
      currentBalance: '0.00',
      newUsage: '100.00',
      payments: '100.00',
    });
    expect(finance.getContext().metrics.income).toEqual({});
    expect(finance.getContext().metrics.expenses).toEqual({});
  });

  it('does not normalize a bare local cash account key into a valid debt reference', async () => {
    const { finance, service, plan } = setup([
      tx('repay', { type: 'DEBT_PAYMENT', debtId: 'bank' }),
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'Bank', type: 'BANK', currency: 'TRY', openingBalance: '1000' },
      },
    ]);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(false);
    expect(service.confirm(preview, 'bare-cash-debt-blocked').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(0);
  });

  it('blocks a bare reference that collides with an existing alias and a valid local item key', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'existing_account_1',
        kind: 'account',
        data: { name: 'New bank', type: 'BANK', currency: 'TRY', openingBalance: '0' },
      },
      tx('income', { accountId: 'existing_account_1' }),
    ]);
    finance.createAccount({
      name: 'Existing bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    const auditCount = finance.listAudit().length;
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.length).toBeGreaterThan(0);
    expect(service.confirm(preview, 'alias-local-collision').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(auditCount);
  });

  it('keeps an explicit @local key local even when the same spelling is an existing alias', async () => {
    const { finance, service, plan } = setup([
      {
        key: 'existing_account_1',
        kind: 'account',
        data: { name: 'New bank', type: 'BANK', currency: 'TRY', openingBalance: '0' },
      },
      tx('income', { accountId: '@existing_account_1' }),
    ]);
    const existing = finance.createAccount({
      name: 'Existing bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[1].data).toMatchObject({ accountId: '@existing_account_1' });
    expect(service.confirm(preview, 'explicit-local-alias-collision').saved).toBe(true);
    expect(
      finance.listAccounts().find((account) => account.id === existing.id)?.currentBalance,
    ).toBe('200.00');
    expect(
      finance.listAccounts().find((account) => account.name === 'New bank')?.currentBalance,
    ).toBe('100.00');
  });

  it('accepts @ followed by an exact existing alias when there is no local item with that key', async () => {
    const { finance, service, plan } = setup([tx('income', { accountId: '@existing_account_1' })]);
    const account = finance.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '200',
    });
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).toMatchObject({ accountId: account.id });
    expect(service.confirm(preview, 'prefixed-existing-alias').saved).toBe(true);
    expect(finance.listAccounts()[0].currentBalance).toBe('300.00');
  });
});
