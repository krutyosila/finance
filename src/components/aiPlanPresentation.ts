import type {
  AiPlan,
  AiRecordDraft,
  AiRecordKind,
  Currency,
  FinancialContext,
} from '../../shared/types';
import { accountNames, debtNames, frequencyNames, money, typeNames } from '../format';
export const aiKindNames: Record<AiRecordKind, string> = {
  transaction: 'İşlem',
  account: 'Hesap',
  debt: 'Borç',
  obligation: 'Düzenli ödeme',
  subscription: 'Abonelik',
  cycle: 'Dönem',
};
export function canConfirmPlan(plan: AiPlan) {
  return (
    plan.certain &&
    !plan.issues.length &&
    plan.items.length > 0 &&
    plan.items.length <= 25 &&
    plan.text.length <= 12000
  );
}
export function appendPlanFollowUp(plan: AiPlan, followUp: string) {
  const text = `${plan.text}\n\nEk bilgi: ${followUp.trim()}`;
  if (text.length > 12000)
    throw new Error('Toplam not 12.000 karakteri aşamaz. Daha kısa bir ek bilgi yazın.');
  return text;
}
const fieldNames: Record<string, string> = {
  name: 'Ad',
  service: 'Hizmet',
  description: 'Açıklama',
  type: 'Tür',
  amount: 'Tutar',
  currency: 'Para birimi',
  timestamp: 'Tarih ve saat',
  start: 'Başlangıç',
  dueDate: 'Son ödeme',
  nextRenewal: 'Yenileme',
  frequency: 'Sıklık',
  scope: 'Kapsam',
  accountId: 'Hesap',
  destinationAccountId: 'Hedef hesap',
  debtId: 'Borç',
  obligationId: 'Düzenli ödeme',
  subscriptionId: 'Abonelik',
  openingBalance: 'Başlangıç bakiyesi',
  currentDebt: 'Mevcut borç',
  creditLimit: 'Kredi limiti',
  destinationAmount: 'Alınan tutar',
  amountTRY: 'Gerçek TRY tutarı',
  exchangeRate: 'TRY dönüşüm kuru',
  category: 'Kategori',
  notes: 'Notlar',
  owner: 'Hesap sahibi',
  counterparty: 'Karşı taraf',
  paymentMethod: 'Ödeme yöntemi',
  debtComponent: 'Borç bileşeni',
  active: 'Durum',
};
const moneyFields = new Set([
  'amount',
  'openingBalance',
  'currentDebt',
  'creditLimit',
  'destinationAmount',
  'amountTRY',
]);
function itemName(item: AiRecordDraft) {
  const data = item.data as Record<string, unknown>;
  return String(
    data.name ||
      data.service ||
      data.description ||
      (item.kind === 'cycle' ? 'Finans dönemi' : aiKindNames[item.kind]),
  );
}
function accountName(name: string, currency: unknown) {
  if (currency === 'TRY') return `${name} TL`;
  if (currency === 'USD' || currency === 'EUR' || currency === 'USDT') return `${name} ${currency}`;
  return name;
}
function relation(value: string, field: string, plan: AiPlan, context: FinancialContext) {
  const accountLink = field === 'accountId' || field === 'destinationAccountId';
  if (value.startsWith('@')) {
    const linked = plan.items.find((item) => item.key === value.slice(1));
    if (!linked) return 'Bağlantı bulunamadı; ek bilgi gerekli';
    const name =
      accountLink && linked.kind === 'account'
        ? accountName(itemName(linked), linked.data.currency)
        : itemName(linked);
    return `${name}${field === 'debtId' && linked.kind === 'account' ? ' borcu' : ''} (yeni)`;
  }
  const records =
    field === 'debtId'
      ? context.debts
      : field === 'obligationId'
        ? context.recurringObligations
        : field === 'subscriptionId'
          ? context.subscriptions
          : context.accounts;
  const record = records.find((record) => record.id === value);
  if (!record) return 'Bağlantı bulunamadı; ek bilgi gerekli';
  const name = 'service' in record ? record.service : record.name;
  return accountLink && 'currency' in record ? accountName(name, record.currency) : name;
}
export function describeAiItem(item: AiRecordDraft, plan: AiPlan, context: FinancialContext) {
  const data = item.data as Record<string, unknown>;
  const fields: [string, string][] = [];
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    let label = String(value);
    if (field.endsWith('Id')) label = relation(label, field, plan, context);
    else if (moneyFields.has(field)) {
      const destination =
        field === 'destinationAmount' && typeof data.destinationAccountId === 'string'
          ? data.destinationAccountId
          : null;
      const newAccount = destination?.startsWith('@')
        ? plan.items.find((item) => item.kind === 'account' && item.key === destination.slice(1))
        : undefined;
      const targetCurrency =
        newAccount && 'currency' in newAccount.data
          ? newAccount.data.currency
          : context.accounts.find((account) => account.id === destination)?.currency;
      const currency =
        field === 'amountTRY'
          ? 'TRY'
          : field === 'destinationAmount'
            ? targetCurrency || data.currency
            : data.currency;
      label = currency
        ? money(String(value), currency as Currency)
        : `${value} (para birimi belirtilmedi)`;
    } else if (field === 'type') {
      const names =
        item.kind === 'transaction' ? typeNames : item.kind === 'debt' ? debtNames : accountNames;
      label = (names as Record<string, string>)[label] || 'Tür belirtilmedi';
    } else if (field === 'frequency')
      label = frequencyNames[value as keyof typeof frequencyNames] || 'Sıklık belirtilmedi';
    else if (field === 'scope') label = value === 'BUSINESS' ? 'İş' : 'Kişisel';
    else if (field === 'debtComponent')
      label =
        ({ PRINCIPAL: 'Anapara', INTEREST: 'Faiz', FEE: 'Masraf' } as Record<string, string>)[
          label
        ] || 'Belirtilmedi';
    else if (field === 'active') label = value ? 'Aktif' : 'Pasif';
    else if (['timestamp', 'start', 'dueDate', 'nextRenewal'].includes(field)) {
      const at = new Date(label);
      label = Number.isNaN(at.getTime())
        ? 'Tarih netleştirilmeli'
        : at.toLocaleString('tr-TR', {
            timeZone: 'Europe/Istanbul',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            ...(field === 'timestamp' ? { hour: '2-digit', minute: '2-digit' } : {}),
          });
    }
    fields.push([fieldNames[field] || 'Ek ayrıntı', label]);
  }
  if (item.kind === 'transaction' && !data.timestamp) {
    fields.push(['Tarih ve saat', 'Kaydedildiği an']);
  }
  if (item.kind === 'cycle') {
    if (!data.name) fields.push(['Ad', 'Finans dönemi']);
    if (!data.start) fields.push(['Başlangıç', 'Kaydedildiği an']);
  }
  const note =
    item.kind === 'account' && ['CREDIT_CARD', 'OVERDRAFT'].includes(String(data.type))
      ? 'Bu hesapla birlikte aynı ad ve para biriminde bağlı borç kaydı da oluşturulur. Mevcut borç başlangıç borcu olarak kullanılır.'
      : undefined;
  const title =
    item.kind === 'account' ? accountName(itemName(item), data.currency) : itemName(item);
  return { title, kind: aiKindNames[item.kind], fields, note };
}
