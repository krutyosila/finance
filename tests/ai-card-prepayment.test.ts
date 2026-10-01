import { afterEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';
import { AiPlanService } from '../server/ai/plan';
import type { AiPlan, AiRecordDraft } from '../shared/types';

const ledgers: FinanceService[] = [];
function setup(items: AiRecordDraft[]) {
  const finance = new FinanceService(':memory:');
  ledgers.push(finance);
  const plan: AiPlan = {
    text: 'DenizBank TL hesabımdan borcu sıfır olan kredi kartıma 3000 TL yükledim.',
    certain: true,
    issues: [],
    items,
  };
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('unused');
    },
    interpretPlan: async () => plan,
  });
  return { finance, plan, service };
}
function state(finance: FinanceService) {
  return JSON.stringify({
    accounts: finance.listAccounts(),
    debts: finance.listDebts(),
    transactions: finance.listTransactions(),
    audit: finance.listAudit(),
    receipts: finance.sqlite.prepare('SELECT * FROM ai_entry_receipts').all(),
  });
}
function payment(accountId: string, debtId: string): AiRecordDraft {
  return {
    key: 'load',
    kind: 'transaction',
    data: {
      type: 'DEBT_PAYMENT',
      amount: '3000',
      currency: 'TRY',
      accountId,
      debtId,
      description: 'Kredi kartına para yükleme',
    },
  };
}
afterEach(() => ledgers.splice(0).forEach((finance) => finance.close()));

describe('AI credit card prepayments', () => {
  it('previews a zero-debt card load without writes and confirms it exactly once', async () => {
    const { finance, plan, service } = setup([]);
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
    plan.items.push(payment(bank.id, finance.listDebts()[0].id));
    const before = state(finance);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(state(finance)).toBe(before);
    const result = service.confirm(preview, 'deniz-card-load');
    expect(result.saved).toBe(true);
    const after = state(finance);
    expect(service.confirm(preview, 'deniz-card-load')).toEqual(result);
    expect(state(finance)).toBe(after);
    expect(finance.listTransactions()).toHaveLength(1);
    expect(finance.listAccounts().find((item) => item.id === bank.id)?.currentBalance).toBe(
      '2000.00',
    );
    expect(finance.listAccounts().find((item) => item.id === card.id)).toMatchObject({
      openingBalance: '0.00',
      currentDebt: '0.00',
      currentBalance: '3000.00',
    });
    expect(finance.getContext().metrics).toMatchObject({
      income: {},
      expenses: {},
      debt: { TRY: '0.00' },
      assets: { TRY: '5000.00' },
    });
  });

  it('links new bank and credit card definitions without inventing opening debt', async () => {
    const { finance, plan, service } = setup([
      payment('@bank', '@card'),
      {
        key: 'card',
        kind: 'account',
        data: {
          name: 'DenizBank kredi kartı',
          type: 'CREDIT_CARD',
          currency: 'TRY',
          currentDebt: '0',
        },
      },
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'DenizBank TL', type: 'BANK', currency: 'TRY', openingBalance: '5000' },
      },
    ]);
    const before = state(finance);
    const preview = await service.preview(plan.text);
    expect(preview.certain).toBe(true);
    expect(state(finance)).toBe(before);
    expect(service.confirm(preview, 'new-deniz-card-load').saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(2);
    expect(finance.listDebts()).toHaveLength(1);
    expect(finance.listDebts()[0]).toMatchObject({
      openingBalance: '0.00',
      currentBalance: '-3000.00',
      payments: '0.00',
    });
  });

  it('rolls back a valid card load if a later unrelated loan overpayment fails', () => {
    const { finance, service, plan } = setup([
      {
        key: 'bank',
        kind: 'account',
        data: { name: 'DenizBank TL', type: 'BANK', currency: 'TRY', openingBalance: '5000' },
      },
      {
        key: 'card',
        kind: 'account',
        data: {
          name: 'DenizBank kredi kartı',
          type: 'CREDIT_CARD',
          currency: 'TRY',
          currentDebt: '0',
        },
      },
      payment('@bank', '@card'),
      {
        key: 'loan',
        kind: 'debt',
        data: { name: 'Kredi', type: 'LOAN', currency: 'TRY', openingBalance: '0' },
      },
      {
        key: 'overpay',
        kind: 'transaction',
        data: {
          type: 'DEBT_PAYMENT',
          amount: '1',
          currency: 'TRY',
          accountId: '@bank',
          debtId: '@loan',
          description: 'Geçersiz kredi ödemesi',
        },
      },
    ]);
    const before = state(finance);
    const result = service.confirm(plan, 'invalid-loan-after-card-load');
    expect(result.saved).toBe(false);
    expect(state(finance)).toBe(before);
  });
});
