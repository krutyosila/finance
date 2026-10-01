import type { AiPlan, AiRecordDraft, AiRecordKind } from '../../shared/types';
import type { AiReferences } from './client';

export const AI_REFERENCE_KINDS: Record<string, AiRecordKind> = {
  accountId: 'account',
  destinationAccountId: 'account',
  debtId: 'debt',
  obligationId: 'obligation',
  subscriptionId: 'subscription',
};

/** Keep one call's short reference tokens bound to its exact local snapshot. */
export function prepareAiReferences(original: AiReferences) {
  const aliases = new Map<AiRecordKind, Map<string, string>>();
  const persistent = new Map<AiRecordKind, Set<string>>();
  function shorten<T extends { id: string }>(kind: AiRecordKind, rows: T[]): T[] {
    const mapping = new Map<string, string>();
    aliases.set(kind, mapping);
    persistent.set(kind, new Set(rows.map((row) => row.id)));
    return rows.map((row, index) => {
      const id = `existing_${kind}_${index + 1}`;
      mapping.set(id, row.id);
      return { ...row, id };
    });
  }
  const accounts = shorten('account', original.accounts);
  const accountTokens = new Map(
    accounts.map((row, index) => [original.accounts[index].id, row.id]),
  );
  const references: AiReferences = {
    ...original,
    accounts,
    debts: shorten('debt', original.debts).map((row) => ({
      ...row,
      accountId: row.accountId ? (accountTokens.get(row.accountId) ?? null) : null,
    })),
    subscriptions: shorten('subscription', original.subscriptions ?? []),
    obligations: shorten('obligation', original.obligations ?? []),
    currentCycle: original.currentCycle ? { ...original.currentCycle, id: 'existing_cycle' } : null,
  };
  function matches(item: AiRecordDraft | undefined, expected: AiRecordKind) {
    return (
      item &&
      (item.kind === expected ||
        (expected === 'debt' &&
          item.kind === 'account' &&
          ['CREDIT_CARD', 'OVERDRAFT'].includes(String(item.data.type))))
    );
  }
  return {
    references,
    resolve(plan: AiPlan): AiPlan {
      const local = new Map(plan.items.map((item) => [item.key, item]));
      const issues = [...plan.issues];
      const items = plan.items.map((item) => ({
        ...item,
        data: Object.fromEntries(
          Object.entries(item.data).map(([field, value]) => {
            const expected = AI_REFERENCE_KINDS[field];
            if (!expected || typeof value !== 'string') return [field, value];
            if (value.startsWith('@')) {
              if (local.has(value.slice(1))) return [field, value];
              return [field, aliases.get(expected)?.get(value.slice(1)) ?? value];
            }
            const existing =
              aliases.get(expected)?.get(value) ??
              (persistent.get(expected)?.has(value) ? value : undefined);
            const samePlan = matches(local.get(value), expected);
            if (existing && samePlan) {
              issues.push(
                'Bağlantı hem mevcut kaydı hem yeni plan kaydını gösteriyor. Hangi kayda ait olduğunu netleştirin.',
              );
              return [field, value];
            }
            return [field, existing ?? (samePlan ? `@${value}` : value)];
          }),
        ),
      })) as AiRecordDraft[];
      return {
        ...plan,
        items,
        issues: [...new Set(issues)],
        certain: plan.certain && !issues.length,
      };
    },
  };
}
