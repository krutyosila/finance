import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/pages/Settings';

vi.mock('../src/api', () => ({
  api: vi.fn(),
  useResource: (path: string) => ({
    data:
      path === '/settings/ai'
        ? { provider: 'openai', configured: true, model: 'gpt-5.4-mini' }
        : [
            {
              id: 'food',
              name: 'Market',
              description: 'Gıda alışverişleri',
              archived: false,
              createdAt: '',
              updatedAt: '',
            },
          ],
    error: 'Yenileme bağlantısı kesildi.',
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../src/auth', () => ({ useAuth: () => ({ session: { required: false } }) }));
vi.mock('../src/pwa', () => ({ usePwa: () => ({ online: true }) }));
vi.mock('../src/theme', () => ({
  useTheme: () => ({ preference: 'system', setPreference: vi.fn() }),
}));

describe('settings refresh failures', () => {
  it('retains the mounted AI connection form alongside a refresh error', () => {
    const html = renderToStaticMarkup(createElement(Settings));
    expect(html).toContain('Yenileme bağlantısı kesildi.');
    expect(html).toContain('GPT-5.4 Mini (varsayılan)');
    expect(html).toContain('API anahtarı');
  });

  it('retains the last loaded label list alongside a refresh error', () => {
    const html = renderToStaticMarkup(createElement(Settings));
    expect(html).toContain('Market');
    expect(html).toContain('Gıda alışverişleri');
    expect(html).toContain('Etkin etiketler');
  });

  it('keeps the scan component mounted instead of clearing its state after a label refresh fails', () => {
    const html = renderToStaticMarkup(createElement(Settings));
    expect(html).toContain('Tümünü tara');
  });
});
