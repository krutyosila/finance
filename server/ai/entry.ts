import { createHash } from 'node:crypto';
import type { EntryResult, ParseResult, TransactionInput } from '../../shared/types';
import { CURRENCIES, TRANSACTION_TYPES } from '../../shared/types';
import type { FinanceService } from '../core/service';
import { minor } from '../core/money';
import { AuthError } from '../auth';
import { AiError } from './errors';
import type { AiInterpreter, AiReferences } from './client';
import { LABEL_REFERENCE_ISSUE, prepareAiReferences } from './references';

export class AiEntryService {
  private readonly pending = new Map<string, { hash: string; result: Promise<EntryResult> }>();
  constructor(
    private readonly finance: FinanceService,
    private readonly model: AiInterpreter,
  ) {}
  private text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000)
      throw new AiError('Not 1–2000 karakter arasında olmalıdır.', 400);
    return value.trim();
  }
  private references(): AiReferences {
    const accounts = this.finance.listAccounts(),
      debts = this.finance.listDebts(),
      labels = this.finance
        .listLabels()
        .map(({ id, name, description }) => ({ id, name, description }));
    if (accounts.length > 200 || debts.length > 200 || labels.length > 200)
      throw new AiError('AI hesap listesi sınırına ulaşıldı. Elle işlem girişi kullanın.', 400);
    const timeZone = process.env.FINANCE_TIMEZONE ?? 'Europe/Istanbul';
    return {
      accounts: accounts.map(({ id, name, type, currency }) => ({ id, name, type, currency })),
      debts: debts.map(({ id, name, type, currency, accountId }) => ({
        id,
        name,
        type,
        currency,
        accountId: accountId ?? null,
      })),
      labels,
      date: new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      timeZone,
    };
  }
  async interpret(value: unknown): Promise<ParseResult> {
    const text = this.text(value),
      references = this.references(),
      snapshot = prepareAiReferences(references);
    const result = await this.model.interpret(text, {
      ...references,
      labels: snapshot.references.labels,
    });
    const resolved = snapshot.resolve({
      text,
      certain: result.certain,
      issues: result.issues,
      items: [{ key: 'transaction', kind: 'transaction', data: result.draft }],
    });
    const issues = [
        ...resolved.issues,
        ...(resolved.labelIssues ?? []).map((issue) => issue.message),
      ],
      draft = { ...resolved.items[0].data } as ParseResult['draft'];
    delete draft.category;
    if (
      draft.labelId != null &&
      !this.finance.listLabels().some((label) => label.id === draft.labelId)
    )
      issues.push(LABEL_REFERENCE_ISSUE);
    if (!draft.type || !TRANSACTION_TYPES.includes(draft.type)) issues.push('İşlem türünü seçin.');
    if (!draft.currency || !CURRENCIES.includes(draft.currency))
      issues.push('Desteklenen para birimini seçin.');
    if (!draft.description?.trim()) issues.push('İşlemin açıklamasını yazın.');
    try {
      const amount = minor(draft.amount, draft.type === 'SAVINGS' || draft.type === 'ADJUSTMENT');
      if (!amount || (draft.type !== 'SAVINGS' && draft.type !== 'ADJUSTMENT' && amount < 0))
        issues.push('Tutar sıfırdan büyük olmalıdır.');
      if (draft.destinationAmount != null) minor(draft.destinationAmount, draft.type === 'SAVINGS');
      if (draft.amountTRY != null) minor(draft.amountTRY, draft.type === 'ADJUSTMENT');
    } catch {
      issues.push('Tutarı en fazla iki ondalık basamakla ve güvenli kayıt sınırında belirtin.');
    }
    for (const field of ['accountId', 'destinationAccountId'] as const)
      if (draft[field] && !references.accounts.some((account) => account.id === draft[field])) {
        delete draft[field];
        issues.push('Belirtilen hesap bulunamadı; mevcut bir hesap seçin.');
      }
    if (draft.debtId && !references.debts.some((debt) => debt.id === draft.debtId)) {
      delete draft.debtId;
      issues.push('Belirtilen borç bulunamadı; mevcut bir borç seçin.');
    }
    if (draft.type === 'ADJUSTMENT') issues.push('Bakiye düzeltmesini gözden geçirip onaylayın.');
    return {
      text,
      draft,
      certain: result.certain && issues.length === 0,
      issues: [...new Set(issues)],
    };
  }
  private receipt(id: string, hash: string): EntryResult | null {
    const row = this.finance.sqlite
      .prepare('SELECT input_hash, result_json FROM ai_entry_receipts WHERE request_id=?')
      .get(id) as { input_hash: string; result_json: string } | undefined;
    if (!row) return null;
    if (row.input_hash !== hash)
      throw new AiError(
        'Bu istek kimliği farklı bir not için kullanılmış. Yeni bir işlem başlatın.',
        409,
      );
    return JSON.parse(row.result_json) as EntryResult;
  }
  async addText(
    value: unknown,
    requestId: unknown,
    authorize: () => void = () => {},
  ): Promise<EntryResult> {
    const text = this.text(value);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
      throw new AiError('Geçerli bir requestId gönderin.', 400);
    const hash = createHash('sha256').update(text).digest('hex');
    const receipt = this.receipt(requestId, hash);
    if (receipt) return receipt;
    const pending = this.pending.get(requestId);
    if (pending) {
      if (pending.hash !== hash)
        throw new AiError('Bu istek kimliği farklı bir not için kullanılıyor.', 409);
      return pending.result;
    }
    const result = this.add(text, requestId, hash, authorize);
    this.pending.set(requestId, { hash, result });
    try {
      return await result;
    } finally {
      this.pending.delete(requestId);
    }
  }
  private async add(
    text: string,
    requestId: string,
    hash: string,
    authorize: () => void,
  ): Promise<EntryResult> {
    const confirmation = await this.interpret(text);
    if (!confirmation.certain) return { saved: false, confirmation };
    try {
      return this.finance.sqlite
        .transaction(() => {
          authorize();
          const existing = this.receipt(requestId, hash);
          if (existing) return existing;
          const transaction = this.finance.createTransaction(
            confirmation.draft as TransactionInput,
          );
          const result: EntryResult = { saved: true, transaction };
          this.finance.sqlite
            .prepare(
              'INSERT INTO ai_entry_receipts(request_id,input_hash,result_json,created_at) VALUES(?,?,?,?)',
            )
            .run(requestId, hash, JSON.stringify(result), new Date().toISOString());
          return result;
        })
        .immediate();
    } catch (error) {
      if (error instanceof AiError || error instanceof AuthError) throw error;
      const message =
        error instanceof Error && error.name !== 'ZodError' && !error.message.includes('SQLITE')
          ? error.message
          : 'İşlemin alanları doğrulanamadı. Lütfen gözden geçirin.';
      return {
        saved: false,
        confirmation: {
          ...confirmation,
          certain: false,
          issues: [...confirmation.issues, message],
        },
      };
    }
  }
}
