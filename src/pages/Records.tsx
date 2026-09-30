import {
  CalendarDays,
  CreditCard,
  Landmark,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
  Wallet,
} from 'lucide-react';
import type {
  Account,
  Debt,
  FinancialContext,
  Obligation,
  Subscription,
  TransactionInput,
} from '../../shared/types';
import { accountNames, date, debtNames, frequencyNames, money } from '../format';
import {
  Button,
  Empty,
  IconButton,
  Money,
  PageIntro,
  Panel,
  SectionHead,
  Tag,
} from '../components/ui';

export type RecordKind = 'accounts' | 'debts' | 'recurring' | 'subscriptions';
export type FinanceRecord = Account | Debt | Obligation | Subscription;
const pageCopy = {
  accounts: {
    eyebrow: 'PARANIZIN DURDUĞU YER',
    title: 'Hesaplar',
    description: 'Bakiyeleriniz kendi para biriminde, her hesap türü için ayrı bir yer.',
    singular: 'hesap',
    empty: 'Hesaplarınızı bir araya getirin',
    detail: 'Gerçek başlangıç bakiyenizle banka, nakit, birikim, cüzdan veya kredi hesabı ekleyin.',
    icon: Wallet,
  },
  debts: {
    eyebrow: 'ÖNÜNÜZÜ NET GÖRÜN',
    title: 'Borçlar',
    description: 'Borcunuzu, ödemelerinizi ve zaman içindeki değişimi izleyin.',
    singular: 'borç',
    empty: 'Borçlarınıza net bir bakış',
    detail:
      'Kredi kartı, KMH, kredi veya kişisel borç ekleyin. Borç ödemeleri harcamalardan ayrı kalır.',
    icon: Landmark,
  },
  recurring: {
    eyebrow: 'BİR ADIM DAHA HAZIR',
    title: 'Düzenli ödemeler',
    description: 'Günlük hayatınızdaki düzenli ödemeleri önceden planlayın.',
    singular: 'düzenli ödeme',
    empty: 'Düzenli ödemelerinizi görünür kılın',
    detail:
      'Düzenli ödemeleri ve vade tarihlerini ekleyin. Planlar kendiliğinden harcamaya dönüşmez.',
    icon: Repeat2,
  },
  subscriptions: {
    eyebrow: 'DEVAM EDEN HİZMETLERİNİZ',
    title: 'Abonelikler',
    description: 'Kullandığınız hizmetleri ve yaklaşan yenilemeleri bir arada görün.',
    singular: 'abonelik',
    empty: 'Aboneliklerinizi bir araya getirin',
    detail:
      'Kullandığınız hizmetleri, ücretlerini ve yenileme tarihlerini ekleyin. Gerçek ödemeleri gerçekleştiklerinde kaydedin.',
    icon: CreditCard,
  },
};
export function Records({
  kind,
  context,
  onAdd,
  onEdit,
  onDelete,
  onHistory,
  onPay,
}: {
  kind: RecordKind;
  context: FinancialContext;
  onAdd: () => void;
  onEdit: (record: FinanceRecord) => void;
  onDelete: (record: FinanceRecord) => void;
  onHistory: (record: FinanceRecord) => void;
  onPay: (path: string, initial: Partial<TransactionInput>) => void;
}) {
  const copy = pageCopy[kind];
  const Icon = copy.icon;
  const records: FinanceRecord[] =
    kind === 'accounts'
      ? context.accounts
      : kind === 'debts'
        ? context.debts
        : kind === 'recurring'
          ? context.recurringObligations
          : context.subscriptions;
  const scheduled = kind === 'recurring' || kind === 'subscriptions';
  const accountName = (id?: string | null) =>
    context.accounts.find((account) => account.id === id)?.name || 'Hesapsız nakit';
  return (
    <>
      <PageIntro
        {...copy}
        action={
          <Button onClick={onAdd}>
            <Plus size={17} />
            {copy.singular.charAt(0).toLocaleUpperCase('tr-TR') + copy.singular.slice(1)} ekle
          </Button>
        }
      />
      {!records.length ? (
        <Panel>
          <Empty
            icon={<Icon size={28} />}
            title={copy.empty}
            detail={copy.detail}
            action={
              <Button variant="secondary" onClick={onAdd}>
                <Plus size={16} />
                İlk {copy.singular} kaydınızı ekleyin
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          {kind === 'accounts' && (
            <Panel className="record-summary">
              <div>
                <span>Toplam kullanılabilir nakit</span>
                <Money totals={context.metrics.availableCash} />
              </div>
              <div>
                <span>Birikimler</span>
                <Money totals={context.metrics.savings} />
              </div>
              <div>
                <span>Toplam varlık</span>
                <Money totals={context.metrics.assets} />
              </div>
              <p>Kredi limiti kullanılabilir kapasitedir, varlık değildir.</p>
            </Panel>
          )}
          {kind === 'debts' && (
            <Panel className="record-summary">
              <div>
                <span>Toplam borç</span>
                <Money totals={context.metrics.debt} />
              </div>
              <div>
                <span>Bu dönemde ödenen borç</span>
                <Money totals={context.metrics.debtPayments} />
              </div>
              <div>
                <span>Yeni borç kullanımı</span>
                <Money totals={context.metrics.debtUsage} />
              </div>
              <p>Borç anapara ödemeleri gerçek harcamalardan ayrı tutulur.</p>
            </Panel>
          )}
          <div className={scheduled ? 'schedule-list' : 'record-grid'}>
            {records.map((record) => {
              const name =
                kind === 'subscriptions'
                  ? (record as Subscription).service
                  : (record as Account | Debt | Obligation).name;
              const schedule = record as Obligation | Subscription;
              const liability =
                kind === 'accounts' &&
                ((record as Account).type === 'CREDIT_CARD' ||
                  (record as Account).type === 'OVERDRAFT');
              const at =
                kind === 'subscriptions'
                  ? (record as Subscription).nextRenewal
                  : (record as Obligation).dueDate;
              const status = scheduled
                ? !schedule.active
                  ? kind === 'subscriptions'
                    ? 'İptal edildi'
                    : 'Pasif'
                  : schedule.status === 'PAID'
                    ? 'Ödendi'
                    : schedule.status === 'OVERDUE'
                      ? 'Gecikmiş'
                      : 'Yaklaşıyor'
                : '';
              return (
                <Panel key={record.id} className={scheduled ? 'schedule-card' : 'record-card'}>
                  <div className="record-card-head">
                    <span className={`record-icon ${kind}`}>
                      <Icon size={20} />
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <p>
                        {kind === 'accounts'
                          ? accountNames[(record as Account).type]
                          : kind === 'debts'
                            ? debtNames[(record as Debt).type]
                            : `${frequencyNames[schedule.frequency]} · ${schedule.scope === 'BUSINESS' ? 'İş' : 'Kişisel'}`}
                      </p>
                    </div>
                    <div className="record-actions">
                      <IconButton label={`${name} düzenle`} onClick={() => onEdit(record)}>
                        <Pencil size={15} />
                      </IconButton>
                      <details className="record-menu">
                        <summary className="icon-button" aria-label={`${name} için diğer işlemler`}>
                          <MoreHorizontal size={17} />
                        </summary>
                        <div>
                          <button onClick={() => onHistory(record)}>İşlem geçmişi</button>
                          <button className="danger-text" onClick={() => onDelete(record)}>
                            <Trash2 size={14} />
                            Sil
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  {scheduled ? (
                    <>
                      <div className="schedule-price">
                        <strong>{money(schedule.amount, schedule.currency)}</strong>
                        <span>{frequencyNames[schedule.frequency].toLowerCase()}</span>
                      </div>
                      <div className="schedule-due">
                        <span>
                          <CalendarDays size={15} />
                          {date(at)}
                        </span>
                        <Tag
                          tone={status === 'Gecikmiş' ? 'red' : status === 'Ödendi' ? 'teal' : ''}
                        >
                          {status}
                        </Tag>
                      </div>
                      <div className="schedule-account">
                        <span>{accountName(schedule.accountId)}</span>
                        <small>{schedule.category || 'Kategorisiz'}</small>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={!schedule.active || schedule.status === 'PAID'}
                        onClick={() =>
                          onPay(`/${kind}/${record.id}/pay`, {
                            type: 'EXPENSE',
                            amount: schedule.amount,
                            currency: schedule.currency,
                            description: name,
                            category: schedule.category,
                            accountId: schedule.accountId,
                            scope: schedule.scope,
                            ...(kind === 'subscriptions'
                              ? { subscriptionId: record.id }
                              : { obligationId: record.id }),
                          })
                        }
                      >
                        {schedule.status === 'PAID' ? 'Ödeme kaydedildi' : 'Ödeme kaydet'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="record-balance">
                        <span>
                          {kind === 'debts' || liability ? 'Güncel borç' : 'Güncel bakiye'}
                        </span>
                        <strong>
                          {money(
                            kind === 'debts'
                              ? (record as Debt).currentBalance
                              : liability
                                ? (record as Account).currentDebt
                                : (record as Account).currentBalance,
                            record.currency,
                          )}
                        </strong>
                      </div>
                      {kind === 'accounts' && (
                        <div className="record-details">
                          <div>
                            <span>Başlangıç bakiyesi</span>
                            <strong>
                              {money((record as Account).openingBalance, record.currency)}
                            </strong>
                          </div>
                          {(record as Account).owner && (
                            <div>
                              <span>Hesap sahibi</span>
                              <strong>{(record as Account).owner}</strong>
                            </div>
                          )}
                          {(record as Account).creditLimit && (
                            <div>
                              <span>Kredi limiti</span>
                              <strong>
                                {money((record as Account).creditLimit, record.currency)}
                              </strong>
                            </div>
                          )}
                        </div>
                      )}
                      {kind === 'debts' && (
                        <>
                          <div className="record-details">
                            {[
                              ['Başlangıç borcu', (record as Debt).openingBalance],
                              ['Ödemeler', (record as Debt).payments],
                              ['Yeni kullanım', (record as Debt).newUsage],
                              ['Faiz', (record as Debt).interest],
                              ['Masraflar', (record as Debt).fees],
                              ['Net değişim', (record as Debt).netChange],
                            ].map(([label, amount]) => (
                              <div key={label}>
                                <span>{label}</span>
                                <strong>{money(amount, record.currency)}</strong>
                              </div>
                            ))}
                            {(record as Debt).creditLimit && (
                              <div>
                                <span>Kredi limiti</span>
                                <strong>
                                  {money((record as Debt).creditLimit, record.currency)}
                                </strong>
                              </div>
                            )}
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              onPay('', {
                                type: 'DEBT_PAYMENT',
                                currency: record.currency,
                                debtId: record.id,
                                description: `${name} ödemesi`,
                              })
                            }
                          >
                            Borç ödemesi kaydet
                          </Button>
                        </>
                      )}
                      {(record as Account | Debt).notes && (
                        <p className="record-notes">{(record as Account | Debt).notes}</p>
                      )}
                    </>
                  )}
                </Panel>
              );
            })}
          </div>
        </>
      )}
      {kind === 'accounts' && Object.keys(context.unassignedCash).length > 0 && (
        <Panel className="unassigned-panel">
          <SectionHead
            title="Hesapsız nakit"
            description="Hesap seçmediğiniz işlemler de finansal görünümünüze dâhildir."
          />
          <Money totals={context.unassignedCash} />
        </Panel>
      )}
      {scheduled && (
        <p className="page-note">
          Beklenen giderler plan niteliğindedir. Yalnızca kaydedilen ödemeler gerçek harcamalara
          eklenir.
        </p>
      )}
    </>
  );
}
