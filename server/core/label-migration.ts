import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { labelDisplayName, labelNameKey } from './labelNames';

function clearedLabel(before: string | null, after: string | null): boolean {
  try {
    const previous = before ? JSON.parse(before) : null,
      current = after ? JSON.parse(after) : null;
    return typeof previous?.labelId === 'string' && current?.labelId === null;
  } catch {
    return false;
  }
}

export function backfillLegacyCategories(sqlite: Database.Database): void {
  const cleared = new Set(
    (
      sqlite
        .prepare(
          "SELECT entity_id, before_json, after_json FROM audit WHERE entity='TRANSACTION' AND action='EDIT'",
        )
        .all() as {
        entity_id: string;
        before_json: string | null;
        after_json: string | null;
      }[]
    )
      .filter((entry) => clearedLabel(entry.before_json, entry.after_json))
      .map((entry) => entry.entity_id),
  );
  const catalog = new Map<string, string>();
  const labels = sqlite
    .prepare('SELECT id,name FROM labels ORDER BY archived,created_at,id')
    .all() as { id: string; name: string }[];
  for (const label of labels) {
    const key = labelNameKey(label.name);
    if (!catalog.has(key)) catalog.set(key, label.id);
  }
  const records = sqlite
    .prepare('SELECT id,category FROM transactions WHERE label_id IS NULL ORDER BY created_at,id')
    .all() as { id: string; category: string }[];
  const insert = sqlite.prepare(
      'INSERT INTO labels(id,name,normalized_name,description,archived,created_at,updated_at) VALUES(?,?,?,NULL,0,?,?)',
    ),
    assign = sqlite.prepare('UPDATE transactions SET label_id=? WHERE id=? AND label_id IS NULL'),
    timestamp = new Date().toISOString();
  const ensureLabel = (category: string): string | null => {
    const name = labelDisplayName(category);
    if (!name) return null;
    const key = labelNameKey(name);
    let labelId = catalog.get(key);
    if (!labelId) {
      labelId = `legacy-${createHash('sha256').update(key).digest('hex')}`;
      insert.run(labelId, name, key, timestamp, timestamp);
      catalog.set(key, labelId);
    }
    return labelId;
  };
  for (const record of records) {
    if (cleared.has(record.id)) continue;
    const labelId = ensureLabel(record.category);
    if (!labelId) continue;
    assign.run(labelId, record.id);
  }
  for (const table of ['obligations', 'subscriptions'] as const) {
    const plans = sqlite.prepare(`SELECT category FROM ${table} ORDER BY created_at,id`).all() as {
      category: string;
    }[];
    for (const plan of plans) ensureLabel(plan.category);
  }
}
