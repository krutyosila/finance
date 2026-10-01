import { z } from 'zod';
import type { LabelScanSnapshot, LabelScanSuggestion, Transaction } from '../../shared/types';
import type { FinanceService } from '../core/service';
import type { AiInterpreter, AiLabelClassificationInput } from './client';
import { AiError } from './errors';

const requestValidator = z
  .object({
    transactions: z
      .array(
        z
          .object({
            transactionId: z.string().min(1).max(128),
            transactionUpdatedAt: z.string().min(1).max(40),
            previousLabelId: z.string().min(1).max(128).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

/** Classification previews never change labels or any financial record. */
export class AiLabelScanService {
  constructor(
    private readonly finance: FinanceService,
    private readonly interpreter: AiInterpreter,
  ) {}

  private currentTransactions(snapshots: LabelScanSnapshot[]): Transaction[] {
    const current = new Map(
      this.finance.listTransactions().map((transaction) => [transaction.id, transaction]),
    );
    return snapshots.map((snapshot) => {
      const transaction = current.get(snapshot.transactionId);
      if (
        !transaction ||
        transaction.updatedAt !== snapshot.transactionUpdatedAt ||
        (transaction.labelId ?? null) !== snapshot.previousLabelId
      )
        throw new AiError(
          'Taranan işlemler değişti. İşlem listesini yenileyip yeniden tarayın.',
          409,
        );
      return transaction;
    });
  }

  async preview(value: unknown): Promise<{ suggestions: LabelScanSuggestion[] }> {
    const parsed = requestValidator.safeParse(value);
    if (!parsed.success) throw new AiError('Tarama için 1–50 geçerli işlem gönderin.', 400);
    const snapshots = parsed.data.transactions;
    if (new Set(snapshots.map((row) => row.transactionId)).size !== snapshots.length)
      throw new AiError('Tarama aynı işlemi birden fazla içeremez.', 400);
    const transactions = this.currentTransactions(snapshots);
    const labels = this.finance.listLabels();
    if (!labels.length) throw new AiError('Taramadan önce en az bir etkin etiket oluşturun.', 400);
    if (labels.length > 200) throw new AiError('AI etiket referans sınırı aşıldı.', 400);
    if (!this.interpreter.classifyLabels)
      throw new AiError('AI etiket tarayıcısı kullanılamıyor.', 503);
    const labelIds = new Map(
      labels.map((label, index) => [`existing_label_${index + 1}`, label.id]),
    );
    const transactionIds = new Map(
      transactions.map((transaction, index) => [
        `existing_transaction_${index + 1}`,
        transaction.id,
      ]),
    );
    const input: AiLabelClassificationInput = {
      labels: labels.map(({ name, description }, index) => ({
        id: `existing_label_${index + 1}`,
        name,
        description,
      })),
      transactions: transactions.map(({ description, category, counterparty, notes }, index) => ({
        id: `existing_transaction_${index + 1}`,
        description,
        category,
        counterparty: counterparty ?? null,
        notes: notes ?? null,
      })),
    };
    if (JSON.stringify(input.transactions).length > 120000)
      throw new AiError(
        'İşlem açıklamaları bu tarama için çok uzun. Daha küçük gruplar halinde tarayın.',
        400,
      );
    const output = await this.interpreter.classifyLabels(input);
    if (!Array.isArray(output) || output.length !== transactions.length)
      throw new AiError(
        'AI bütün işlemler için tek bir etiket önerisi döndürmedi. Etiketler değiştirilmedi.',
        502,
      );
    const proposals = new Map<string, string | null>();
    for (const row of output) {
      if (
        !row ||
        !transactionIds.has(row.transactionId) ||
        proposals.has(row.transactionId) ||
        (row.labelId !== null && !labelIds.has(row.labelId))
      )
        throw new AiError('AI etiket bağlantıları doğrulanamadı. Etiketler değiştirilmedi.', 502);
      proposals.set(row.transactionId, row.labelId === null ? null : labelIds.get(row.labelId)!);
    }
    this.currentTransactions(snapshots);
    const active = new Set(this.finance.listLabels().map((label) => label.id));
    if ([...proposals.values()].some((labelId) => labelId !== null && !active.has(labelId)))
      throw new AiError(
        'Taramadaki bir etiket arşivlendi. Güncel etiketlerle yeniden tarayın.',
        409,
      );
    return {
      suggestions: snapshots.map((snapshot, index) => ({
        ...snapshot,
        labelId: proposals.get(`existing_transaction_${index + 1}`)!,
      })),
    };
  }
}
