import { useState } from 'react';
import { ArrowDownToLine, CalendarDays, ChartNoAxesCombined, FileText } from 'lucide-react';
import type { Cycle, FinancialContext, MoneyTotals } from '../../shared/types';
import { useResource } from '../api';
import { date, frequencyNames, money, statusNames } from '../format';
import { CategoryChart, TrendChart } from '../components/LazyCharts';
import { debtBalancePresentation } from '../components/balancePresentation';
import {
  Button,
  Empty,
  ErrorMessage,
  Loading,
  Money,
  PageIntro,
  Panel,
  SectionHead,
  Tag,
} from '../components/ui';

const tabs = [
  'Genel bakış',
  'Nakit akışı',
  'Gelir',
  'Harcamalar',
  'Borç',
  'Planlı giderler',
  'Kategoriler',
  'İş ve kişisel',
] as const;
type ReportTab = (typeof tabs)[number];
export function Reports({
  context,
  revision,
  onExport,
  onCycle,
  onEndCycle,
}: {
  context: FinancialContext;
  revision: number;
  onExport: () => void;
  onCycle: () => void;
  onEndCycle: () => void;
}) {
  const [tab, setTab] = useState<ReportTab>('Genel bakış');
  const [cycleId, setCycleId] = useState(context.currentCycle?.id || '');
  const [range, setRange] = useState({ from: '', to: '' });
  const cycles = useResource<Cycle[]>('/cycles', revision);
  const params = new URLSearchParams();
  if (cycleId) params.set('cycleId', cycleId);
  else {
    params.set('all', 'true');
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
  }
  const report = useResource<FinancialContext>(`/reports?${params}`, revision);
  const selectedCycle = cycles.data?.find((cycle) => cycle.id === cycleId);
  const data = report.data;
  function MetricRows({ rows }: { rows: readonly (readonly [string, MoneyTotals, string])[] }) {
    return (
      <div className="report-metrics">
        {rows.map(([label, totals, hint]) => (
          <div key={label}>
            <div>
              <strong>{label}</strong>
              <p>{hint}</p>
            </div>
            <Money totals={totals} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      <PageIntro
        eyebrow="BÜYÜK RESMİ GÖRÜN"
        title="Raporlar"
        description="Yalnızca gerçek finansal kayıtlarınıza dayanan anlamlı yanıtlar."
        action={
          <Button variant="secondary" onClick={onExport}>
            <ArrowDownToLine size={16} />
            Kayıtları dışa aktar
          </Button>
        }
      />
      <Panel className="report-controls">
        <label>
          <CalendarDays size={17} />
          <span className="sr-only">Rapor dönemi</span>
          <select
            value={cycleId}
            onChange={(event) => {
              setCycleId(event.target.value);
              setRange({ from: '', to: '' });
            }}
          >
            <option value="">Tüm hareketler / özel tarihler</option>
            {cycles.data?.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
                {cycle.end ? '' : ' · aktif'}
              </option>
            ))}
          </select>
        </label>
        {!cycleId ? (
          <div className="report-date-range">
            <label>
              Başlangıç
              <input
                type="date"
                value={range.from}
                onChange={(event) =>
                  setRange((previous) => ({ ...previous, from: event.target.value }))
                }
              />
            </label>
            <span>—</span>
            <label>
              Bitiş
              <input
                type="date"
                value={range.to}
                onChange={(event) =>
                  setRange((previous) => ({ ...previous, to: event.target.value }))
                }
              />
            </label>
          </div>
        ) : (
          <span className="report-period">
            {selectedCycle
              ? `${date(selectedCycle.start)} — ${selectedCycle.end ? date(selectedCycle.end) : 'Bugün'}`
              : 'Dönem yükleniyor…'}
          </span>
        )}
        <Button variant="ghost" onClick={context.currentCycle ? onEndCycle : onCycle}>
          {context.currentCycle ? 'Aktif dönemi bitir' : 'Dönem başlat'}
        </Button>
      </Panel>
      <div className="report-tabs" aria-label="Rapor türleri" role="group">
        {tabs.map((item) => (
          <button
            key={item}
            aria-pressed={tab === item}
            className={item === tab ? 'active' : ''}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {report.error ? (
        <ErrorMessage message={report.error} retry={report.refresh} />
      ) : !data ? (
        <Loading text="Raporunuz hazırlanıyor…" />
      ) : (
        <div aria-busy={report.loading} className="report-content">
          {tab === 'Genel bakış' && (
            <>
              <Panel>
                <SectionHead
                  title={selectedCycle ? selectedCycle.name : 'Finansal görünümünüz'}
                  description="Nakit, harcama ve borç ayrı izlenir."
                />
                <MetricRows
                  rows={[
                    ['Gelir', data.metrics.income, 'Gelen para'],
                    [
                      'Gerçek harcamalar',
                      data.metrics.expenses,
                      'İadeler sonrası harcama; anapara ödemeleri hariç',
                    ],
                    [
                      'Nakit çıkışı',
                      data.metrics.cashOutflow,
                      'Harcamalara ve borç ödemelerine çıkan nakit',
                    ],
                    [
                      'Geri ödenen borç',
                      data.metrics.debtPayments,
                      'Bu dönemdeki anapara ödemeleri',
                    ],
                    [
                      'Yeni borç kullanımı',
                      data.metrics.debtUsage,
                      'Bu dönemdeki borçlanma ve borçla yapılan alışverişler',
                    ],
                    [
                      'Kalan nakit',
                      data.metrics.availableCash,
                      'Bu dönemin sonundaki kullanılabilir nakit',
                    ],
                    ['Kalan borç', data.metrics.debt, 'Bu dönemin sonundaki toplam borç'],
                    [
                      'Birikime eklenen',
                      data.metrics.savingsAdded,
                      'Bu dönemde birikime aktarılan para',
                    ],
                    [
                      'Başlangıç durumu',
                      data.openingPosition,
                      'Bu dönemin başındaki varlıklar eksi borçlar',
                    ],
                    [
                      'Kapanış durumu',
                      data.metrics.netFinancialPosition,
                      'Bu dönemin sonundaki varlıklar eksi borçlar',
                    ],
                    [
                      'Finansal durum değişimi',
                      data.positionChange,
                      'Bu dönemde net finansal durumdaki değişim',
                    ],
                  ]}
                />
              </Panel>
              <div className="charts-grid">
                <TrendChart context={data} />
                <CategoryChart context={data} />
              </div>
            </>
          )}
          {tab === 'Nakit akışı' && (
            <>
              <Panel>
                <SectionHead title="Hareket hâlindeki para" />
                <MetricRows
                  rows={[
                    [
                      'Kullanılabilir nakit',
                      data.metrics.availableCash,
                      'Birikim ve kredi kapasitesi hariç likit varlıklar',
                    ],
                    ['Gelir', data.metrics.income, 'Kaydedilen gelirler'],
                    [
                      'Nakit çıkışı',
                      data.metrics.cashOutflow,
                      'Nakit harcamalar ve nakit borç ödemeleri',
                    ],
                    [
                      'Net nakit akışı',
                      data.metrics.netCashFlow,
                      'Birikim hareketleri dâhil kullanılabilir nakit değişimi',
                    ],
                    ['Birikimler', data.metrics.savings, 'Birikimde tutulan para'],
                  ]}
                />
              </Panel>
              <TrendChart context={data} />
            </>
          )}
          {tab === 'Gelir' && (
            <>
              <Panel>
                <SectionHead
                  title="Gelir"
                  description="Transferler ve yeni borçlanmalar gelir sayılmaz."
                />
                <MetricRows
                  rows={[
                    ['Gelir', data.metrics.income, 'Kaydedilen gelirler, kendi para birimlerinde'],
                  ]}
                />
              </Panel>
              <TrendChart
                context={data}
                initial="income"
                title="Gelir ve gerçek harcamalar"
                compact
              />
            </>
          )}
          {tab === 'Harcamalar' && (
            <>
              <Panel>
                <SectionHead
                  title="Gerçek harcamalar"
                  description="İadeler düşülmüş harcamalar; borç anaparası ayrı tutulur."
                />
                <MetricRows
                  rows={[
                    ['Gerçek harcamalar', data.metrics.expenses, 'Gerçek tüketim harcamalarınız'],
                    [
                      'Nakit çıkışı',
                      data.metrics.cashOutflow,
                      'Nakit borç ödemeleri dâhil; borçla yapılan alışverişler hariç',
                    ],
                  ]}
                />
              </Panel>
              <div className="charts-grid">
                <TrendChart context={data} initial="daily" title="Günlük harcama" compact />
                <CategoryChart context={data} />
              </div>
            </>
          )}
          {tab === 'Borç' && (
            <>
              <Panel>
                <SectionHead title="Borç hareketleri" />
                <MetricRows
                  rows={[
                    ['Kalan borç', data.metrics.debt, 'Bu dönemin sonundaki borç'],
                    ['Ödenen borç', data.metrics.debtPayments, 'Bu dönemde ödenen anapara'],
                    [
                      'Yeni borç kullanımı',
                      data.metrics.debtUsage,
                      'Bu dönemdeki borçlanma ve borçla yapılan alışverişler',
                    ],
                  ]}
                />
              </Panel>
              <TrendChart
                context={data}
                initial="debt"
                title="Borç kullanımı ve ödemeler"
                compact
              />
              <Panel>
                <SectionHead
                  title="Her borç ayrı ayrı"
                  description="Ödeme, kullanım, faiz ve masraflar dönem sonuna kadar birikmiş tutarlardır."
                />
                {!data.debts.length ? (
                  <Empty
                    compact
                    icon={<FileText size={23} />}
                    title="Henüz borç kaydı yok"
                    detail="Kaydettiğiniz borçlar burada görünür."
                  />
                ) : (
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Borç</th>
                          <th>Güncel bakiye</th>
                          <th>Ödemeler</th>
                          <th>Yeni kullanım</th>
                          <th>Faiz</th>
                          <th>Masraflar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.debts.map((debt) => {
                          const balance = debtBalancePresentation(debt);
                          return (
                            <tr key={debt.id}>
                              <td>{debt.name}</td>
                              <td>
                                {money(balance.amount, debt.currency)}
                                {balance.label === 'Kart bakiyesi' && ' (Kart bakiyesi)'}
                              </td>
                              <td>{money(debt.payments, debt.currency)}</td>
                              <td>{money(debt.newUsage, debt.currency)}</td>
                              <td>{money(debt.interest, debt.currency)}</td>
                              <td>{money(debt.fees, debt.currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
          {tab === 'Planlı giderler' && (
            <Panel>
              <SectionHead
                title="Beklenen düzenli giderler"
                description="Planlar gerçek harcamalardan ayrı kalır. Giderler kendi ödeme sıklıklarıyla gösterilir."
              />
              {!data.recurringObligations.length && !data.subscriptions.length ? (
                <Empty
                  icon={<CalendarDays size={25} />}
                  title="Henüz planlanmış gider yok"
                  detail="Beklenen ödemelerinizi görmek için düzenli ödeme veya abonelik ekleyin."
                />
              ) : (
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Ödeme</th>
                        <th>Tür</th>
                        <th>Beklenen tutar</th>
                        <th>Sıklık</th>
                        <th>Sonraki tarih</th>
                        <th>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recurringObligations.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>Düzenli ödemeler</td>
                          <td>{money(item.amount, item.currency)}</td>
                          <td>{frequencyNames[item.frequency]}</td>
                          <td>{date(item.dueDate)}</td>
                          <td>
                            <Tag>{!item.active ? 'Pasif' : statusNames[item.status]}</Tag>
                          </td>
                        </tr>
                      ))}
                      {data.subscriptions.map((item) => (
                        <tr key={item.id}>
                          <td>{item.service}</td>
                          <td>Abonelik</td>
                          <td>{money(item.amount, item.currency)}</td>
                          <td>{frequencyNames[item.frequency]}</td>
                          <td>{date(item.nextRenewal)}</td>
                          <td>
                            <Tag>{!item.active ? 'İptal edildi' : statusNames[item.status]}</Tag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
          {tab === 'Kategoriler' && (
            <>
              <CategoryChart context={data} />
              <Panel>
                <SectionHead
                  title="Kategoriye göre harcamalar"
                  description="Kategorilere göre net harcamalar, para birimleri ayrı ayrı."
                />
                {!data.categoryTotals.length ? (
                  <Empty
                    compact
                    icon={<ChartNoAxesCombined size={25} />}
                    title="Henüz harcama kategorisi yok"
                    detail="Kategoriler, gerçek harcama ve iade kayıtlarınızdan oluşur."
                  />
                ) : (
                  <div className="report-metrics">
                    {data.categoryTotals.map((item) => (
                      <div key={item.category}>
                        <strong>{item.category}</strong>
                        <Money totals={item.totals} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
          {tab === 'İş ve kişisel' && (
            <Panel>
              <SectionHead
                title="İş ve kişisel harcamalar"
                description="İşlemlere atadığınız kapsama göre net gerçek harcamalar."
              />
              <MetricRows
                rows={[
                  [
                    'Kişisel',
                    data.scopeTotals.PERSONAL,
                    'Kişisel işaretlenmiş harcamalar ve iadeler',
                  ],
                  [
                    'İş',
                    data.scopeTotals.BUSINESS,
                    'İş kapsamında işaretlenmiş harcamalar ve iadeler',
                  ],
                ]}
              />
            </Panel>
          )}
          <p className="page-note">
            Para birimleri ayrı gösterilir. TRY karşılığı yalnızca gerçek ücret veya kur
            girdiğinizde görünür.
          </p>
        </div>
      )}
    </>
  );
}
