import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LabelScanSnapshot, Transaction } from '../shared/types';
import type { AiInterpreter, AiLabelClassificationInput } from '../server/ai/client';
import { FinanceService } from '../server/core/service';
import { AiLabelScanService } from '../server/ai/label-scan';

const fixtures: FinanceService[] = [];
function fixture() {
  const finance = new FinanceService(':memory:');
  fixtures.push(finance);
  const label = finance.createLabel({ name: 'Ev', description: 'Ev eşyaları ve market' });
  const transaction = finance.createTransaction({
    type: 'EXPENSE',
    amount: '321.45',
    currency: 'TRY',
    description: 'Yeni masa',
    category: 'Alışveriş',
    counterparty: 'Mobilyacı',
    notes: 'Çalışma odası için',
  });
  return { finance, label, transaction };
}
function snapshot(tx: Transaction): LabelScanSnapshot {
  return {
    transactionId: tx.id,
    transactionUpdatedAt: tx.updatedAt,
    previousLabelId: tx.labelId ?? null,
  };
}
async function service(finance: FinanceService, interpreter: Partial<AiInterpreter> = {}) {
  return new AiLabelScanService(finance, {
    interpret: async () => {
      throw Error('Legacy unused');
    },
    ...interpreter,
  });
}
afterEach(() => fixtures.splice(0).forEach((finance) => finance.close()));

describe('bounded AI label scan previews', () => {
  it('aliases transaction and label IDs and sends only classification text', async () => {
    const { finance, label, transaction } = fixture();
    const archived = finance.createLabel({ name: 'Arşiv', description: 'Özel eski tanım' });
    finance.archiveLabel(archived.id);
    const before = finance.listAudit().length;
    const classifyLabels = vi.fn(async (input: AiLabelClassificationInput) => {
      expect(input).toEqual({
        labels: [{ id: 'existing_label_1', name: 'Ev', description: 'Ev eşyaları ve market' }],
        transactions: [
          {
            id: 'existing_transaction_1',
            description: 'Yeni masa',
            category: 'Alışveriş',
            counterparty: 'Mobilyacı',
            notes: 'Çalışma odası için',
          },
        ],
      });
      const payload = JSON.stringify(input);
      for (const excluded of [
        label.id,
        archived.id,
        transaction.id,
        transaction.updatedAt,
        '321.45',
        'Özel eski tanım',
      ])
        expect(payload).not.toContain(excluded);
      return [{ transactionId: 'existing_transaction_1', labelId: 'existing_label_1' }];
    });
    const result = await (
      await service(finance, { classifyLabels })
    ).preview({ transactions: [snapshot(transaction)] });
    expect(result.suggestions).toEqual([{ ...snapshot(transaction), labelId: label.id }]);
    expect(finance.listTransactions()).toEqual([transaction]);
    expect(finance.listAudit()).toHaveLength(before);
    expect(finance.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_entry_receipts').get()).toEqual({
      n: 0,
    });
  });

  it('reevaluates already labelled records and preserves a null clearing suggestion for review', async () => {
    const { finance, label, transaction } = fixture();
    const labelled = finance.updateTransaction(transaction.id, { labelId: label.id });
    const result = await (
      await service(finance, {
        classifyLabels: async () => [{ transactionId: 'existing_transaction_1', labelId: null }],
      })
    ).preview({ transactions: [snapshot(labelled)] });
    expect(result.suggestions).toEqual([{ ...snapshot(labelled), labelId: null }]);
    expect(finance.listTransactions()[0].labelId).toBe(label.id);
  });

  it('covers a full 50-row chunk exactly even when the provider reorders its suggestions', async () => {
    const { finance, label, transaction } = fixture();
    const transactions = [transaction];
    for (let i = 1; i < 50; i++)
      transactions.push(
        finance.createTransaction({
          type: 'EXPENSE',
          amount: '1',
          currency: 'TRY',
          description: `Market ${i}`,
        }),
      );
    const snapshots = transactions.map(snapshot);
    const result = await (
      await service(finance, {
        classifyLabels: async (input) =>
          input.transactions
            .map((tx) => ({
              transactionId: tx.id,
              labelId: 'existing_label_1',
            }))
            .reverse(),
      })
    ).preview({ transactions: snapshots });
    expect(result.suggestions).toEqual(snapshots.map((row) => ({ ...row, labelId: label.id })));
    expect(finance.listTransactions().every((tx) => tx.labelId === null)).toBe(true);
  });

  it('rejects duplicate suggestions even when their count matches the request', async () => {
    const { finance, transaction } = fixture();
    const other = finance.createTransaction({
      type: 'EXPENSE',
      amount: '1',
      currency: 'TRY',
      description: 'İkinci alışveriş',
    });
    await expect(
      (
        await service(finance, {
          classifyLabels: async () => [
            { transactionId: 'existing_transaction_1', labelId: null },
            { transactionId: 'existing_transaction_1', labelId: null },
          ],
        })
      ).preview({ transactions: [snapshot(transaction), snapshot(other)] }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it.each([
    { output: [] },
    {
      output: [
        { transactionId: 'existing_transaction_1', labelId: 'existing_label_1' },
        { transactionId: 'existing_transaction_1', labelId: null },
      ],
    },
    { output: [{ transactionId: 'invented', labelId: 'existing_label_1' }] },
    { output: [{ transactionId: 'existing_transaction_1', labelId: 'invented' }] },
    { output: [{ transactionId: 'existing_transaction_1', labelId: '@existing_label_1' }] },
  ])('rejects missing, duplicate, or invented provider mappings: $output', async ({ output }) => {
    const { finance, transaction } = fixture();
    await expect(
      (await service(finance, { classifyLabels: async () => output })).preview({
        transactions: [snapshot(transaction)],
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(finance.listTransactions()).toEqual([transaction]);
  });

  it('rejects a persistent ID instead of accepting an unadvertised provider reference', async () => {
    const { finance, label, transaction } = fixture();
    await expect(
      (
        await service(finance, {
          classifyLabels: async () => [{ transactionId: transaction.id, labelId: label.id }],
        })
      ).preview({ transactions: [snapshot(transaction)] }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('rejects duplicate requests and chunks larger than 50 before provider calls', async () => {
    const { finance, transaction } = fixture();
    const classifyLabels = vi.fn(async () => []);
    const scanner = await service(finance, { classifyLabels });
    for (const transactions of [
      [snapshot(transaction), snapshot(transaction)],
      Array(51).fill(snapshot(transaction)),
    ])
      await expect(scanner.preview({ transactions })).rejects.toMatchObject({ statusCode: 400 });
    expect(classifyLabels).not.toHaveBeenCalled();
  });

  it('rejects stale or deleted request rows before provider calls', async () => {
    const { finance, transaction } = fixture();
    const classifyLabels = vi.fn(async () => []);
    const scanner = await service(finance, { classifyLabels });
    finance.updateTransaction(transaction.id, { description: 'Düzeltilmiş masa' });
    await expect(scanner.preview({ transactions: [snapshot(transaction)] })).rejects.toMatchObject({
      statusCode: 409,
    });
    finance.deleteTransaction(transaction.id);
    await expect(scanner.preview({ transactions: [snapshot(transaction)] })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(classifyLabels).not.toHaveBeenCalled();
  });

  it('rejects a selected label archived during classification', async () => {
    const { finance, label, transaction } = fixture();
    await expect(
      (
        await service(finance, {
          classifyLabels: async () => {
            finance.archiveLabel(label.id);
            return [{ transactionId: 'existing_transaction_1', labelId: 'existing_label_1' }];
          },
        })
      ).preview({ transactions: [snapshot(transaction)] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(finance.listTransactions()).toEqual([transaction]);
  });

  it('rejects transaction changes while the provider is classifying', async () => {
    const { finance, transaction } = fixture();
    await expect(
      (
        await service(finance, {
          classifyLabels: async () => {
            finance.updateTransaction(transaction.id, { description: 'Düzeltme' });
            return [{ transactionId: 'existing_transaction_1', labelId: null }];
          },
        })
      ).preview({ transactions: [snapshot(transaction)] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(finance.listTransactions()[0].labelId).toBeNull();
  });

  it('requires an active catalog without calling the provider or clearing archived labels', async () => {
    const { finance, label, transaction } = fixture();
    const labelled = finance.updateTransaction(transaction.id, { labelId: label.id });
    finance.archiveLabel(label.id);
    const classifyLabels = vi.fn(async () => []);
    await expect(
      (await service(finance, { classifyLabels })).preview({ transactions: [snapshot(labelled)] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(classifyLabels).not.toHaveBeenCalled();
    expect(finance.listTransactions()[0].labelId).toBe(label.id);
  });

  it('bounds the active catalog before any scan provider call', async () => {
    const { finance, transaction } = fixture();
    for (let i = 0; i < 200; i++) finance.createLabel({ name: `Ek etiket ${i}` });
    const classifyLabels = vi.fn(async () => []);
    await expect(
      (await service(finance, { classifyLabels })).preview({
        transactions: [snapshot(transaction)],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(classifyLabels).not.toHaveBeenCalled();
  });

  it('rejects oversized text rather than silently clipping its meaning', async () => {
    const { finance, transaction } = fixture();
    const large = finance.updateTransaction(transaction.id, { notes: 'x'.repeat(120001) });
    const classifyLabels = vi.fn(async () => []);
    await expect(
      (await service(finance, { classifyLabels })).preview({ transactions: [snapshot(large)] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(classifyLabels).not.toHaveBeenCalled();
  });
});
