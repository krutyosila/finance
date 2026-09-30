import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FinanceService } from '../server/core/service';
import { AiEntryService } from '../server/ai/entry';
import { OpenAiInterpreter, type AiInterpreter } from '../server/ai/client';
import { AiSettingsService } from '../server/ai/settings';
import type { ParseResult } from '../shared/types';

const roots: string[] = [];
const services: FinanceService[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'finance-ai-'));
  roots.push(root);
  const finance = new FinanceService(join(root, 'data', 'finance.sqlite'));
  services.push(finance);
  return { root, finance };
}
function clear(text = '450 market'): ParseResult {
  return {
    text,
    certain: true,
    issues: [],
    draft: {
      type: 'EXPENSE',
      amount: '450',
      currency: 'TRY',
      description: 'Market',
      category: 'Market',
    },
  };
}
function interpreter(result = clear()): AiInterpreter {
  return { interpret: vi.fn(async (text) => ({ ...result, text })) };
}
function output(overrides: Record<string, unknown> = {}) {
  return {
    certain: true,
    issues: [],
    draft: {
      type: 'EXPENSE',
      amount: '450.00',
      currency: 'TRY',
      timestamp: null,
      description: 'Market',
      category: 'Market',
      accountId: null,
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
    },
    ...overrides,
  };
}
function response(value: unknown = output(), extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
      ],
      ...extra,
    }),
    { status: 200 },
  );
}
afterEach(() => {
  services.splice(0).forEach((finance) => finance.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('AI transaction interpretation and atomic entry', () => {
  it('saves a clear AI result once across retries and service restarts', async () => {
    const { finance } = fixture(),
      model = interpreter(),
      entry = new AiEntryService(finance, model);
    const first = await entry.addText('450 market', 'request-one');
    expect(first.saved).toBe(true);
    expect(first.transaction?.amount).toBe('450.00');
    const again = await new AiEntryService(finance, model).addText('450 market', 'request-one');
    expect(again).toEqual(first);
    expect(model.interpret).toHaveBeenCalledTimes(1);
    expect(finance.listTransactions()).toHaveLength(1);
    expect(finance.listAudit()).toHaveLength(1);
  });
  it('deduplicates concurrent requests and rejects reused IDs with different text', async () => {
    const { finance } = fixture(),
      model = interpreter(),
      entry = new AiEntryService(finance, model);
    const results = await Promise.all([
      entry.addText('450 market', 'concurrent-id'),
      entry.addText('450 market', 'concurrent-id'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(model.interpret).toHaveBeenCalledTimes(1);
    await expect(entry.addText('900 market', 'concurrent-id')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(finance.listTransactions()).toHaveLength(1);
  });
  it('returns uncertain AI drafts without touching transactions, audit or receipts', async () => {
    const { finance } = fixture(),
      model = interpreter({ ...clear(), certain: false, issues: ['Hangi işlem?'] });
    const result = await new AiEntryService(finance, model).addText('450 belirsiz', 'uncertain-id');
    expect(result.saved).toBe(false);
    expect(result.confirmation?.issues).toContain('Hangi işlem?');
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(0);
    expect(finance.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_entry_receipts').get()).toEqual({
      n: 0,
    });
  });
  it('refuses invented account IDs and unsafe money before committing', async () => {
    const { finance } = fixture();
    for (const draft of [
      { accountId: 'invented' },
      { amount: '0' },
      { amount: '12.001' },
      { amount: '9999999999999999999' },
    ]) {
      const result = await new AiEntryService(
        finance,
        interpreter({ ...clear(), draft: { ...clear().draft, ...draft } }),
      ).addText('450 market', `invalid-${JSON.stringify(draft).length}`);
      expect(result.saved).toBe(false);
      expect(result.confirmation?.issues.length).toBeGreaterThan(0);
    }
    expect(finance.listTransactions()).toHaveLength(0);
  });
  it('checks linked-account accounting and rolls back the receipt when validation fails', async () => {
    const { finance } = fixture();
    const account = finance.createAccount({ name: 'Bank', type: 'BANK', currency: 'USD' });
    const result = await new AiEntryService(
      finance,
      interpreter({ ...clear(), draft: { ...clear().draft, accountId: account.id } }),
    ).addText('450 market', 'bad-ledger-id');
    expect(result.saved).toBe(false);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_entry_receipts').get()).toEqual({
      n: 0,
    });
  });
  it('never falls back to the deterministic parser on provider failure or preview', async () => {
    const { finance } = fixture();
    vi.spyOn(finance, 'parse').mockImplementation(() => {
      throw new Error('Legacy parser must not run');
    });
    const model: AiInterpreter = {
      interpret: vi.fn(async () => {
        throw new Error('Provider unavailable');
      }),
    };
    await expect(
      new AiEntryService(finance, model).addText('450 market', 'failure-id'),
    ).rejects.toThrow('Provider unavailable');
    expect(finance.listTransactions()).toHaveLength(0);
    const result = await new AiEntryService(finance, interpreter()).interpret('450 market');
    expect(result.certain).toBe(true);
    expect(finance.listTransactions()).toHaveLength(0);
  });
  it('sends only reference metadata and uses strict Responses format with storage disabled', async () => {
    const { root, finance } = fixture();
    const account = finance.createAccount({
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '987654.32',
      notes: 'Private account note',
    });
    const settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
    settings.update({ apiKey: 'sk-fixture-only-never-real-api-key', model: 'gpt-5.4-mini' });
    const fetcher = vi.fn(async () => response());
    const result = await new AiEntryService(
      finance,
      new OpenAiInterpreter(settings, { fetcher }),
    ).interpret('450 market');
    expect(result.draft.amount).toBe('450.00');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.type).toBe('json_schema');
    expect(String(init.body)).toContain(account.id);
    expect(String(init.body)).not.toContain('987654');
    expect(String(init.body)).not.toContain('Private account note');
    expect(String(init.body)).not.toContain('sk-fixture');
    expect(init.redirect).toBe('error');
  });
  it('rejects refusals, incomplete and malformed provider output without saving', async () => {
    const { root, finance } = fixture(),
      settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
    settings.update({ apiKey: 'sk-fixture-only-never-real-api-key' });
    for (const upstream of [
      response(output(), { status: 'incomplete' }),
      response(output(), {
        output: [
          {
            type: 'message',
            status: 'incomplete',
            content: [{ type: 'output_text', text: JSON.stringify(output()) }],
          },
        ],
      }),
      response(output(), {
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
      }),
      response({ ...output(), extra: 'not allowed' }),
      response({ ...output(), draft: { amount: '450' } }),
    ]) {
      const entry = new AiEntryService(
        finance,
        new OpenAiInterpreter(settings, { fetcher: async () => upstream }),
      );
      await expect(entry.addText('450 market', 'provider-output-id')).rejects.toMatchObject({
        statusCode: 502,
      });
    }
    expect(finance.listTransactions()).toHaveLength(0);
  });
  it('sanitizes upstream errors and requires a key before any network request', async () => {
    const { root, finance } = fixture(),
      settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
    const fetcher = vi.fn(
      async () => new Response('sk-fixture-only-never-real-api-key', { status: 401 }),
    );
    const entry = new AiEntryService(finance, new OpenAiInterpreter(settings, { fetcher }));
    await expect(entry.addText('450 market', 'missing-key')).rejects.toThrow('Ayarlar');
    expect(fetcher).not.toHaveBeenCalled();
    settings.update({ apiKey: 'sk-fixture-only-never-real-api-key' });
    await expect(entry.addText('450 market', 'bad-key-id')).rejects.toThrow('OpenAI');
    try {
      await entry.addText('450 market', 'bad-key-id');
    } catch (error) {
      expect(String(error)).not.toContain('sk-fixture');
    }
    expect(finance.listTransactions()).toHaveLength(0);
  });
  it('bounds input, response size and parallel provider calls', async () => {
    const { root, finance } = fixture(),
      settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
    settings.update({ apiKey: 'sk-fixture-only-never-real-api-key' });
    const client = new OpenAiInterpreter(settings, {
      fetcher: async () => new Response('x'.repeat(70000)),
    });
    await expect(new AiEntryService(finance, client).interpret('450 market')).rejects.toMatchObject(
      { statusCode: 502 },
    );
    await expect(
      new AiEntryService(finance, interpreter()).interpret('x'.repeat(2001)),
    ).rejects.toMatchObject({ statusCode: 400 });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const slow = new OpenAiInterpreter(settings, {
      fetcher: async () => {
        await gate;
        return response();
      },
    });
    const entry = new AiEntryService(finance, slow);
    const first = entry.interpret('one'),
      second = entry.interpret('two');
    await expect(entry.interpret('three')).rejects.toMatchObject({ statusCode: 429 });
    finish();
    await Promise.all([first, second]);
  });

  it('cancels an oversized declared response before reading it', async () => {
    const { root, finance } = fixture(),
      settings = new AiSettingsService({ path: join(root, 'private', 'ai.json') });
    settings.update({ apiKey: 'sk-fixture-only-never-real-api-key' });
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '70000' },
    });
    await expect(
      new AiEntryService(
        finance,
        new OpenAiInterpreter(settings, { fetcher: async () => upstream }),
      ).interpret('450 market'),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
