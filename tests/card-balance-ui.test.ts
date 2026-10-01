import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Account, Debt, FinancialContext } from '../shared/types';
import { Records } from '../src/pages/Records';
import {
  accountBalancePresentation,
  debtBalancePresentation,
} from '../src/components/balancePresentation';

const account: Account = {
  id: 'card',
  name: 'Denizbank kredi kartı',
  type: 'CREDIT_CARD',
  currency: 'TRY',
  owner: 'Ben',
  openingBalance: '0.00',
  currentBalance: '3000.00',
  currentDebt: '0.00',
  creditLimit: null,
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-01T09:00:00Z',
};
const debt: Debt = {
  id: 'card-debt',
  name: account.name,
  type: 'CREDIT_CARD',
  currency: 'TRY',
  openingBalance: '0.00',
  currentBalance: '-3000.00',
  payments: '3000.00',
  newUsage: '0.00',
  interest: '0.00',
  fees: '0.00',
  netChange: '-3000.00',
  creditLimit: null,
  accountId: account.id,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
};

function renderRecord(kind: 'accounts' | 'debts', record: Account | Debt) {
  const context = {
    accounts: kind === 'accounts' ? [record] : [],
    debts: kind === 'debts' ? [record] : [],
    unassignedCash: {},
    metrics: {
      availableCash: {},
      savings: {},
      assets: {},
      debt: {},
      debtPayments: {},
      debtUsage: {},
    },
  } as unknown as FinancialContext;
  return renderToStaticMarkup(
    createElement(Records, {
      kind,
      context,
      onAdd: () => {},
      onEdit: () => {},
      onDelete: () => {},
      onHistory: () => {},
      onPay: () => {},
    }),
  );
}

describe('Credit card balance presentation', () => {
  it('shows prepaid funds on the account instead of only its zero debt', () => {
    const html = renderRecord('accounts', account);
    expect(html).toContain('<span>Kart bakiyesi</span><strong>₺3.000,00</strong>');
    expect(html).not.toContain('<span>Güncel borç</span><strong>₺0,00</strong>');
  });

  it('shows the linked card debt credit as a positive card balance', () => {
    const html = renderRecord('debts', debt);
    expect(html).toContain('<span>Kart bakiyesi</span><strong>₺3.000,00</strong>');
    expect(html).not.toContain('<span>Güncel borç</span><strong>₺−3.000,00</strong>');
  });

  it.each(['0.00', '3000.00'])('keeps card debt %s labeled as debt', (balance) => {
    const html = renderRecord('accounts', {
      ...account,
      currentDebt: balance,
      currentBalance: balance === '0.00' ? '0.00' : `-${balance}`,
    });
    expect(html).toContain('<span>Güncel borç</span>');
    expect(html).not.toContain('Kart bakiyesi');
  });

  it('keeps a bank balance labeled as a balance', () => {
    const html = renderRecord('accounts', { ...account, type: 'BANK', currentDebt: null });
    expect(html).toContain('<span>Güncel bakiye</span><strong>₺3.000,00</strong>');
    expect(html).not.toContain('Kart bakiyesi');
  });

  it('keeps KMH balances labeled as debt', () => {
    const html = renderRecord('accounts', {
      ...account,
      type: 'OVERDRAFT',
      currentBalance: '-3000.00',
      currentDebt: '3000.00',
    });
    expect(html).toContain('<span>Güncel borç</span><strong>₺3.000,00</strong>');
    expect(html).not.toContain('Kart bakiyesi');
  });

  it.each(['0.01', '3000.00', '90071992547409.91'])(
    'preserves the exact prepaid card amount %s for both accounts and reports',
    (amount) => {
      expect(accountBalancePresentation({ ...account, currentBalance: amount })).toEqual({
        label: 'Kart bakiyesi',
        amount,
      });
      expect(debtBalancePresentation({ ...debt, currentBalance: `-${amount}` })).toEqual({
        label: 'Kart bakiyesi',
        amount,
      });
    },
  );

  it.each(['CREDIT_CARD', 'OVERDRAFT', 'LOAN', 'PERSONAL', 'OTHER'] as const)(
    'keeps a positive %s debt amount unchanged in reports',
    (type) => {
      expect(debtBalancePresentation({ ...debt, type, currentBalance: '3000.00' })).toEqual({
        label: 'Güncel borç',
        amount: '3000.00',
      });
    },
  );

  it('does not label a cleared card debt as prepaid funds', () => {
    expect(debtBalancePresentation({ ...debt, currentBalance: '0.00' })).toEqual({
      label: 'Güncel borç',
      amount: '0.00',
    });
  });
});
