import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  AiPlan,
  AiPlanResult,
  AiRecordKind,
  AccountInput,
  DebtInput,
  ObligationInput,
  SubscriptionInput,
  TransactionInput,
} from '../../shared/types';
import type { FinanceService } from '../core/service';
import type { AiInterpreter, AiReferences } from './client';
import { minor } from '../core/money';
import { AiError } from './errors';
import { AuthError } from '../auth';

import { PLAN_FIELDS } from './plan-schema';
import { prepareAccountChain } from './account-chain';
import { AI_REFERENCE_KINDS as referenceKinds, prepareAiReferences } from './references';
const kindLabels: Record<AiRecordKind, string> = {
  transaction: 'İşlem',
  account: 'Hesap',
  debt: 'Borç',
  obligation: 'Düzenli ödeme',
  subscription: 'Abonelik',
  cycle: 'Dönem',
};
const fieldLabels: Record<string, string> = {
  type: 'tür',
  amount: 'tutar',
  currency: 'para birimi',
  description: 'açıklama',
  name: 'ad',
  service: 'hizmet adı',
  frequency: 'ödeme sıklığı',
  nextRenewal: 'yenileme tarihi',
  dueDate: 'ödeme tarihi',
};
function identity(kind: AiRecordKind, data: Record<string, unknown>): string {
  const name = String(data.name ?? data.service ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr');
  return JSON.stringify([
    kind,
    name,
    data.currency ?? '',
    kind === 'account' || kind === 'debt' ? data.type : '',
  ]);
}
const envelope = z
  .object({
    text: z.string().trim().min(1).max(12000),
    certain: z.boolean(),
    issues: z.array(z.string().min(1).max(500)).max(50),
    items: z
      .array(
        z
          .object({
            key: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[a-zA-Z0-9_-]+$/),
            kind: z.enum(['transaction', 'account', 'debt', 'obligation', 'subscription', 'cycle']),
            data: z.record(z.union([z.string().max(12000), z.boolean(), z.null(), z.undefined()])),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
function parse(value: unknown): AiPlan {
  let parsed: z.infer<typeof envelope>;
  try {
    parsed = envelope.parse(value);
  } catch {
    throw new AiError('Plan biçimi geçersiz. Alanları gözden geçirin.', 400);
  }
  const keys = new Set<string>();
  for (const item of parsed.items) {
    if (keys.has(item.key)) throw new AiError('Plan anahtarları benzersiz olmalıdır.', 400);
    keys.add(item.key);
    for (const [field, value] of Object.entries(item.data)) {
      if (!Object.hasOwn(PLAN_FIELDS[item.kind], field))
        throw new AiError('Plan izin verilmeyen bir alan içeriyor.', 400);
      const expectedType = PLAN_FIELDS[item.kind][field] === 'boolean' ? 'boolean' : 'string';
      if (value != null && typeof value !== expectedType)
        throw new AiError('Plan alanlarının türü geçersiz. Alanları gözden geçirin.', 400);
    }
  }
  return parsed as AiPlan;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const rollback = Symbol('preview rollback');
export class AiPlanService {
  constructor(
    private readonly finance: FinanceService,
    private readonly interpreter: AiInterpreter,
  ) {}
  private references(): AiReferences {
    const timeZone = process.env.FINANCE_TIMEZONE ?? 'Europe/Istanbul';
    const accounts = this.finance
      .listAccounts()
      .map(({ id, name, type, currency }) => ({ id, name, type, currency }));
    const debts = this.finance.listDebts().map(({ id, name, type, currency, accountId }) => ({
      id,
      name,
      type,
      currency,
      accountId: accountId ?? null,
    }));
    const subscriptions = this.finance
      .listSubscriptions()
      .map(({ id, service, currency }) => ({ id, service, currency }));
    const obligations = this.finance
      .listObligations()
      .map(({ id, name, currency }) => ({ id, name, currency }));
    if ([accounts, debts, subscriptions, obligations].some((records) => records.length > 200))
      throw new AiError('AI referans sınırı aşıldı.', 400);
    const current = this.finance.listCycles().find((cycle) => !cycle.end);
    return {
      accounts,
      debts,
      subscriptions,
      obligations,
      currentCycle: current ? { id: current.id, name: current.name } : null,
      date: new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      timeZone,
    };
  }
  private invalid(plan: AiPlan, error: unknown): AiPlan {
    if (error instanceof AiError || error instanceof AuthError) throw error;
    return {
      ...plan,
      certain: false,
      issues: [
        ...new Set([
          ...plan.issues,
          error instanceof Error && error.name !== 'ZodError' && !error.message.includes('SQLITE')
            ? error.message
            : 'Plan alanlarını gözden geçirin.',
        ]),
      ],
    };
  }
  private scheduleDefaults(plan: AiPlan): AiPlan {
    return {
      ...plan,
      items: plan.items.map((item) => {
        if (item.kind !== 'transaction' || item.data.type !== 'EXPENSE') return item;
        const field = item.data.obligationId ? 'obligationId' : 'subscriptionId';
        const reference = item.data[field];
        if (typeof reference !== 'string') return item;
        const kind = field === 'obligationId' ? 'obligation' : 'subscription';
        const local = reference.startsWith('@')
          ? plan.items.find((draft) => draft.key === reference.slice(1) && draft.kind === kind)
          : undefined;
        const schedule = reference.startsWith('@')
          ? (local?.data as Partial<ObligationInput | SubscriptionInput> | undefined)
          : kind === 'obligation'
            ? this.finance.listObligations().find((record) => record.id === reference)
            : this.finance.listSubscriptions().find((record) => record.id === reference);
        if (!schedule) return item;
        return {
          ...item,
          data: {
            ...item.data,
            accountId: item.data.accountId ?? schedule.accountId ?? null,
            category:
              item.data.category ??
              schedule.category ??
              (kind === 'obligation' ? 'Düzenli ödeme' : 'Abonelikler'),
            scope: item.data.scope ?? schedule.scope ?? 'PERSONAL',
          },
        };
      }),
    };
  }
  async preview(value: unknown): Promise<AiPlan> {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 12000)
      throw new AiError('Not 1–12000 karakter arasında olmalıdır.', 400);
    if (!this.interpreter.interpretPlan)
      throw new AiError('AI plan yorumlayıcısı kullanılamıyor.', 503);
    const snapshot = prepareAiReferences(this.references());
    let plan = snapshot.resolve(
      parse({
        ...(await this.interpreter.interpretPlan(value.trim(), snapshot.references)),
        text: value.trim(),
      }),
    );
    plan = prepareAccountChain(this.scheduleDefaults(plan), this.finance.listAccounts());
    if (!plan.certain || plan.issues.length) return { ...plan, certain: false };
    try {
      this.finance.sqlite.transaction(() => {
        this.execute(plan);
        throw rollback;
      })();
    } catch (error) {
      if (error !== rollback) return this.invalid(plan, error);
    }
    return plan;
  }
  confirm(value: unknown, requestId: unknown, authorize: () => void = () => {}): AiPlanResult {
    const plan = parse(value);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
      throw new AiError('Geçerli bir requestId gönderin.', 400);
    const id = `plan:${requestId}`,
      hash = createHash('sha256').update(canonical(plan)).digest('hex');
    let authorizationError: unknown;
    let confirmation = plan;
    try {
      return this.finance.sqlite
        .transaction((): AiPlanResult => {
          try {
            authorize();
          } catch (error) {
            authorizationError = error;
            throw error;
          }
          const row = this.finance.sqlite
            .prepare('SELECT input_hash,result_json FROM ai_entry_receipts WHERE request_id=?')
            .get(id) as { input_hash: string; result_json: string } | undefined;
          if (row) {
            if (row.input_hash !== hash)
              throw new AiError('Bu istek kimliği farklı bir plan için kullanılmış.', 409);
            return JSON.parse(row.result_json) as AiPlanResult;
          }
          confirmation = prepareAccountChain(
            this.scheduleDefaults(plan),
            this.finance.listAccounts(),
          );
          if (!confirmation.certain || confirmation.issues.length)
            return { saved: false, confirmation: { ...confirmation, certain: false } };
          const result: AiPlanResult = {
            saved: true,
            records: this.execute(confirmation),
          };
          this.finance.sqlite
            .prepare(
              'INSERT INTO ai_entry_receipts(request_id,input_hash,result_json,created_at) VALUES(?,?,?,?)',
            )
            .run(id, hash, JSON.stringify(result), new Date().toISOString());
          return result;
        })
        .immediate();
    } catch (error) {
      if (error === authorizationError) throw error;
      return { saved: false, confirmation: this.invalid(confirmation, error) };
    }
  }
  private execute(plan: AiPlan): { key: string; kind: AiRecordKind; id: string }[] {
    if (!plan.items.length) throw Error('Plan en az bir kayıt içermelidir.');
    const defaultTimestamp = this.finance.normalizeTransactionTimestamp();
    const pending = plan.items
        .map((item) =>
          item.kind === 'transaction'
            ? {
                ...item,
                data: {
                  ...item.data,
                  timestamp: this.finance.normalizeTransactionTimestamp(
                    item.data.timestamp || defaultTimestamp,
                  ),
                },
              }
            : item.kind === 'cycle'
              ? { ...item, data: { ...item.data, start: item.data.start || defaultTimestamp } }
              : item,
        )
        .sort((a, b) => {
          if (a.kind !== 'transaction') return b.kind === 'transaction' ? -1 : 0;
          if (b.kind !== 'transaction') return 1;
          return a.data.timestamp!.localeCompare(b.data.timestamp!);
        }),
      records = new Map<string, { key: string; kind: AiRecordKind; id: string }>(),
      definitions = new Set<string>();
    for (const [kind, entities] of [
      ['account', this.finance.listAccounts()],
      ['debt', this.finance.listDebts()],
      ['subscription', this.finance.listSubscriptions()],
      ['obligation', this.finance.listObligations()],
    ] as const) {
      for (const entity of entities)
        definitions.add(identity(kind, entity as unknown as Record<string, unknown>));
    }

    for (const item of pending) {
      const data = item.data as Record<string, unknown>;
      const required =
        item.kind === 'transaction'
          ? ['type', 'amount', 'currency', 'description']
          : item.kind === 'cycle'
            ? []
            : item.kind === 'account' || item.kind === 'debt'
              ? ['name', 'type', 'currency']
              : item.kind === 'subscription'
                ? ['service', 'amount', 'currency', 'frequency', 'nextRenewal']
                : ['name', 'amount', 'currency', 'frequency', 'dueDate'];
      for (const field of required)
        if (typeof data[field] !== 'string' || !(data[field] as string).trim())
          throw Error(`${kindLabels[item.kind]} için ${fieldLabels[field]} gereklidir.`);
      if (item.kind === 'account' || item.kind === 'debt') {
        const credit =
          item.kind === 'account' && ['CREDIT_CARD', 'OVERDRAFT'].includes(String(data.type));
        if (data.openingBalance == null && (!credit || data.currentDebt == null))
          throw Error(`${kindLabels[item.kind]} için açılış bakiyesini açıkça belirtin.`);
      }
      if (item.kind !== 'transaction') {
        const key = identity(item.kind, data);
        if (definitions.has(key))
          throw Error('Aynı kayıt zaten mevcut veya planda birden fazla tanımlanmış.');
        definitions.add(key);
        if (item.kind === 'account' && ['CREDIT_CARD', 'OVERDRAFT'].includes(String(data.type))) {
          const debtKey = identity('debt', data);
          if (definitions.has(debtKey))
            throw Error('Kredi hesabının bağlı borcu zaten tanımlanmış. Ayrı borç oluşturmayın.');
          definitions.add(debtKey);
        }
      }
      for (const field of [
        'openingBalance',
        'currentDebt',
        'creditLimit',
        'amount',
        'destinationAmount',
        'amountTRY',
      ])
        if (data[field] != null)
          minor(
            data[field],
            (item.kind === 'account' &&
              field === 'openingBalance' &&
              !['CREDIT_CARD', 'OVERDRAFT'].includes(String(data.type))) ||
              (item.kind === 'transaction' &&
                ['SAVINGS', 'ADJUSTMENT'].includes(String(data.type))),
          );
    }
    while (pending.length) {
      const hasDefinitions = pending.some((item) => item.kind !== 'transaction');
      const index = pending.findIndex(
        (item) =>
          (!hasDefinitions || item.kind !== 'transaction') &&
          Object.entries(item.data).every(
            ([field, value]) =>
              !referenceKinds[field] ||
              typeof value !== 'string' ||
              !value.startsWith('@') ||
              records.has(value.slice(1)),
          ),
      );
      if (index < 0) throw Error('Yerel referans bulunamadı veya döngü içeriyor.');
      const item = pending.splice(index, 1)[0];
      const data = Object.fromEntries(
        Object.entries(item.data).filter(([, value]) => value != null),
      ) as Record<string, unknown>;
      for (const [field, expected] of Object.entries(referenceKinds)) {
        if (data[field] == null) continue;
        if (typeof data[field] !== 'string') throw Error('Referans kimliği geçersiz.');
        const value = data[field] as string;
        if (value.startsWith('@')) {
          const record = records.get(value.slice(1))!;
          if (expected === 'debt' && record.kind === 'account') {
            const debt = this.finance.listDebts().find((debt) => debt.accountId === record.id);
            if (!debt) throw Error('Hesabın bağlı kredi borcu bulunamadı.');
            data[field] = debt.id;
          } else {
            if (record.kind !== expected) throw Error('Yerel referans türü eşleşmiyor.');
            data[field] = record.id;
          }
        }
        const existing =
          expected === 'account'
            ? this.finance.listAccounts()
            : expected === 'debt'
              ? this.finance.listDebts()
              : expected === 'obligation'
                ? this.finance.listObligations()
                : this.finance.listSubscriptions();
        if (!existing.some((entity) => entity.id === data[field]))
          throw Error('Referans bulunamadı veya türü eşleşmiyor.');
      }
      let result: { id: string };
      switch (item.kind) {
        case 'transaction':
          result =
            data.type === 'EXPENSE' && typeof data.obligationId === 'string'
              ? this.finance.payObligation(data.obligationId, data as unknown as TransactionInput)
              : data.type === 'EXPENSE' && typeof data.subscriptionId === 'string'
                ? this.finance.paySubscription(
                    data.subscriptionId,
                    data as unknown as TransactionInput,
                  )
                : this.finance.createTransaction(data as unknown as TransactionInput);
          break;
        case 'account':
          result = this.finance.createAccount(data as unknown as AccountInput);
          break;
        case 'debt':
          result = this.finance.createDebt(data as unknown as DebtInput);
          break;
        case 'obligation':
          result = this.finance.createObligation(data as unknown as ObligationInput);
          break;
        case 'subscription':
          result = this.finance.createSubscription(data as unknown as SubscriptionInput);
          break;
        case 'cycle':
          result = this.finance.startCycle(data);
          break;
      }
      records.set(item.key, { key: item.key, kind: item.kind, id: result.id });
    }
    return plan.items.map((item) => records.get(item.key)!);
  }
}
