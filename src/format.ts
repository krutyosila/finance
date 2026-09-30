import type { Currency, MoneyTotals, TransactionType } from '../shared/types';

export const typeNames: Record<TransactionType, string> = {
  INCOME: 'Gelir',
  EXPENSE: 'Harcama',
  DEBT_PAYMENT: 'Borç ödemesi',
  DEBT_USAGE: 'Borç kullanımı',
  TRANSFER: 'Transfer',
  SAVINGS: 'Birikim',
  REFUND: 'İade',
  ADJUSTMENT: 'Düzeltme',
};
export const accountNames = {
  BANK: 'Banka hesabı',
  CASH: 'Nakit',
  CREDIT_CARD: 'Kredi kartı',
  OVERDRAFT: 'Kredili mevduat / KMH',
  WALLET: 'Cüzdan',
  SAVINGS: 'Birikim hesabı',
};
export const debtNames = {
  CREDIT_CARD: 'Kredi kartı',
  OVERDRAFT: 'Kredili mevduat / KMH',
  LOAN: 'Kredi',
  PERSONAL: 'Kişisel borç',
  OTHER: 'Diğer',
};
export const frequencyNames = {
  WEEKLY: 'Haftalık',
  MONTHLY: 'Aylık',
  QUARTERLY: 'Üç aylık',
  YEARLY: 'Yıllık',
};
export const statusNames = {
  UPCOMING: 'Yaklaşıyor',
  PAID: 'Ödendi',
  OVERDUE: 'Gecikmiş',
  CANCELLED: 'İptal edildi',
};
export function money(value: string | undefined | null, currency: Currency = 'TRY') {
  if (value === undefined || value === null) return '—';
  // Format the service's exact decimal string without converting money to floating point.
  const negative = value.startsWith('-');
  const [whole, decimals = ''] = value.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const number = `${negative ? '−' : ''}${grouped},${decimals.padEnd(2, '0')}`;
  return currency === 'TRY' ? `₺${number}` : `${number} ${currency}`;
}
export function date(value: string) {
  return new Date(value).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function shortDate(value: string) {
  return new Date(value).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
  });
}
export function localDateTime(value?: string) {
  const at = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function isoDateTime(value: string) {
  const asUTC = new Date(`${value}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(asUTC);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const inZoneAsUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return new Date(asUTC.getTime() - (inZoneAsUTC - asUTC.getTime())).toISOString();
}
export function transactionTimestamp(visibleDateTime: string, originalInstant: string) {
  return visibleDateTime === localDateTime(originalInstant)
    ? originalInstant
    : isoDateTime(visibleDateTime);
}
export function dateInput(value?: string) {
  return localDateTime(value).slice(0, 10);
}
export function hasMoney(totals: MoneyTotals) {
  return Object.keys(totals).length > 0;
}
