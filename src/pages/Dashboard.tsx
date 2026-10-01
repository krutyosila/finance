import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { FinancialContext, Transaction } from '../../shared/types';
import { date, money, typeNames } from '../format';
import { LabelChart, TrendChart } from '../components/LazyCharts';
import { Button, Empty, LinkButton, Money, Panel, SectionHead, Tag } from '../components/ui';
import { useAuth } from '../auth';

export function Dashboard({
  context,
  onQuickEntry,
  navigate,
  onCreate,
  onCycle,
  onEndCycle,
  onTransaction,
}: {
  context: FinancialContext;
  onQuickEntry: () => void;
  navigate: (page: string) => void;
  onCreate: (kind: 'accounts' | 'debts' | 'recurring' | 'subscriptions') => void;
  onCycle: () => void;
  onEndCycle: () => void;
  onTransaction: (transaction: Transaction) => void;
}) {
  const { session } = useAuth();
  const labelNames = new Map((context.labels ?? []).map((label) => [label.id, label.name]));
  const fresh = !context.transactionCount && !context.accounts.length && !context.debts.length;
  const metrics = [
    {
      label: 'Kullanılabilir nakit',
      value: context.metrics.availableCash,
      icon: Wallet,
      detail: 'Bugün kullanabileceğiniz para',
      accent: 'teal',
    },
    {
      label: 'Gerçek harcamalar',
      value: context.metrics.expenses,
      icon: ReceiptText,
      detail: 'Borç ödemelerinden ayrı harcamalar',
      accent: 'blue',
    },
    {
      label: 'Toplam borç',
      value: context.metrics.debt,
      icon: Landmark,
      detail: 'Şu anda borçlu olduğunuz tutar',
      accent: '',
    },
    {
      label: 'Net finansal durum',
      value: context.metrics.netFinancialPosition,
      icon: CircleDollarSign,
      detail: 'Varlıklarınız eksi borçlarınız',
      accent: '',
    },
  ];
  const moreMetrics = [
    ['Gelir', context.metrics.income],
    ['Nakit çıkışı', context.metrics.cashOutflow],
    ['Ödenen borç', context.metrics.debtPayments],
    ['Yeni borç kullanımı', context.metrics.debtUsage],
    ['Birikimler', context.metrics.savings],
    ['Net nakit akışı', context.metrics.netCashFlow],
  ] as const;
  const upcoming = [
    ...context.recurringObligations
      .filter((item) => item.active && item.status !== 'PAID')
      .map((item) => ({
        id: item.id,
        name: item.name,
        at: item.dueDate,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        page: 'Düzenli ödemeler',
      })),
    ...context.subscriptions
      .filter((item) => item.active && item.status !== 'PAID')
      .map((item) => ({
        id: item.id,
        name: item.service,
        at: item.nextRenewal,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        page: 'Abonelikler',
      })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 4);
  return (
    <>
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">FİNANSINIZA NET BİR BAKIŞ</span>
          <h1>Her gün, biraz daha net.</h1>
          <p>
            {fresh
              ? 'Finansınıza sakin bir alan açın. Bulunduğunuz yerden başlayın.'
              : 'Finansal durumunuzu ve paranızın nereye gittiğini açıkça görün.'}
          </p>
        </div>
        <div className="today">
          <CalendarDays size={16} />
          {date(new Date().toISOString())}
        </div>
      </div>
      <div className="overview-head">
        <h2>Finansal görünümünüz</h2>
        <span>{context.currentCycle ? context.currentCycle.name : 'Tüm kayıtlı hareketler'}</span>
      </div>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <Panel className={`metric-card metric-${metric.accent}`} key={metric.label}>
            <div className="metric-label">
              <span>{metric.label}</span>
              <metric.icon size={17} />
            </div>
            <Money totals={metric.value} className="metric-number" />
            <p>{metric.detail}</p>
          </Panel>
        ))}
      </div>
      <Panel className="secondary-metrics">
        {moreMetrics.map(([label, totals]) => (
          <div key={label}>
            <span>{label}</span>
            <Money totals={totals} />
          </div>
        ))}
      </Panel>
      {fresh && (
        <div className="onboarding">
          <div className="onboarding-icon">
            <Sparkles size={21} />
          </div>
          <div>
            <h3>Yeni bir başlangıç. Kendi rakamlarınız, kendi hızınız.</h3>
            <p>Sağ alttaki + düğmesiyle ilk notunuzu ekleyin veya hesaplarınızı oluşturun.</p>
          </div>
          <div className="onboarding-actions">
            <Button onClick={onQuickEntry}>
              <Sparkles size={15} />
              Not ekle
            </Button>
            <Button variant="secondary" onClick={() => onCreate('accounts')}>
              <Plus size={15} />
              Hesap ekle
            </Button>
            <Button variant="ghost" onClick={() => onCreate('debts')}>
              Borç ekle
              <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      )}
      <div className="charts-grid">
        <TrendChart context={context} />
        <LabelChart context={context} />
      </div>
      <div className="dashboard-bottom">
        <Panel className="recent-panel">
          <SectionHead
            title="Son işlemler"
            description="Her işlem, doğru yerde."
            action={<LinkButton onClick={() => navigate('İşlemler')}>Tümünü gör</LinkButton>}
          />
          {!context.recentTransactions.length ? (
            <Empty
              compact
              icon={<ReceiptText size={23} />}
              title="İlk kaydınızla başlayın"
              detail="Sağ alttaki + düğmesiyle bir not ekleyin. Gelir, harcama ve borç hareketlerinin her biri ayrı izlenir."
            />
          ) : (
            <div className="activity-list">
              {context.recentTransactions.slice(0, 5).map((transaction) => (
                <button
                  className="activity-row"
                  key={transaction.id}
                  onClick={() => onTransaction(transaction)}
                >
                  <span className={`activity-icon type-${transaction.type}`}>
                    {transaction.type === 'INCOME' || transaction.type === 'REFUND' ? (
                      <ArrowDownLeft size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <span className="activity-description">
                    <strong>{transaction.description}</strong>
                    <small>
                      {(transaction.labelId && labelNames.get(transaction.labelId)) || 'Etiketsiz'}{' '}
                      · {date(transaction.timestamp)}
                    </small>
                  </span>
                  <span className="activity-amount">
                    <strong>{money(transaction.amount, transaction.currency)}</strong>
                    <Tag tone={transaction.type === 'INCOME' ? 'teal' : ''}>
                      {typeNames[transaction.type]}
                    </Tag>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>
        <div className="right-stack">
          <Panel className="cycle-panel">
            <SectionHead title="Finansal döneminiz" action={<CalendarDays size={17} />} />
            {context.currentCycle ? (
              <>
                <h3>{context.currentCycle.name}</h3>
                <p>{date(context.currentCycle.start)} tarihinde başladı</p>
                <div className="cycle-actions">
                  <Button variant="secondary" onClick={() => navigate('Raporlar')}>
                    Dönem raporunu gör
                    <ArrowUpRight size={14} />
                  </Button>
                  <button className="text-button" onClick={onEndCycle}>
                    Dönemi bitir
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>Döneminiz sizin ritminize uyar. Uygun bulduğunuz zaman başlatıp bitirin.</p>
                <Button variant="secondary" onClick={onCycle}>
                  <Plus size={15} />
                  İlk finansal dönemi başlat
                </Button>
              </>
            )}
          </Panel>
          <Panel className="upcoming-panel">
            <SectionHead
              title="Yaklaşan ödemeler"
              action={
                <LinkButton onClick={() => navigate('Düzenli ödemeler')}>Tümünü gör</LinkButton>
              }
            />
            {!upcoming.length ? (
              <div className="quiet-empty">
                <CalendarDays size={19} />
                <p>
                  Henüz planlanmış ödeme yok.
                  <br />
                  <button className="text-button" onClick={() => onCreate('recurring')}>
                    Düzenli ödeme ekle
                  </button>
                </p>
              </div>
            ) : (
              upcoming.map((item) => (
                <button className="upcoming-row" key={item.id} onClick={() => navigate(item.page)}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {date(item.at)}
                      {item.status === 'OVERDUE' ? ' · Gecikmiş' : ''}
                    </small>
                  </span>
                  <strong>{money(item.amount, item.currency)}</strong>
                </button>
              ))
            )}
          </Panel>
        </div>
      </div>
      <p className="workspace-foot">
        <ShieldCheck size={14} />{' '}
        {session.required
          ? 'Gizlilik önceliğimiz. Finansal alanınız parolanızla korunur.'
          : 'Gizlilik önceliğimiz. Finansal kayıtlarınız bu bilgisayarda kalır.'}
      </p>
    </>
  );
}
