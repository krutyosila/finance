import type { Account, AiPlan, AiRecordDraft } from '../../shared/types';
import { converted, decimal, minor } from '../core/money';
import { validateAccountInput } from '../core/service';

const cashTypes = new Set(['BANK', 'CASH', 'WALLET', 'SAVINGS']);
export const TRACKING_OPENING_NOTE =
  'Yeni hesap için bu hareketlerden önceki kayıt başlangıcı 0 kabul edildi. Önceki bakiyeniz varsa ek bilgiyle belirtin.';

function accountName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Prepare proposed accounts and currency transfers without changing the ledger. */
export function prepareAccountChain(plan: AiPlan, accounts: Account[]): AiPlan {
  const issues = [...plan.issues];
  const movementAccounts = new Set(
    plan.items.flatMap((item) =>
      item.kind === 'transaction'
        ? [item.data.accountId, item.data.destinationAccountId].filter(
            (value): value is string => typeof value === 'string' && value.startsWith('@'),
          )
        : [],
    ),
  );
  const reused = new Map<string, string>();
  let items: AiRecordDraft[] = plan.items.flatMap((item): AiRecordDraft[] => {
    if (
      item.kind !== 'account' ||
      !movementAccounts.has(`@${item.key}`) ||
      !cashTypes.has(String(item.data.type)) ||
      typeof item.data.name !== 'string' ||
      !item.data.name.trim() ||
      typeof item.data.currency !== 'string'
    )
      return [item];
    try {
      validateAccountInput(
        Object.fromEntries(Object.entries(item.data).filter(([, value]) => value != null)),
      );
    } catch (error) {
      issues.push(
        error instanceof Error && error.name !== 'ZodError'
          ? error.message
          : `${item.data.name} hesabının alanlarını kontrol edin.`,
      );
      return [item];
    }

    const notes = typeof item.data.notes === 'string' ? item.data.notes : undefined;
    const automatic =
      item.data.openingBalance == null ||
      (item.data.openingBalance === '0.00' && notes?.includes(TRACKING_OPENING_NOTE));
    const matches = accounts.filter(
      (account) =>
        cashTypes.has(account.type) &&
        account.currency === item.data.currency &&
        accountName(account.name) === accountName(item.data.name!) &&
        (item.data.owner == null ||
          (typeof item.data.owner === 'string' &&
            accountName(account.owner) === accountName(item.data.owner))),
    );
    if (matches.length === 1) {
      const existing = matches[0];
      if (
        (!automatic &&
          minor(item.data.openingBalance, true) !== minor(existing.openingBalance, true)) ||
        (item.data.creditLimit != null &&
          (existing.creditLimit == null ||
            minor(item.data.creditLimit) !== minor(existing.creditLimit)))
      ) {
        issues.push(
          `${item.data.name} (${item.data.currency}) mevcut hesabıyla belirtilen açılış bakiyesi veya limit farklı. Mevcut hesabı değiştirmeden kullanmak için bu bilgiyi netleştirin.`,
        );
        return [item];
      }
      reused.set(`@${item.key}`, matches[0].id);
      return [];
    }
    if (matches.length > 1) {
      issues.push(
        `${item.data.name} (${item.data.currency}) için birden fazla hesap var. Hangi hesabı kullanmak istiyorsunuz?`,
      );
      return [item];
    }
    if (!automatic) return [item];
    return [
      {
        ...item,
        data: {
          ...item.data,
          openingBalance: '0.00',
          notes: notes?.includes(TRACKING_OPENING_NOTE)
            ? notes
            : [notes, TRACKING_OPENING_NOTE].filter(Boolean).join('\n'),
        },
      },
    ];
  });
  items = items.map((item) => ({
    ...item,
    data: Object.fromEntries(
      Object.entries(item.data).map(([field, value]) => [
        field,
        ['accountId', 'destinationAccountId'].includes(field) && typeof value === 'string'
          ? (reused.get(value) ?? value)
          : value,
      ]),
    ),
  })) as AiRecordDraft[];

  function linkedAccount(reference: unknown) {
    if (typeof reference !== 'string' || !reference) return undefined;
    if (reference.startsWith('@')) {
      const item = items.find((item) => item.key === reference.slice(1));
      return item?.kind === 'account' ? item.data : undefined;
    }
    return accounts.find((account) => account.id === reference);
  }
  items = items.map((item) => {
    if (
      item.kind !== 'transaction' ||
      item.data.type !== 'TRANSFER' ||
      typeof item.data.currency !== 'string'
    )
      return item;
    const destination = linkedAccount(item.data.destinationAccountId);
    if (!destination?.currency || destination.currency === item.data.currency) return item;
    const source = linkedAccount(item.data.accountId);
    const data = { ...item.data };
    try {
      if (destination.currency === 'TRY' && data.exchangeRate != null && data.amount != null) {
        const total = converted(minor(data.amount), data.exchangeRate);
        if (data.destinationAmount != null && minor(data.destinationAmount) !== total) {
          issues.push(
            'Döviz çevrimindeki net kur ve hedef tutar uyuşmuyor. Gerçek net karşılığı belirtin.',
          );
        } else {
          data.destinationAmount = decimal(total);
        }
      }
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : 'Döviz çevrimindeki kuru ve tutarı kontrol edin.',
      );
    }
    if (data.destinationAmount == null) {
      const currency = destination.currency === 'TRY' ? 'TL' : destination.currency;
      issues.push(
        `${source?.name ?? 'Kaynak hesap'} hesabındaki ${data.amount ?? ''} ${data.currency} çevriminden ${destination.name ?? 'hedef hesap'} hesabına net kaç ${currency} geçti? Gerçek toplamı${destination.currency === 'TRY' ? ' veya işlemde kullanılan net kuru' : ''} belirtin.`,
      );
    }
    return { ...item, data };
  });
  return { ...plan, items, issues: [...new Set(issues)], certain: plan.certain && !issues.length };
}
