import { beforeEach, afterEach, it, expect } from 'vitest';
import { FinanceService } from '../server/core/service';
let s: FinanceService;
beforeEach(() => {
  s = new FinanceService(':memory:');
});
afterEach(() => s?.close());
it.each([
  ['1200 market', 'EXPENSE', '1200.00', 'TRY', 'Market'],
  ['30000 kira ödedim', 'EXPENSE', '30000.00', 'TRY', 'Kira'],
  ['500 yemek', 'EXPENSE', '500.00', 'TRY', 'Yemek'],
  ['300 USD ödeme geldi', 'INCOME', '300.00', 'USD', 'Gelir'],
  ['24 USD domain yenilendi', 'EXPENSE', '24.00', 'USD', 'Alan adı'],
  ['4500 müşteriden geldi', 'INCOME', '4500.00', 'TRY', 'Gelir'],
  ['128000 ödeme geldi', 'INCOME', '128000.00', 'TRY', 'Gelir'],
  ['1.200,50 market', 'EXPENSE', '1200.50', 'TRY', 'Market'],
  ['450 market', 'EXPENSE', '450.00', 'TRY', 'Market'],
])('parses %s deterministically', (text, type, amount, currency, category) => {
  const p = s.parse(text);
  expect(p.certain).toBe(true);
  expect(p.draft).toMatchObject({ type, amount, currency, category });
});
it('requires explicit existing debt and distinguishes usage and repayments', () => {
  expect(s.addText('15000 KMH ödedim').saved).toBe(false);
  const d = s.createDebt({
    name: 'Bank KMH',
    type: 'OVERDRAFT',
    currency: 'TRY',
    openingBalance: '20000',
  });
  expect(s.parse('15000 KMH ödedim').draft).toMatchObject({ type: 'DEBT_PAYMENT', debtId: d.id });
  expect(s.addText('15000 KMH ödedim').saved).toBe(true);
  expect(s.parse('5000 KMH kullandım').draft.type).toBe('DEBT_USAGE');
  expect(s.getContext().expenses.TRY).toBeUndefined();
});
it('does not guess ambiguous or missing classifications, amounts, currencies or debt', () => {
  for (const text of [
    '450',
    'market',
    '450 bir şey',
    '100 market 200 yemek',
    '100 GBP market',
    '100 geldi ödedim',
  ])
    expect(s.parse(text).certain, text).toBe(false);
  s.createDebt({ name: 'KMH A', type: 'OVERDRAFT', currency: 'TRY' });
  s.createDebt({ name: 'KMH B', type: 'OVERDRAFT', currency: 'TRY' });
  expect(s.parse('100 KMH kullandım').certain).toBe(false);
  expect(s.getContext().transactionCount).toBe(0);
});
it('never silently invents currency rates', () => {
  const p = s.parse('24 USD domain yenilendi');
  expect(p.draft.amountTRY).toBeUndefined();
  expect(p.draft.exchangeRate).toBeUndefined();
});
it('unmatched credit card and unknown debt usage require confirmation', () => {
  expect(s.parse('100 kredi kartı ödedim').certain).toBe(false);
  expect(s.parse('100 borç kullandım').certain).toBe(false);
});

it('provides Turkish confirmation messages without rewriting entered descriptions', () => {
  const p = s.parse('450 bir şey');
  expect(p.issues).toContain('İşlem türünü ve kategorisini seçin');
  expect(p.draft.description).toBe('450 bir şey');
});
