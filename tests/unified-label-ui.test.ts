import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinancialContext, Obligation, Transaction } from '../shared/types';
import { TransactionForm } from '../src/components/TransactionForm';
import { RecordForm } from '../src/components/RecordForms';
import { Transactions } from '../src/pages/Transactions';
import { describeAiItem } from '../src/components/aiPlanPresentation';
import { History } from '../src/components/History';

const records = vi.hoisted(() => [] as Transaction[]);
const resourceState = vi.hoisted(() => ({ loading: false, error: '' }));
vi.mock('../src/api', () => ({
  api: vi.fn(),
  useResource: () => ({ data: records, ...resourceState, refresh: vi.fn() }),
}));
const context = {
  accounts: [],
  debts: [],
  subscriptions: [],
  recurringObligations: [],
  categoryTotals: [{ category: 'Eski ayrı kategori', totals: { TRY: '100.00' } }],
  labels: [
    { id: 'home', name: 'Ev', archived: false },
    { id: 'old', name: 'Eski etiket', archived: true },
  ],
} as unknown as FinancialContext;
const noop = () => {};
afterEach(() => {
  records.length = 0;
  resourceState.loading = false;
  resourceState.error = '';
});

describe('one visible label taxonomy', () => {
  it('offers one managed transaction label and no parallel category field', () => {
    const markup = renderToStaticMarkup(
      createElement(TransactionForm, { context, onClose: noop, onSaved: noop }),
    );
    expect(markup).toContain('Etiket');
    expect(markup).toContain('value="home"');
    expect(markup).not.toContain('Kategori');
    expect(markup).not.toContain('kategoriden ayrıdır');
    expect(markup).not.toContain('Eski ayrı kategori');
    expect(markup.match(/<select[^>]*>[^]*?Etiket yok/g)).toHaveLength(1);
  });

  it('shows the managed label once in transactions without legacy category text', () => {
    records.push({
      id: 'expense',
      type: 'EXPENSE',
      description: 'Koltuk',
      amount: '100.00',
      currency: 'TRY',
      category: 'Eski ayrı kategori',
      labelId: 'home',
      timestamp: '2026-10-01T09:00:00Z',
      accountId: null,
      scope: 'PERSONAL',
    } as Transaction);
    const markup = renderToStaticMarkup(
      createElement(Transactions, {
        context,
        revision: 0,
        onAdd: noop,
        onEdit: noop,
        onDelete: noop,
        onRestore: noop,
        onDuplicate: noop,
        onHistory: noop,
      }),
    );
    records.length = 0;
    expect(markup).toContain('Etiket: Ev');
    expect(markup).toContain('Açıklama, etiket veya notlarda ara');
    expect(markup).not.toContain('Eski ayrı kategori');
    expect(markup).not.toContain('Kategorisiz');
  });

  it('preserves loaded transaction rows when refresh fails or is still loading', () => {
    records.push({
      id: 'expense',
      type: 'EXPENSE',
      description: 'Koltuk',
      amount: '100.00',
      currency: 'TRY',
      labelId: 'home',
      timestamp: '2026-10-01T09:00:00Z',
      accountId: null,
    } as Transaction);
    resourceState.loading = true;
    resourceState.error = 'Yenileme tamamlanamadı.';
    const markup = renderToStaticMarkup(
      createElement(Transactions, {
        context,
        revision: 0,
        onAdd: noop,
        onEdit: noop,
        onDelete: noop,
        onRestore: noop,
        onDuplicate: noop,
        onHistory: noop,
      }),
    );
    expect(markup).toContain('Yenileme tamamlanamadı.');
    expect(markup).toContain('Koltuk');
    expect(markup).toContain('Etiket: Ev');
    expect(markup).toContain('aria-busy="true"');
  });

  it('shows one named label change in transaction history instead of duplicate classifications', () => {
    records.push({
      id: 'audit',
      entity: 'TRANSACTION',
      action: 'EDIT',
      timestamp: '2026-10-01T09:00:00Z',
      before: { category: 'Eski ayrı kategori', labelId: null },
      after: { category: 'Başka ayrı kategori', labelId: 'home' },
    } as unknown as Transaction);
    const markup = renderToStaticMarkup(createElement(History, { entityId: 'expense', context }));
    expect(markup).toContain('<dt>Etiket</dt>');
    expect(markup).toContain('Etiket yok');
    expect(markup).toContain('Ev');
    expect(markup).not.toContain('Kategori');
    expect(markup).not.toContain('ayrı kategori');
    expect(markup).not.toContain('home');
    expect(markup.match(/<dt>Etiket<\/dt>/g)).toHaveLength(1);
  });

  it('selects scheduled labels from the active catalog while preserving an archived existing name', () => {
    const markup = renderToStaticMarkup(
      createElement(RecordForm, {
        kind: 'recurring',
        context,
        onClose: noop,
        onSaved: noop,
        record: {
          id: 'schedule',
          name: 'Kira',
          category: 'Eski etiket',
          currency: 'TRY',
        } as Obligation,
      }),
    );
    expect(markup).not.toContain('Kategori');
    expect(markup).not.toContain('Kendi kategorinizi');
    expect(markup).toContain('Etiket yok');
    expect(markup).toContain('value="Ev"');
    expect(markup).toContain('Eski etiket (arşivlenmiş)');
    expect(markup).not.toContain('value="old"');
  });

  it('hides legacy transaction category in AI previews and calls schedule classification Etiket', () => {
    const plan = { text: 'Not', certain: true, issues: [], items: [] };
    const transaction = describeAiItem(
      {
        key: 'expense',
        kind: 'transaction',
        data: {
          description: 'Koltuk',
          category: 'Eski ayrı kategori',
          labelId: 'home',
        },
      },
      plan,
      context,
    );
    expect(transaction.fields).toContainEqual(['Etiket', 'Ev']);
    expect(transaction.fields).not.toContainEqual(['Kategori', 'Eski ayrı kategori']);
    expect(transaction.fields.filter(([name]) => name === 'Etiket')).toHaveLength(1);
    const schedule = describeAiItem(
      {
        key: 'rent',
        kind: 'obligation',
        data: {
          name: 'Kira',
          category: 'Ev',
        },
      },
      plan,
      context,
    );
    expect(schedule.fields).toContainEqual(['Etiket', 'Ev']);
    expect(schedule.fields).not.toContainEqual(['Kategori', 'Ev']);
  });

  it('keeps an equivalent legacy schedule name selected as its canonical catalog label', () => {
    const markup = renderToStaticMarkup(
      createElement(RecordForm, {
        kind: 'recurring',
        context,
        onClose: noop,
        onSaved: noop,
        record: {
          id: 'schedule',
          name: 'Aidat',
          category: '  eV  ',
          currency: 'TRY',
        } as Obligation,
      }),
    );
    expect(markup).toContain('<option value="Ev" selected="">Ev</option>');
    expect(markup).not.toContain('value="  eV  "');
  });
});
