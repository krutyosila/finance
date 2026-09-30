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
  it('transports a currency-account chain with separate income, FX proceeds and onward transfer', async () => {
    const usd = {
      ...account,
      key: 'paribu_usd',
      data: {
        ...account.data,
        name: 'Paribu',
        type: 'WALLET',
        currency: 'USD',
        openingBalance: null,
      },
    };
    const lira = { ...usd, key: 'paribu_try', data: { ...usd.data, currency: 'TRY' } };
    const deposit = {
      key: 'deposit',
      kind: 'transaction',
      data: {
        type: 'INCOME',
        amount: '2500',
        currency: 'USD',
        description: 'Para gelişi',
        accountId: '@paribu_usd',
        timestamp: null,
        category: null,
        destinationAccountId: null,
        destinationAmount: null,
        debtId: null,
        amountTRY: null,
        exchangeRate: null,
        counterparty: null,
        paymentMethod: null,
        notes: null,
        scope: 'PERSONAL',
        debtComponent: null,
        obligationId: null,
        subscriptionId: null,
      },
    };
    const fx = {
      ...deposit,
      key: 'fx',
      data: {
        ...deposit.data,
        type: 'TRANSFER',
        description: 'Döviz çevrimi',
        destinationAccountId: '@paribu_try',
        destinationAmount: '100000',
      },
    };
    const transfer = {
      ...fx,
      key: 'transfer',
      data: {
        ...fx.data,
        amount: '90000',
        currency: 'TRY',
        description: 'VakıfBank aktarımı',
        accountId: '@paribu_try',
        destinationAccountId: 'vakif-existing',
        destinationAmount: null,
      },
    };
    const { model, fetcher } = client({
      certain: true,
      issues: [],
      items: [usd, lira, deposit, fx, transfer],
    });
    const result = await model.interpretPlan(
      "Paribu'ya 2500 dolar geldi. 100000 TL'ye çevirdim, 90000 TL'sini VakıfBank'a attım.",
      {
        accounts: [{ id: 'vakif-existing', name: 'VakıfBank', type: 'BANK', currency: 'TRY' }],
        debts: [],
        date: '2026-10-01',
        timeZone: 'Europe/Istanbul',
      },
    );
    expect(result.items.map((item) => item.key)).toEqual([
      'paribu_usd',
      'paribu_try',
      'deposit',
      'fx',
      'transfer',
    ]);
    expect(result.items[0].data).toEqual({ name: 'Paribu', type: 'WALLET', currency: 'USD' });
    expect(result.items[3]).toMatchObject({
      kind: 'transaction',
      data: {
        type: 'TRANSFER',
        amount: '2500',
        currency: 'USD',
        destinationAccountId: '@paribu_try',
        destinationAmount: '100000',
      },
    });
    expect(result.items[4]).toMatchObject({
      data: { accountId: '@paribu_try', destinationAccountId: 'vakif-existing', amount: '90000' },
    });
    const body = JSON.parse(
      String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.input[0].content).toContain('vakif-existing');
    expect(body.store).toBe(false);
    expect(body.instructions).toMatch(/bulunmuyorsa[^\n]*yeni account oluştur/);
    expect(body.instructions).toContain('openingBalance=null');
    expect(body.instructions).toContain('Sonraki transfer tutarını çevrim toplamı olarak kullanma');
  });
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
