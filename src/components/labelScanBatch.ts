import type {
  CatalogLabel,
  LabelScanSnapshot,
  LabelScanSuggestion,
  Transaction,
} from '../../shared/types';

export function scanLabelsAvailable(suggestions: LabelScanSuggestion[], labels: CatalogLabel[]) {
  const active = new Set(labels.filter((label) => !label.archived).map((label) => label.id));
  return suggestions.every(
    (suggestion) => suggestion.labelId === null || active.has(suggestion.labelId),
  );
}

export function labelScanBatches(records: Transaction[]): LabelScanSnapshot[][] {
  const batches: LabelScanSnapshot[][] = [];
  let batch: LabelScanSnapshot[] = [];
  let size = 2;
  for (const record of records) {
    // Reserve room for provider row identifiers and separators without clipping any text.
    const textSize =
      JSON.stringify({
        description: record.description,
        category: record.category,
        counterparty: record.counterparty,
        notes: record.notes,
      }).length + 64;
    if (textSize + 2 > 100000)
      throw new Error('Bir işlem tarama metni sınırını aşıyor. Hiçbir işlem değiştirilmedi.');
    if (batch.length && (batch.length === 50 || size + textSize > 100000)) {
      batches.push(batch);
      batch = [];
      size = 2;
    }
    batch.push({
      transactionId: record.id,
      transactionUpdatedAt: record.updatedAt,
      previousLabelId: record.labelId || null,
    });
    size += textSize;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
