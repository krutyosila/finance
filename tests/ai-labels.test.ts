import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiPlan, TransactionInput } from '../shared/types';
import type { AiReferences } from '../server/ai/client';
import { prepareAiReferences } from '../server/ai/references';
import { PLAN_OUTPUT_SCHEMA, parsePlanOutput } from '../server/ai/plan-schema';
import { OpenAiInterpreter, TRANSACTION_OUTPUT_SCHEMA } from '../server/ai/client';
import { FinanceService } from '../server/core/service';
import { AiPlanService } from '../server/ai/plan';
import { AiEntryService } from '../server/ai/entry';
import { labelNameKey } from '../shared/labelNames';

const fixtures: FinanceService[] = [];
function financeFixture() {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  return finance;
}
afterEach(() => fixtures.splice(0).forEach((finance) => finance.close()));

function references(): AiReferences {
  return {
    accounts: [{ id: 'private-account', name: 'Bank', type: 'BANK', currency: 'TRY' }],
    debts: [],
    labels: [
      { id: 'private-label-one', name: 'Ev', description: 'Evin bakımı ve ev alışverişleri' },
      { id: 'private-label-two', name: 'İş', description: null },
    ],
    date: '2026-10-01',
    timeZone: 'Europe/Istanbul',
  };
}
function plan(labelId?: string | null): AiPlan {
  return {
    text: 'Yeni mobilya için 100 TL ödedim',
    certain: true,
    issues: [],
    items: [
      {
        key: 'expense',
        kind: 'transaction',
        data: transactionDraft(labelId),
      },
    ],
  };
}
function transactionDraft(labelId?: string | null): Partial<TransactionInput> {
  return { type: 'EXPENSE', amount: '100', currency: 'TRY', description: 'Mobilya', labelId };
}

describe('AI managed transaction label contract', () => {
  it('discards a provider free transaction category while preserving its managed label', () => {
    const transaction = PLAN_OUTPUT_SCHEMA.properties.items.items.anyOf.find(
      (variant) => variant.properties.kind.enum[0] === 'transaction',
    )!;
    const data = Object.fromEntries(
      transaction.properties.data.required.map((field) => [field, null]),
    );
    Object.assign(data, transactionDraft('existing_label_1'), { category: 'Invented category' });
    const parsed = parsePlanOutput('Note', {
      certain: true,
      issues: [],
      items: [{ key: 'x', kind: 'transaction', data }],
    });
    expect(parsed.items[0].data).not.toHaveProperty('category');
    expect(parsed.items[0].data).toMatchObject({ labelId: 'existing_label_1' });
  });
  it('supports a separate label classifier for existing transactions', () => {
    expect(OpenAiInterpreter.prototype.classifyLabels).toBeTypeOf('function');
  });
  it('shares short label references and user definitions without persistent label IDs', () => {
    const snapshot = prepareAiReferences(references());
    expect(snapshot.references.labels).toEqual([
      { id: 'existing_label_1', name: 'Ev', description: 'Evin bakımı ve ev alışverişleri' },
      { id: 'existing_label_2', name: 'İş', description: null },
    ]);
    expect(JSON.stringify(snapshot.references)).not.toContain('private-label');
  });

  it('resolves label IDs against the exact request snapshot', () => {
    const original = references();
    const snapshot = prepareAiReferences(original);
    original.labels!.reverse();
    const resolved = snapshot.resolve(plan('existing_label_1'));
    expect(resolved.certain).toBe(true);
    expect(resolved.items[0].data).toMatchObject({ labelId: 'private-label-one' });
  });

  it.each(['invented', 'existing_account_1', '@expense', '@existing_label_1'])(
    'blocks a label outside the catalog snapshot: %s',
    (labelId) => {
      const resolved = prepareAiReferences(references()).resolve(plan(labelId));
      expect(resolved.certain).toBe(true);
      expect(resolved.issues).toEqual([]);
      expect(resolved.labelIssues).toEqual([
        { key: 'expense', message: expect.stringMatching(/etiket/i) },
      ]);
    },
  );

  it('allows an unlabelled complete transaction', () => {
    const resolved = prepareAiReferences(references()).resolve(plan(null));
    expect(resolved.certain).toBe(true);
    expect(resolved.issues).toEqual([]);
  });

  it('adds labelId only to strict transaction provider schemas', () => {
    expect(TRANSACTION_OUTPUT_SCHEMA.properties.draft.required).toContain('labelId');
    const variants = PLAN_OUTPUT_SCHEMA.properties.items.items.anyOf;
    const transaction = variants.find(
      (variant) => variant.properties.kind.enum[0] === 'transaction',
    )!;
    expect(transaction.properties.data.required).toContain('labelId');
    for (const variant of variants.filter((variant) => variant !== transaction))
      expect(variant.properties.data.required).not.toContain('labelId');
    const data = Object.fromEntries(
      transaction.properties.data.required.map((field) => [field, null]),
    );
    Object.assign(data, plan().items[0].data, { labelId: 'existing_label_1' });
    expect(
      parsePlanOutput('Note', {
        certain: true,
        issues: [],
        items: [{ key: 'x', kind: 'transaction', data }],
      }).items[0].data,
    ).toMatchObject({ labelId: 'existing_label_1' });
  });
});

describe('managed labels through AI entry services', () => {
  it.each([
    { kind: 'obligation', samePlan: false },
    { kind: 'subscription', samePlan: false },
    { kind: 'obligation', samePlan: true },
    { kind: 'subscription', samePlan: true },
  ] as const)(
    'pays imported long $kind labels (same plan: $samePlan) through their canonical ID',
    async ({ kind, samePlan }) => {
      const finance = financeFixture();
      const name = 'Eski planlı etiket '.padEnd(150, 'x');
      const time = '2026-10-01T09:00:00.000Z';
      // The migration preserves old names beyond the new-label creation limit.
      finance.sqlite
        .prepare(
          'INSERT INTO labels(id,name,normalized_name,archived,created_at,updated_at) VALUES(?,?,?,0,?,?)',
        )
        .run('imported-long-label', name, labelNameKey(name), time, time);
      const definition = {
        amount: '100',
        currency: 'TRY' as const,
        frequency: 'MONTHLY' as const,
        category: name,
        ...(kind === 'obligation'
          ? { name: 'Kira', dueDate: '2026-10-15' }
          : { service: 'İnternet', nextRenewal: '2026-10-15' }),
      };
      const scheduleId = samePlan
        ? '@schedule'
        : kind === 'obligation'
          ? finance.createObligation(definition as never).id
          : finance.createSubscription(definition as never).id;
      const draft: AiPlan = {
        text: 'Planlı ödemeyi kaydet',
        certain: true,
        issues: [],
        items: [
          ...(samePlan ? [{ key: 'schedule', kind, data: definition }] : []),
          {
            key: 'pay',
            kind: 'transaction',
            data: {
              type: 'EXPENSE',
              description: 'Ödeme',
              amount: '100',
              currency: 'TRY',
              [kind === 'obligation' ? 'obligationId' : 'subscriptionId']: scheduleId,
            },
          },
        ],
      };
      const service = new AiPlanService(finance, {
        interpret: async () => {
          throw Error('Legacy unused');
        },
        interpretPlan: async () => draft,
      });
      const preview = await service.preview(draft.text);
      expect(preview.certain, preview.issues.join(' ')).toBe(true);
      const payment = preview.items.find((item) => item.key === 'pay')!;
      expect(payment.data).toMatchObject({ labelId: 'imported-long-label' });
      expect(payment.data).not.toHaveProperty('category');
      expect(service.confirm(preview, `long-schedule-${kind}-${samePlan}`).saved).toBe(true);
      expect(finance.listTransactions()[0]).toMatchObject({
        labelId: 'imported-long-label',
        amount: '100.00',
      });
    },
  );
  it.each(['obligation', 'subscription'] as const)(
    'blocks a %s classification outside the supplied active label catalog',
    async (kind) => {
      const finance = financeFixture();
      finance.createLabel({ name: 'Ev' });
      const draft: AiPlan = {
        text: 'Ödeme planı',
        certain: true,
        issues: [],
        items: [
          {
            key: 'schedule',
            kind,
            data: {
              ...(kind === 'obligation'
                ? { name: 'Kira', dueDate: '2026-10-15' }
                : { service: 'Netflix', nextRenewal: '2026-10-15' }),
              amount: '100',
              currency: 'TRY',
              frequency: 'MONTHLY',
              category: 'Invented category',
            },
          },
        ],
      };
      const service = new AiPlanService(finance, {
        interpret: async () => {
          throw Error('Legacy unused');
        },
        interpretPlan: async () => draft,
      });
      const preview = await service.preview(draft.text);
      expect(preview.certain).toBe(false);
      expect(preview.issues.join(' ')).toMatch(/etiket/i);
      expect(preview.items[0].data).not.toHaveProperty('category');
      expect(service.confirm(draft, `invalid-schedule-label-${kind}`).saved).toBe(false);
      expect(finance.listLabels().map((item) => item.name)).toEqual(['Ev']);
      expect(finance.listObligations()).toEqual([]);
      expect(finance.listSubscriptions()).toEqual([]);
    },
  );

  it('preserves an existing schedule label name and carries it into the paid transaction', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const draft: AiPlan = {
      text: 'Kira planla ve öde',
      certain: true,
      issues: [],
      items: [
        {
          key: 'rent',
          kind: 'obligation',
          data: {
            name: 'Kira',
            amount: '100',
            currency: 'TRY',
            frequency: 'MONTHLY',
            dueDate: '2026-10-15',
            category: 'Ev',
          },
        },
        {
          key: 'pay',
          kind: 'transaction',
          data: {
            type: 'EXPENSE',
            description: 'Kira',
            amount: '100',
            currency: 'TRY',
            obligationId: '@rent',
          },
        },
      ],
    };
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => draft,
    });
    const preview = await service.preview(draft.text);
    expect(preview.certain).toBe(true);
    expect(preview.items.find((item) => item.key === 'pay')?.data).toMatchObject({
      labelId: label.id,
    });
    expect(service.confirm(preview, 'catalog-schedule-payment').saved).toBe(true);
    expect(finance.listTransactions()[0].labelId).toBe(label.id);
  });

  it.each(['obligation', 'subscription'] as const)(
    'shows an inherited %s label in preview and honors explicit Etiket yok at confirmation',
    async (kind) => {
      const finance = financeFixture();
      const label = finance.createLabel({ name: 'Ev' });
      const schedule =
        kind === 'obligation'
          ? finance.createObligation({
              name: 'Kira',
              amount: '100',
              currency: 'TRY',
              frequency: 'MONTHLY',
              dueDate: '2026-10-15',
              category: '  EV  ',
            })
          : finance.createSubscription({
              service: 'Netflix',
              amount: '100',
              currency: 'TRY',
              frequency: 'MONTHLY',
              nextRenewal: '2026-10-15',
              category: '  EV  ',
            });
      const draft: AiPlan = {
        text: 'Ödemeyi kaydet',
        certain: true,
        issues: [],
        items: [
          {
            key: 'pay',
            kind: 'transaction',
            data: {
              type: 'EXPENSE',
              description: 'Ödeme',
              amount: '100',
              currency: 'TRY',
              [kind === 'obligation' ? 'obligationId' : 'subscriptionId']: schedule.id,
            },
          },
        ],
      };
      const service = new AiPlanService(finance, {
        interpret: async () => {
          throw Error('Legacy unused');
        },
        interpretPlan: async () => draft,
      });
      const preview = await service.preview(draft.text);
      expect(preview.certain).toBe(true);
      expect(preview.items[0].data).toMatchObject({ labelId: label.id });
      const clear = {
        ...preview,
        items: preview.items.map((item) =>
          item.kind === 'transaction' ? { ...item, data: { ...item.data, labelId: null } } : item,
        ),
      };
      expect(service.confirm(clear, `clear-scheduled-label-${kind}`).saved).toBe(true);
      expect(finance.listTransactions()[0].labelId).toBeNull();
      expect(finance.listTransactions()[0]).toMatchObject({ amount: '100.00', currency: 'TRY' });
    },
  );

  it('preserves an explicit null label on an ordinary transaction through confirmation', () => {
    const finance = financeFixture();
    finance.createLabel({ name: 'Diğer' });
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Unused');
      },
    });
    expect(service.confirm(plan(null), 'clear-ordinary-label').saved).toBe(true);
    expect(finance.listTransactions()[0].labelId).toBeNull();
  });

  it('revalidates a scheduled label archived after preview before creating any records', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const draft: AiPlan = {
      text: 'Kira planla',
      certain: true,
      issues: [],
      items: [
        {
          key: 'rent',
          kind: 'obligation',
          data: {
            name: 'Kira',
            amount: '100',
            currency: 'TRY',
            frequency: 'MONTHLY',
            dueDate: '2026-10-15',
            category: 'Ev',
          },
        },
      ],
    };
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => draft,
    });
    const preview = await service.preview(draft.text);
    expect(preview.certain).toBe(true);
    finance.archiveLabel(label.id);
    const confirmed = service.confirm(preview, 'archived-scheduled-label');
    expect(confirmed.saved).toBe(false);
    if (!confirmed.saved) expect(confirmed.confirmation.issues.join(' ')).toMatch(/etiket/i);
    expect(finance.listObligations()).toEqual([]);
  });
  it('ignores free transaction categories from custom interpreters and confirmation payloads', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const draft = plan('existing_label_1');
    draft.items[0].data = { ...draft.items[0].data, category: 'Invented category' };
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => draft,
    });
    const preview = await service.preview(draft.text);
    expect(preview.certain).toBe(true);
    expect(preview.items[0].data).not.toHaveProperty('category');
    preview.items[0].data = { ...preview.items[0].data, category: 'Other invented category' };
    expect(service.confirm(preview, 'single-classification-confirm').saved).toBe(true);
    expect(finance.listTransactions()[0]).toMatchObject({ labelId: label.id });
    expect(finance.listTransactions()[0].category).not.toContain('invented');
    expect(finance.listLabels().map((item) => item.name)).toEqual(['Ev']);
  });

  it('ignores a legacy interpreter free category instead of creating a second classification', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const service = new AiEntryService(finance, {
      interpret: async (text) => ({
        text,
        certain: true,
        issues: [],
        draft: { ...transactionDraft('existing_label_1'), category: 'Invented category' },
      }),
    });
    const interpreted = await service.interpret('Mobilya 100 TL');
    expect(interpreted.draft).not.toHaveProperty('category');
    const result = await service.addText('Mobilya 100 TL', 'single-legacy-classification');
    expect(result.saved).toBe(true);
    expect(result.transaction?.labelId).toBe(label.id);
    expect(finance.listLabels().map((item) => item.name)).toEqual(['Ev']);
  });
  it('shares only active definitions and persists the selected label without changing category', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev', description: 'Mobilya ve ev eşyaları' });
    const archived = finance.createLabel({ name: 'Arşiv', description: 'Gizli eski tanım' });
    finance.archiveLabel(archived.id);
    finance.createTransaction({
      type: 'INCOME',
      amount: '50',
      currency: 'TRY',
      description: 'Özel geçmiş notu',
    });
    const beforeAudit = finance.listAudit().length;
    const received: AiReferences[] = [];
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async (_text, refs) => {
        received.push(refs);
        return plan('existing_label_1');
      },
    });
    const preview = await service.preview(plan().text);
    expect(preview.certain).toBe(true);
    expect(preview.labelIssues ?? []).toEqual([]);
    expect(received[0].labels).toEqual([
      { id: 'existing_label_1', name: 'Ev', description: 'Mobilya ve ev eşyaları' },
    ]);
    const payload = JSON.stringify(received[0]);
    for (const privateValue of [label.id, archived.id, 'Gizli eski tanım', 'Özel geçmiş notu'])
      expect(payload).not.toContain(privateValue);
    expect(finance.listAudit()).toHaveLength(beforeAudit);
    expect(finance.listTransactions()).toHaveLength(1);
    expect(service.confirm(preview, 'label-preview-save').saved).toBe(true);
    expect(finance.listTransactions().find((tx) => tx.type === 'EXPENSE')).toMatchObject({
      labelId: label.id,
      category: 'Diğer',
    });
  });

  it('keeps label identities stable when another label is archived and the selected label is renamed in flight', async () => {
    const finance = financeFixture();
    const first = finance.createLabel({ name: 'Eski' });
    const selected = finance.createLabel({ name: 'Ev' });
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => {
        finance.archiveLabel(first.id);
        finance.updateLabel(selected.id, { name: 'Aile' });
        return plan('existing_label_2');
      },
    });
    const preview = await service.preview(plan().text);
    expect(preview.certain).toBe(true);
    expect(preview.labelIssues ?? []).toEqual([]);
    expect(preview.items[0].data).toMatchObject({ labelId: selected.id });
    expect(service.confirm(preview, 'label-stable-renamed').saved).toBe(true);
    expect(finance.listTransactions()[0].labelId).toBe(selected.id);
  });

  it('rejects an active label created after the provider snapshot without losing financial certainty', async () => {
    const finance = financeFixture();
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => plan(finance.createLabel({ name: 'Sonradan' }).id),
    });
    const preview = await service.preview(plan().text);
    expect(preview.certain).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.labelIssues).toHaveLength(1);
    expect(finance.listTransactions()).toHaveLength(0);
  });

  it('separates labels archived during interpretation from unrelated missing financial fields', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => {
        finance.archiveLabel(label.id);
        const result = plan('existing_label_1');
        if (result.items[0].kind === 'transaction') delete result.items[0].data.amount;
        return result;
      },
    });
    const preview = await service.preview(plan().text);
    expect(preview.certain).toBe(false);
    expect(preview.issues.join(' ')).toMatch(/tutar/);
    expect(preview.labelIssues).toEqual([
      { key: 'expense', message: expect.stringMatching(/etiket/i) },
    ]);
    expect(finance.listTransactions()).toHaveLength(0);
  });

  it('revalidates a label archived after preview and rolls back the entire confirmation', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Legacy unused');
      },
      interpretPlan: async () => plan('existing_label_1'),
    });
    const preview = await service.preview(plan().text);
    finance.archiveLabel(label.id);
    const beforeAudit = finance.listAudit().length;
    preview.items.unshift({
      key: 'bank',
      kind: 'account',
      data: { name: 'Banka', type: 'BANK', currency: 'TRY', openingBalance: '0' },
    });
    const result = service.confirm({ ...preview, labelIssues: [] }, 'label-archived-confirm');
    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.confirmation.certain).toBe(true);
      expect(result.confirmation.labelIssues).toHaveLength(1);
    }
    expect(finance.listAccounts()).toHaveLength(0);
    expect(finance.listTransactions()).toHaveLength(0);
    expect(finance.listAudit()).toHaveLength(beforeAudit);
    expect(finance.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_entry_receipts').get()).toEqual({
      n: 0,
    });
  });

  it('recomputes label validation rather than trusting client-provided issues', () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const service = new AiPlanService(finance, {
      interpret: async () => {
        throw Error('Unused');
      },
    });
    const input = {
      ...plan(label.id),
      labelIssues: [{ key: 'expense', message: 'Obsolete client error' }],
    };
    expect(service.confirm(input, 'label-derived-confirm').saved).toBe(true);
  });

  it('uses aliased active label definitions for legacy entry and saves a valid selection', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev', description: 'Mobilya' });
    const model = vi.fn(async (text: string, refs: AiReferences) => {
      expect(refs.labels).toEqual([{ id: 'existing_label_1', name: 'Ev', description: 'Mobilya' }]);
      return { text, certain: true, issues: [], draft: transactionDraft('existing_label_1') };
    });
    const result = await new AiEntryService(finance, { interpret: model }).addText(
      plan().text,
      'label-legacy-save',
    );
    expect(result.saved).toBe(true);
    expect(result.transaction?.labelId).toBe(label.id);
  });

  it.each(['invented', '@expense', 'existing_account_1'])(
    'never auto-saves an invalid legacy label: %s',
    async (labelId) => {
      const finance = financeFixture();
      const service = new AiEntryService(finance, {
        interpret: async (text) => ({
          text,
          certain: true,
          issues: [],
          draft: transactionDraft(labelId),
        }),
      });
      const result = await service.addText(
        plan().text,
        `invalid-legacy-${labelId.replace(/[^a-z]/g, '')}`,
      );
      expect(result.saved).toBe(false);
      expect(result.confirmation?.issues.join(' ')).toMatch(/etiket/i);
      expect(finance.listTransactions()).toHaveLength(0);
      expect(finance.listAudit()).toHaveLength(0);
      expect(finance.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_entry_receipts').get()).toEqual({
        n: 0,
      });
    },
  );

  it('does not auto-save a legacy label archived during interpretation', async () => {
    const finance = financeFixture();
    const label = finance.createLabel({ name: 'Ev' });
    const service = new AiEntryService(finance, {
      interpret: async (text) => {
        finance.archiveLabel(label.id);
        return { text, certain: true, issues: [], draft: transactionDraft('existing_label_1') };
      },
    });
    const result = await service.addText(plan().text, 'legacy-label-archived');
    expect(result.saved).toBe(false);
    expect(result.confirmation?.issues.join(' ')).toMatch(/etiket/i);
    expect(finance.listTransactions()).toHaveLength(0);
  });

  it('bounds active label references before either interpreter can run', async () => {
    const finance = financeFixture();
    for (let i = 0; i < 201; i++) finance.createLabel({ name: `Etiket ${i}` });
    const interpret = vi.fn(async (text: string) => ({
      text,
      certain: true,
      issues: [],
      draft: {},
    }));
    const interpretPlan = vi.fn(async () => plan());
    await expect(
      new AiPlanService(finance, { interpret, interpretPlan }).preview(plan().text),
    ).rejects.toThrow(/sınır/);
    await expect(new AiEntryService(finance, { interpret }).interpret(plan().text)).rejects.toThrow(
      /sınır/,
    );
    expect(interpret).not.toHaveBeenCalled();
    expect(interpretPlan).not.toHaveBeenCalled();
  });
});
