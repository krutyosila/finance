import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../server/core/service';
import { Reports } from '../src/pages/Reports';

const resources = vi.hoisted(() => ({
  report: {} as Record<string, unknown>,
  cycles: {} as Record<string, unknown>,
}));
vi.mock('../src/api', () => ({
  useResource: (path: string) =>
    path.startsWith('/reports') ? resources.report : resources.cycles,
}));

describe('reports during a page refresh', () => {
  it('keeps existing report and period options mounted next to refresh errors', () => {
    const service = new FinanceService(':memory:');
    try {
      service.createTransaction({
        type: 'INCOME',
        amount: '1234',
        currency: 'TRY',
        description: 'Gelir',
      });
      const context = service.getContext();
      resources.report = {
        data: context,
        error: 'Rapor yenilenemedi',
        loading: false,
        refresh: vi.fn(),
      };
      resources.cycles = {
        data: [
          {
            id: 'past-cycle',
            name: 'Geçmiş dönem',
            start: '2026-09-01T12:00:00Z',
            end: '2026-09-30T12:00:00Z',
          },
        ],
        error: 'Dönemler yenilenemedi',
        loading: false,
        refresh: vi.fn(),
      };
      const markup = renderToStaticMarkup(
        createElement(Reports, {
          context,
          revision: 2,
          onExport: vi.fn(),
          onCycle: vi.fn(),
          onEndCycle: vi.fn(),
        }),
      );
      expect(markup).toContain('Rapor yenilenemedi');
      expect(markup).toContain('Dönemler yenilenemedi');
      expect(markup).toContain('class="report-content"');
      expect(markup).toContain('₺1.234,00');
      expect(markup).toContain('Geçmiş dönem');
      expect(markup).toContain('Etiketler');
      expect(markup).not.toContain('Kategoriler');
    } finally {
      service.close();
    }
  });
});
