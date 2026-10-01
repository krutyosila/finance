import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import * as Charts from '../src/components/Charts';
import type { FinancialContext } from '../shared/types';
import { Dashboard } from '../src/pages/Dashboard';

vi.mock('../src/auth', () => ({
  useAuth: () => ({ session: { required: false, authenticated: true } }),
}));

function context(): FinancialContext {
  const service = new FinanceService(':memory:');
  try {
    return service.getContext();
  } finally {
    service.close();
  }
}
function renderLabels(data: FinancialContext): string {
  const Chart = (Charts as unknown as Record<'LabelChart', typeof Charts.CategoryChart>).LabelChart;
  expect(Chart).toBeTypeOf('function');
  return renderToStaticMarkup(createElement(Chart, { context: data }));
}

describe('homepage label spending presentation', () => {
  it('uses the same canonical label in recent transactions, including archived names and Etiketsiz', () => {
    const service = new FinanceService(':memory:');
    try {
      const label = service.createLabel({ name: 'Aile gideri' });
      service.createTransaction({
        type: 'EXPENSE',
        amount: '10',
        currency: 'TRY',
        description: 'Alışveriş',
        category: 'Eski kategori',
        labelId: label.id,
      });
      service.archiveLabel(label.id);
      service.createTransaction({
        type: 'EXPENSE',
        amount: '5',
        currency: 'TRY',
        description: 'Küçük harcama',
        category: 'Eski kategori',
        labelId: null,
      });
      const markup = renderToStaticMarkup(
        createElement(Dashboard, {
          context: service.getContext(),
          onQuickEntry: vi.fn(),
          navigate: vi.fn(),
          onCreate: vi.fn(),
          onCycle: vi.fn(),
          onEndCycle: vi.fn(),
          onTransaction: vi.fn(),
        }),
      );
      expect(markup).toContain('Aile gideri');
      expect(markup).toContain('Etiketsiz');
      expect(markup).not.toContain('Eski kategori');
    } finally {
      service.close();
    }
  });

  it('shows managed label amounts and unlabeled spending, using the label currency selector', () => {
    const data = context();
    data.categoryTotals = [{ category: 'Eski kategori', totals: { TRY: '999.00' } }];
    data.labelTotals = [
      { labelId: 'market', label: 'Market', totals: { USD: '19.00' } },
      { labelId: null, label: 'Etiketsiz', totals: { USD: '3.50' } },
      { labelId: 'refund-only', label: 'İadeler', totals: { USD: '-10.00' } },
    ];
    const markup = renderLabels(data);
    expect(markup).toContain('Etiketlere göre gerçek harcamalar.');
    expect(markup).toContain('Etiket grafiği para birimi');
    expect(markup).toContain('USD cinsinden harcama etiketleri');
    expect(markup).toContain('Market');
    expect(markup).toContain('Etiketsiz');
    expect(markup).toContain('19,00 USD');
    expect(markup).toContain('3,50 USD');
    expect(markup).not.toContain('Eski kategori');
    expect(markup).not.toContain('İadeler');
  });

  it('has an honest empty state without falling back to categories when label totals are absent', () => {
    const data = context();
    data.categoryTotals = [{ category: 'Eski kategori', totals: { TRY: '999.00' } }];
    delete data.labelTotals;
    const markup = renderLabels(data);
    expect(markup).toContain('Harcama ekledikçe etiketleriniz burada görünür.');
    expect(markup).not.toContain('Eski kategori');
  });

  it('keeps category charts available for existing category reports', () => {
    const data = context();
    data.categoryTotals = [{ category: 'Eski kategori', totals: { TRY: '999.00' } }];
    data.labelTotals = [{ labelId: 'market', label: 'Market etiketi', totals: { TRY: '10.00' } }];
    const markup = renderToStaticMarkup(createElement(Charts.CategoryChart, { context: data }));
    expect(markup).toContain('Kategorilere göre gerçek harcamalar.');
    expect(markup).toContain('Eski kategori');
    expect(markup).not.toContain('Market etiketi');
  });
});
