import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiInterpreter } from '../server/ai/client';
import { AiSettingsService } from '../server/ai/settings';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function client(value: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'finance-plan-provider-'));
  roots.push(root);
  const settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
  settings.update({ apiKey: 'sk-fixture-only-never-real-api-key' });
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
          ],
        }),
      ),
  );
  return { model: new OpenAiInterpreter(settings, { fetcher }), fetcher };
}
const account = {
  key: 'bank',
  kind: 'account',
  data: {
    name: 'Garanti',
    type: 'BANK',
    currency: 'TRY',
    openingBalance: '25000.00',
    owner: null,
    creditLimit: null,
    currentDebt: null,
    notes: null,
  },
};
const subscription = {
  key: 'netflix',
  kind: 'subscription',
  data: {
    service: 'Netflix',
    amount: '300.00',
    currency: 'TRY',
    frequency: 'MONTHLY',
    nextRenewal: '2026-10-15',
    accountId: '@bank',
    category: null,
    scope: 'PERSONAL',
    active: true,
  },
};
describe('universal AI provider plans', () => {
  it('interprets multiple typed records with strict output and strips missing optional fields', async () => {
    const { model, fetcher } = client({
      certain: true,
      issues: [],
      items: [account, subscription],
    });
    const result = await model.interpretPlan('Garanti ve Netflix ekle', {
      accounts: [],
      debts: [],
      subscriptions: [{ id: 'sub-1', service: 'Spotify', currency: 'TRY' }],
      obligations: [],
      date: '2026-10-01',
      timeZone: 'Europe/Istanbul',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      key: 'bank',
      kind: 'account',
      data: {
        name: 'Garanti',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '25000.00',
      },
    });
    expect(result.items[1].data).toMatchObject({ accountId: '@bank' });
    const body = JSON.parse(
      String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      name: 'finance_entry_plan',
      strict: true,
      type: 'json_schema',
    });
    expect(body.instructions).toContain('abonelik');
    expect(body.input[0].content).toContain('Spotify');
    expect(body.input[0].content).not.toContain('sk-fixture');
  });
  it('rejects unsupported actions and unexpected payload fields', async () => {
    for (const item of [
      { ...account, kind: 'delete' },
      { ...account, data: { ...account.data, command: 'remove everything' } },
      { ...account, data: { ...account.data, currency: 'GBP' } },
      { key: 'x', kind: 'account', data: { name: 'Incomplete schema' } },
    ]) {
      const { model } = client({ certain: true, issues: [], items: [item] });
      await expect(
        model.interpretPlan('kayıt ekle', {
          accounts: [],
          debts: [],
          date: '2026-10-01',
          timeZone: 'Europe/Istanbul',
        }),
      ).rejects.toMatchObject({ statusCode: 502 });
    }
  });
});
