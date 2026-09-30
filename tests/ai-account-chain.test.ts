import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import { AiPlanService } from '../server/ai/plan';
import type { AiPlan, AiRecordDraft } from '../shared/types';

const fixtures: FinanceService[] = [];
const text =
  "Paribu hesabıma 2500 dolar geldi, bunu TL'ye çevirdim ve 90000 TL'sini VakıfBank hesabıma attım. Kalanı Paribu hesabımda.";
function chain(total?: string, rate?: string): AiPlan {
  return {
    text,
    certain: true,
    issues: [],
    items: [
      {
        key: 'paribu_usd',
        kind: 'account',
        data: { name: 'Paribu', type: 'WALLET', currency: 'USD' },
      },
      {
        key: 'paribu_try',
        kind: 'account',
        data: { name: 'Paribu', type: 'WALLET', currency: 'TRY' },
      },
      { key: 'vakif', kind: 'account', data: { name: 'VakıfBank', type: 'BANK', currency: 'TRY' } },
      {
        key: 'deposit',
        kind: 'transaction',
        data: {
          type: 'INCOME',
          amount: '2500',
          currency: 'USD',
          accountId: '@paribu_usd',
          description: 'Paribu para gelişi',
        },
      },
      {
        key: 'fx',
        kind: 'transaction',
        data: {
          type: 'TRANSFER',
          amount: '2500',
          currency: 'USD',
          accountId: '@paribu_usd',
          destinationAccountId: '@paribu_try',
          destinationAmount: total,
          exchangeRate: rate,
          description: 'Paribu döviz çevrimi',
        },
      },
      {
        key: 'transfer',
        kind: 'transaction',
        data: {
          type: 'TRANSFER',
          amount: '90000',
          currency: 'TRY',
          accountId: '@paribu_try',
          destinationAccountId: '@vakif',
          description: 'VakıfBank aktarımı',
        },
      },
    ],
  };
}
function setup(plan = chain('100000')) {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  const service = new AiPlanService(finance, {
    interpret: async () => {
      throw Error('legacy');
    },
    interpretPlan: async () => structuredClone(plan),
  });
  return { finance, service, plan };
}
function balances(finance: FinanceService) {
  return Object.fromEntries(
    finance
      .listAccounts()
      .map((account) => [`${account.name}:${account.currency}`, account.currentBalance]),
  );
}
function accountData(plan: AiPlan, key: string) {
  const item = plan.items.find((item) => item.key === key);
  if (item?.kind !== 'account') throw Error('Expected account draft');
  return item.data;
}
function transactionData(plan: AiPlan, key: string) {
  const item = plan.items.find((item) => item.key === key);
  if (item?.kind !== 'transaction') throw Error('Expected transaction draft');
  return item.data;
}
function expectNoWrites(finance: FinanceService) {
  expect(finance.listTransactions()).toHaveLength(0);
  expect(finance.listAudit()).toHaveLength(0);
  expect(finance.sqlite.prepare('SELECT COUNT(*) n FROM ai_entry_receipts').get()).toEqual({
    n: 0,
  });
}
afterEach(() => {
  fixtures.splice(0).forEach((finance) => finance.close());
  vi.restoreAllMocks();
});

describe('AI deposit, currency conversion and transfer chains', () => {
  it('proposes missing movement accounts and records the complete chain once without double-counting income', async () => {
    const { finance, service, plan } = setup();
    const preview = await service.preview(text);
    expect(preview.certain).toBe(true);
    expect(
      preview.items
        .filter((item) => item.kind === 'account')
        .map((item) => item.data.openingBalance),
    ).toEqual(['0.00', '0.00', '0.00']);
    expect(accountData(preview, 'paribu_usd').notes).toContain('kayıt başlangıcı');
    expect(plan.items[0].data).not.toHaveProperty('openingBalance');
    expect(finance.listAccounts()).toHaveLength(0);
    expectNoWrites(finance);
    const saved = service.confirm(preview, 'paribu-chain-request');
    expect(saved.saved).toBe(true);
    expect(service.confirm(preview, 'paribu-chain-request')).toEqual(saved);
    expect(finance.listAccounts()).toHaveLength(3);
    expect(finance.listTransactions()).toHaveLength(3);
    expect(balances(finance)).toEqual({
      'Paribu:USD': '0.00',
      'Paribu:TRY': '10000.00',
      'VakıfBank:TRY': '90000.00',
    });
    expect(finance.getContext().metrics.income).toEqual({ USD: '2500.00' });
    expect(finance.getContext().metrics.expenses).toEqual({});
    expect(finance.getContext().metrics.cashOutflow).toEqual({});
  });
  it('asks for actual converted proceeds rather than treating the downstream 90000 transfer as the total', async () => {
    const { finance, service } = setup(chain());
    const preview = await service.preview(text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toMatch(/net kaç TL/);
    expect(preview.items).toHaveLength(6);
    expect(transactionData(preview, 'fx').destinationAmount).toBeUndefined();
    expect(transactionData(preview, 'transfer').amount).toBe('90000');
    expect(service.confirm(preview, 'missing-fx-total').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
    expectNoWrites(finance);
  });
  it('prepares known account drafts even when the provider has already asked about the missing conversion total', async () => {
    const plan = chain();
    plan.certain = false;
    plan.issues = ['Döviz çevriminden net kaç TL geldi?'];
    const { finance, service } = setup(plan);
    const preview = await service.preview(text);
    expect(accountData(preview, 'paribu_usd').openingBalance).toBe('0.00');
    expect(preview.certain).toBe(false);
    expectNoWrites(finance);
  });
  it('uses an explicit TRY rate with exact money arithmetic to complete the conversion', async () => {
    const { finance, service, plan } = setup(chain(undefined, '40'));
    const preview = await service.preview(`${text}\n\nEk bilgi: Doları 40 TL kurla çevirdim.`);
    expect(preview.certain).toBe(true);
    expect(transactionData(preview, 'fx').destinationAmount).toBe('100000.00');
    expect(transactionData(plan, 'fx').destinationAmount).toBeUndefined();
    expect(service.confirm(plan, 'explicit-rate-chain').saved).toBe(true);
    expect(balances(finance)['Paribu:TRY']).toBe('10000.00');
  });
  it('blocks contradictory conversion rates and target totals without partial records', async () => {
    const { finance, service, plan } = setup(chain('105000', '40'));
    const preview = await service.preview(text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toContain('uyuşmuyor');
    expect(service.confirm(plan, 'conflicting-rate').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(0);
    expectNoWrites(finance);
  });
  it.each(['0', '-40', 'NaN', '999999999999999999999'])(
    'blocks invalid or overflowing rates %s',
    async (rate) => {
      const { finance, service, plan } = setup(chain(undefined, rate));
      const preview = await service.preview(text);
      expect(preview.certain).toBe(false);
      expect(preview.issues.join(' ')).toMatch(/kur|sınır/);
      expect(preview.issues.join(' ')).not.toContain('açılış bakiyesi');
      expect(service.confirm(plan, 'invalid-chain-rate').saved).toBe(false);
      expectNoWrites(finance);
    },
  );
  it('reuses unique existing currency accounts and preserves their prior balances even when the inferred type differs', async () => {
    const { finance, service, plan } = setup();
    const usd = finance.createAccount({
      name: 'Paribu',
      type: 'BANK',
      currency: 'USD',
      openingBalance: '10',
    });
    const lira = finance.createAccount({
      name: 'paribu',
      type: 'WALLET',
      currency: 'TRY',
      openingBalance: '3000',
    });
    const bank = finance.createAccount({
      name: 'VakıfBank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '500',
    });
    const auditCount = finance.listAudit().length;
    const preview = await service.preview(text);
    expect(preview.certain).toBe(true);
    expect(preview.items.every((item) => item.kind === 'transaction')).toBe(true);
    expect(transactionData(preview, 'deposit').accountId).toBe(usd.id);
    expect(transactionData(preview, 'fx').destinationAccountId).toBe(lira.id);
    expect(transactionData(preview, 'transfer').destinationAccountId).toBe(bank.id);
    expect(finance.listAudit()).toHaveLength(auditCount);
    expect(service.confirm(plan, 'reuse-existing-chain').saved).toBe(true);
    expect(finance.listAccounts()).toHaveLength(3);
    expect(balances(finance)).toEqual({
      'Paribu:USD': '10.00',
      'paribu:TRY': '13000.00',
      'VakıfBank:TRY': '90500.00',
    });
    expect(service.confirm(plan, 'reuse-existing-chain').saved).toBe(true);
    expect(finance.listTransactions()).toHaveLength(3);
  });
  it('creates only the missing currency counterpart and destination account', async () => {
    const { finance, service } = setup();
    const old = finance.createAccount({
      name: 'Paribu',
      type: 'WALLET',
      currency: 'TRY',
      openingBalance: '50',
    });
    const preview = await service.preview(text);
    expect(preview.certain).toBe(true);
    expect(preview.items.filter((item) => item.kind === 'account')).toHaveLength(2);
    expect(transactionData(preview, 'fx').destinationAccountId).toBe(old.id);
    expect(service.confirm(preview, 'partial-chain-accounts').saved).toBe(true);
    expect(balances(finance)['Paribu:TRY']).toBe('10050.00');
  });
  it('asks about an explicit conflicting opening balance instead of creating a duplicate currency account', async () => {
    const plan = chain('100000');
    accountData(plan, 'paribu_usd').openingBalance = '0';
    const { finance, service } = setup(plan);
    finance.createAccount({ name: 'Paribu', type: 'BANK', currency: 'USD', openingBalance: '10' });
    const audits = finance.listAudit().length;
    const preview = await service.preview(text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toContain('mevcut');
    expect(service.confirm(plan, 'conflicting-chain-opening').saved).toBe(false);
    expect(finance.listAccounts()).toHaveLength(1);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(audits);
  });
  it.each([{ currentDebt: '100' }, { creditLimit: '1.001' }, { openingBalance: '1.001' }])(
    'validates supplied financial fields before reusing an existing account: %s',
    async (fields) => {
      const plan = chain('100000');
      Object.assign(accountData(plan, 'paribu_usd'), fields);
      const { finance, service } = setup(plan);
      finance.createAccount({
        name: 'Paribu',
        type: 'BANK',
        currency: 'USD',
        openingBalance: '10',
      });
      const audits = finance.listAudit().length;
      expect((await service.preview(text)).certain).toBe(false);
      expect(service.confirm(plan, 'invalid-reused-account').saved).toBe(false);
      expect(finance.listAccounts()).toHaveLength(1);
      expect(finance.listTransactions()).toHaveLength(0);
      expect(finance.listAudit()).toHaveLength(audits);
    },
  );
  it('asks for account selection when the same institution and currency have multiple matches', async () => {
    const { finance, service, plan } = setup();
    finance.createAccount({ name: 'Paribu', type: 'BANK', currency: 'USD', openingBalance: '0' });
    finance.createAccount({ name: 'Paribu', type: 'WALLET', currency: 'USD', openingBalance: '0' });
    const audits = finance.listAudit().length;
    const preview = await service.preview(text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toContain('birden fazla');
    expect(service.confirm(plan, 'ambiguous-chain').saved).toBe(false);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(audits);
  });
  it('keeps the explicit balance requirement for standalone definitions and credit accounts', async () => {
    for (const item of [
      { key: 'a', kind: 'account', data: { name: 'Bank', type: 'BANK', currency: 'TRY' } },
      { key: 'd', kind: 'debt', data: { name: 'Loan', type: 'LOAN', currency: 'TRY' } },
      { key: 'c', kind: 'account', data: { name: 'Card', type: 'CREDIT_CARD', currency: 'TRY' } },
    ] as AiRecordDraft[]) {
      const { service, plan } = setup({ ...chain(), items: [item] });
      const result = service.confirm(plan, 'standalone-chain-balance');
      expect(result.saved).toBe(false);
      if (!result.saved) expect(result.confirmation.issues.join(' ')).toContain('açılış bakiyesi');
    }
  });
  it('preserves explicitly supplied opening balances on newly linked accounts', async () => {
    const plan = chain('100000');
    accountData(plan, 'paribu_try').openingBalance = '300';
    const { finance, service } = setup(plan);
    const preview = await service.preview(text);
    expect(accountData(preview, 'paribu_try').openingBalance).toBe('300');
    expect(service.confirm(preview, 'explicit-chain-opening').saved).toBe(true);
    expect(balances(finance)['Paribu:TRY']).toBe('10300.00');
  });
  it('assigns one shared timestamp to undated movements and preserves their economic insertion order', () => {
    const plan = chain('100000');
    for (const item of plan.items) if (item.kind === 'account') item.data.openingBalance = '0';
    const { finance, service } = setup(plan);
    let tick = 0;
    const normalize = finance.normalizeTransactionTimestamp.bind(finance);
    vi.spyOn(finance, 'normalizeTransactionTimestamp').mockImplementation((value) =>
      value ? normalize(value) : new Date(Date.UTC(2026, 9, 1, 12, 0, 0, tick++)).toISOString(),
    );
    expect(service.confirm(plan, 'shared-chain-time').saved).toBe(true);
    const transactions = finance.listTransactions();
    expect(new Set(transactions.map((transaction) => transaction.timestamp)).size).toBe(1);
    const inserted = finance.sqlite.prepare('SELECT type FROM transactions ORDER BY rowid').all();
    expect(inserted).toEqual([{ type: 'INCOME' }, { type: 'TRANSFER' }, { type: 'TRANSFER' }]);
  });
});
