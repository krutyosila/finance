import { describe, expect, it } from 'vitest';
import {
  aiKindNames,
  canConfirmPlan,
  describeAiItem,
  appendPlanFollowUp,
} from '../src/components/aiPlanPresentation';
import type { AiPlan, FinancialContext } from '../shared/types';
const context = {
  accounts: [{ id: 'existing', name: 'Maaş hesabı' }],
  debts: [],
  recurringObligations: [],
  subscriptions: [],
} as unknown as FinancialContext;
const plan: AiPlan = {
  text: 'Hesap ve ödeme',
  certain: true,
  issues: [],
  items: [
    { key: 'bank', kind: 'account', data: { name: 'Yeni banka', type: 'BANK', currency: 'TRY' } },
    {
      key: 'pay',
      kind: 'transaction',
      data: {
        description: 'Market',
        amount: '1200',
        currency: 'TRY',
        accountId: '@bank',
        destinationAccountId: 'existing',
        scope: 'BUSINESS',
        type: 'EXPENSE',
      },
    },
  ],
};
describe('AI plan presentation', () => {
  it('names every supported kind in Turkish', () =>
    expect(Object.values(aiKindNames)).toEqual([
      'İşlem',
      'Hesap',
      'Borç',
      'Düzenli ödeme',
      'Abonelik',
      'Dönem',
    ]));
  it('shows money, translated fields and both new and existing links without identifiers', () => {
    const view = describeAiItem(plan.items[1], plan, context);
    expect(view.fields).toContainEqual(['Hesap', 'Yeni banka TL (yeni)']);
    expect(view.fields).toContainEqual(['Hedef hesap', 'Maaş hesabı']);
    expect(view.fields).toContainEqual(['Tutar', '₺1.200,00']);
    expect(view.fields).toContainEqual(['Kapsam', 'İş']);
  });
  it('distinguishes new accounts and conversion links by currency', () => {
    const chain: AiPlan = {
      ...plan,
      items: [
        { key: 'usd', kind: 'account', data: { name: 'Paribu', currency: 'USD' } },
        { key: 'try', kind: 'account', data: { name: 'Paribu', currency: 'TRY' } },
        {
          key: 'conversion',
          kind: 'transaction',
          data: { accountId: '@usd', destinationAccountId: '@try' },
        },
      ],
    };
    expect(describeAiItem(chain.items[0], chain, context).title).toBe('Paribu USD');
    expect(describeAiItem(chain.items[1], chain, context).title).toBe('Paribu TL');
    const fields = describeAiItem(chain.items[2], chain, context).fields;
    expect(fields).toContainEqual(['Hesap', 'Paribu USD (yeni)']);
    expect(fields).toContainEqual(['Hedef hesap', 'Paribu TL (yeni)']);
  });
  it('distinguishes existing source and destination accounts by currency', () => {
    const existing = {
      ...context,
      accounts: [
        { id: 'paribu-usd', name: 'Paribu', currency: 'USD' },
        { id: 'paribu-try', name: 'Paribu', currency: 'TRY' },
      ],
    } as FinancialContext;
    const fields = describeAiItem(
      {
        key: 'conversion',
        kind: 'transaction',
        data: { accountId: 'paribu-usd', destinationAccountId: 'paribu-try' },
      },
      plan,
      existing,
    ).fields;
    expect(fields).toContainEqual(['Hesap', 'Paribu USD']);
    expect(fields).toContainEqual(['Hedef hesap', 'Paribu TL']);
  });
  it.each(['EUR', 'USDT'] as const)('shows %s in account titles and local links', (currency) => {
    const account = { key: 'wallet', kind: 'account' as const, data: { name: 'Cüzdan', currency } };
    const linkedPlan = { ...plan, items: [account] };
    expect(describeAiItem(account, linkedPlan, context).title).toBe(`Cüzdan ${currency}`);
    expect(
      describeAiItem(
        { key: 'income', kind: 'transaction', data: { accountId: '@wallet' } },
        linkedPlan,
        context,
      ).fields,
    ).toContainEqual(['Hesap', `Cüzdan ${currency} (yeni)`]);
  });
  it('keeps account names without a known currency and non-account titles unchanged', () => {
    const account = { key: 'wallet', kind: 'account' as const, data: { name: 'Cüzdan' } };
    const linkedPlan = { ...plan, items: [account] };
    expect(describeAiItem(account, linkedPlan, context).title).toBe('Cüzdan');
    expect(
      describeAiItem(
        { key: 'income', kind: 'transaction', data: { accountId: '@wallet' } },
        linkedPlan,
        context,
      ).fields,
    ).toContainEqual(['Hesap', 'Cüzdan (yeni)']);
    for (const kind of ['debt', 'obligation'] as const) {
      expect(
        describeAiItem({ key: kind, kind, data: { name: 'Ödeme', currency: 'USD' } }, plan, context)
          .title,
      ).toBe('Ödeme');
    }
  });
  it('explains the debt generated alongside a credit account', () => {
    const item = {
      key: 'card',
      kind: 'account' as const,
      data: {
        name: 'Kart',
        type: 'CREDIT_CARD' as const,
        currency: 'TRY' as const,
        currentDebt: '500',
      },
    };
    expect(describeAiItem(item, { ...plan, items: [item] }, context).note).toContain('borç');
  });
  it('blocks empty, uncertain, unresolved or oversized plans', () => {
    expect(canConfirmPlan(plan)).toBe(true);
    for (const invalid of [
      { ...plan, certain: false },
      { ...plan, issues: ['Tarih?'] },
      { ...plan, items: [] },
      { ...plan, items: Array(26).fill(plan.items[0]) },
      { ...plan, text: 'a'.repeat(12001) },
    ])
      expect(canConfirmPlan(invalid)).toBe(false);
  });
  it('retains original context and appends corrections within the total limit', () => {
    expect(appendPlanFollowUp(plan, 'Düzeltme: 1500')).toBe(
      'Hesap ve ödeme\n\nEk bilgi: Düzeltme: 1500',
    );
    expect(() => appendPlanFollowUp({ ...plan, text: 'a'.repeat(12000) }, 'a')).toThrow('12.000');
  });
  it('labels the auto-generated debt link and unresolved references', () => {
    const card = {
      key: 'card',
      kind: 'account' as const,
      data: { name: 'Kart', type: 'CREDIT_CARD' as const, currency: 'TRY' as const },
    };
    const transaction = {
      key: 'expense',
      kind: 'transaction' as const,
      data: { debtId: '@card', accountId: 'missing-id' },
    };
    const fields = describeAiItem(
      transaction,
      { ...plan, items: [card, transaction] },
      context,
    ).fields;
    expect(fields).toContainEqual(['Borç', 'Kart borcu (yeni)']);
    expect(JSON.stringify(fields)).not.toContain('missing-id');
  });
  it('does not assume a currency for an incomplete monetary draft', () => {
    expect(
      describeAiItem({ key: 'x', kind: 'transaction', data: { amount: '1200' } }, plan, context)
        .fields,
    ).toContainEqual(['Tutar', '1200 (para birimi belirtilmedi)']);
  });
  it('formats recurring, subscription, cycle, debt and account fields', () => {
    const items = [
      {
        key: 'o',
        kind: 'obligation' as const,
        data: { name: 'Kira', frequency: 'MONTHLY' as const, dueDate: '2026-10-05', active: false },
      },
      {
        key: 's',
        kind: 'subscription' as const,
        data: { service: 'Müzik', frequency: 'YEARLY' as const, nextRenewal: '2026-11-01' },
      },
      {
        key: 'c',
        kind: 'cycle' as const,
        data: { name: 'Ekim', start: '2026-10-01T00:00:00+03:00' },
      },
      {
        key: 'd',
        kind: 'debt' as const,
        data: {
          name: 'Kredi',
          type: 'LOAN' as const,
          currency: 'USD' as const,
          openingBalance: '100',
        },
      },
    ];
    const views = items.map((item) => describeAiItem(item, { ...plan, items }, context));
    expect(views[0].fields).toContainEqual(['Sıklık', 'Aylık']);
    expect(views[0].fields).toContainEqual(['Durum', 'Pasif']);
    expect(views[0].fields).toContainEqual(['Son ödeme', '5 Ekim 2026']);
    expect(views[1].fields).toContainEqual(['Sıklık', 'Yıllık']);
    expect(views[2].fields).toContainEqual(['Başlangıç', '1 Ekim 2026']);
    expect(views[3].fields).toContainEqual(['Tür', 'Kredi']);
    expect(views[3].fields).toContainEqual(['Başlangıç bakiyesi', '100,00 USD']);
  });
  it('makes omitted transaction time and cycle defaults explicit without mutating drafts', () => {
    const transaction = { key: 't', kind: 'transaction' as const, data: { description: 'Market' } };
    const cycle = { key: 'c', kind: 'cycle' as const, data: {} };
    expect(describeAiItem(transaction, plan, context).fields).toContainEqual([
      'Tarih ve saat',
      'Kaydedildiği an',
    ]);
    const view = describeAiItem(cycle, plan, context);
    expect(view.fields).toContainEqual(['Başlangıç', 'Kaydedildiği an']);
    expect(view.fields).toContainEqual(['Ad', 'Finans dönemi']);
    expect(view.title).toBe('Finans dönemi');
    expect(cycle.data).toEqual({});
  });
  it('retains explicit transaction time and cycle name/start instead of adding default duplicates', () => {
    const transaction = {
      key: 't',
      kind: 'transaction' as const,
      data: { timestamp: '2026-10-01T12:00:00+03:00' },
    };
    const cycle = {
      key: 'c',
      kind: 'cycle' as const,
      data: { name: 'Ekim bütçesi', start: '2026-10-01T00:00:00+03:00' },
    };
    const view = describeAiItem(cycle, plan, context);
    expect(view.title).toBe('Ekim bütçesi');
    expect(view.fields.filter(([label]) => label === 'Ad')).toEqual([['Ad', 'Ekim bütçesi']]);
    expect(view.fields.filter(([label]) => label === 'Başlangıç')).toEqual([
      ['Başlangıç', '1 Ekim 2026'],
    ]);
    expect(describeAiItem(transaction, plan, context).fields).not.toContainEqual([
      'Tarih ve saat',
      'Kaydedildiği an',
    ]);
  });
});
