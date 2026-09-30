import { History as HistoryIcon } from 'lucide-react';
import type { AuditEntry, Currency, FinancialContext } from '../../shared/types';
import { useResource } from '../api';
import { accountNames, date, debtNames, frequencyNames, money, typeNames } from '../format';
import { Empty, ErrorMessage, Loading, Tag } from './ui';

const names: Record<string, string> = {
  amount: 'Tutar',
  currency: 'Para birimi',
  category: 'Kategori',
  description: 'Açıklama',
  timestamp: 'Tarih',
  type: 'Tür',
  notes: 'Notlar',
  accountId: 'Hesap',
  destinationAccountId: 'Hedef hesap',
  debtId: 'Borç',
  scope: 'Kapsam',
  openingBalance: 'Başlangıç bakiyesi',
  currentBalance: 'Güncel bakiye',
  active: 'Aktif',
  service: 'Hizmet',
  name: 'Ad',
  dueDate: 'Vade tarihi',
  nextRenewal: 'Sonraki yenileme',
  frequency: 'Sıklık',
  destinationAmount: 'Alınan tutar',
  debtComponent: 'Borç bileşeni',
  currentDebt: 'Güncel borç',
  creditLimit: 'Kredi limiti',
  owner: 'Hesap sahibi',
  amountTRY: 'Gerçek TRY tutarı',
  exchangeRate: 'Kur',
};
export function History({ entityId, context }: { entityId: string; context?: FinancialContext }) {
  function value(input: unknown, key: string, source: Record<string, unknown>) {
    if (input === null || input === undefined || input === '') return '—';
    if (typeof input === 'boolean') return input ? 'Evet' : 'Hayır';
    if (typeof input === 'object') return JSON.stringify(input);
    if (key === 'accountId' || key === 'destinationAccountId')
      return context?.accounts.find((account) => account.id === input)?.name || 'Kayıtlı hesap';
    if (key === 'debtId')
      return context?.debts.find((debt) => debt.id === input)?.name || 'Kayıtlı borç';
    if (
      [
        'amount',
        'openingBalance',
        'currentBalance',
        'currentDebt',
        'creditLimit',
        'amountTRY',
      ].includes(key)
    )
      return money(
        String(input),
        key === 'amountTRY' ? 'TRY' : (source.currency as Currency) || 'TRY',
      );
    if (key === 'dueDate' || key === 'nextRenewal' || key === 'timestamp')
      return date(String(input));
    if (typeof input === 'string' && input in typeNames)
      return typeNames[input as keyof typeof typeNames];
    if (typeof input === 'string' && input in accountNames)
      return accountNames[input as keyof typeof accountNames];
    if (typeof input === 'string' && input in debtNames)
      return debtNames[input as keyof typeof debtNames];
    if (typeof input === 'string' && input in frequencyNames)
      return frequencyNames[input as keyof typeof frequencyNames];
    if (input === 'PERSONAL') return 'Kişisel';
    if (input === 'BUSINESS') return 'İş';
    if (input === 'PRINCIPAL') return 'Anapara';
    if (input === 'INTEREST') return 'Faiz';
    if (input === 'FEE') return 'Masraf';
    return String(input);
  }
  const resource = useResource<AuditEntry[]>(`/audit?entityId=${encodeURIComponent(entityId)}`);
  return (
    <div className="history-content">
      {resource.error ? (
        <ErrorMessage message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <Loading text="İşlem geçmişi yükleniyor…" />
      ) : !resource.data.length ? (
        <Empty
          compact
          icon={<HistoryIcon size={23} />}
          title="Henüz işlem geçmişi yok"
          detail="Bu kayıttaki değişiklikler burada görünür."
        />
      ) : (
        <div className="history-timeline">
          {resource.data.map((item) => {
            const before = (item.before || {}) as Record<string, unknown>;
            const after = (item.after || {}) as Record<string, unknown>;
            const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
              (key) => names[key] && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
            );
            return (
              <article key={item.id}>
                <span className="timeline-dot" />
                <div className="history-event-head">
                  <Tag
                    tone={
                      item.action === 'DELETE' ? 'red' : item.action === 'RESTORE' ? 'teal' : ''
                    }
                  >
                    {{
                      CREATE: 'Oluşturuldu',
                      EDIT: 'Düzenlendi',
                      DELETE: 'Silindi',
                      RESTORE: 'Geri yüklendi',
                    }[item.action] || item.action}
                  </Tag>
                  <time>
                    {date(item.timestamp)} ·{' '}
                    {new Date(item.timestamp).toLocaleTimeString('tr-TR', {
                      timeZone: 'Europe/Istanbul',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                <dl>
                  {fields.map((key) => (
                    <div key={key}>
                      <dt>{names[key]}</dt>
                      <dd>
                        {Boolean(item.before) && (
                          <>
                            <span className="before-value">{value(before[key], key, before)}</span>
                            <span className="change-arrow">→</span>
                          </>
                        )}
                        {value(after[key], key, after)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
