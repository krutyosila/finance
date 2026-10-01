import { useState } from 'react';
import { BarChart3, ChartNoAxesCombined } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CURRENCIES, type Currency, type FinancialContext } from '../../shared/types';
import { money, shortDate } from '../format';
import { Empty, Panel, SectionHead } from './ui';

const PALETTE = [
  'var(--teal)',
  'var(--blue)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
];
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid var(--line)',
  backgroundColor: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: '0 8px 30px var(--shadow-color)',
  fontSize: 13,
};
type ChartKind = 'cash' | 'income' | 'daily' | 'debt';
export function TrendChart({
  context,
  initial = 'cash',
  title = 'Paranızın akışı',
  compact = false,
}: {
  context: FinancialContext;
  initial?: ChartKind;
  title?: string;
  compact?: boolean;
}) {
  const [kind, setKind] = useState<ChartKind>(initial);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('TRY');
  const currencies = CURRENCIES.filter((currency) =>
    context.charts.daily.some((point) =>
      [point.cashBalance, point.income, point.expenses, point.debtUsage, point.debtPayments].some(
        (totals) => totals[currency] !== undefined,
      ),
    ),
  );
  const currency = currencies.includes(selectedCurrency)
    ? selectedCurrency
    : currencies[0] || 'TRY';
  // Numbers are only chart coordinates; all balances and accounting come from the local service.
  const rows = context.charts.daily.map((point) => ({
    date: point.date,
    cash: Number(point.cashBalance[currency] || '0'),
    income: Number(point.income[currency] || '0'),
    expense: Number(point.expenses[currency] || '0'),
    usage: Number(point.debtUsage[currency] || '0'),
    paid: Number(point.debtPayments[currency] || '0'),
    cashRaw: point.cashBalance[currency] || '0.00',
    incomeRaw: point.income[currency] || '0.00',
    expenseRaw: point.expenses[currency] || '0.00',
    usageRaw: point.debtUsage[currency] || '0.00',
    paidRaw: point.debtPayments[currency] || '0.00',
  }));
  const tabs: { key: ChartKind; label: string }[] = [
    { key: 'cash', label: 'Nakit bakiyesi' },
    { key: 'income', label: 'Gelir ve harcama' },
    { key: 'daily', label: 'Günlük harcama' },
    { key: 'debt', label: 'Borç hareketleri' },
  ];
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
      <XAxis
        dataKey="date"
        tickFormatter={shortDate}
        tickLine={false}
        axisLine={false}
        tick={{ fontSize: 11, fill: 'var(--muted)' }}
        minTickGap={25}
      />
      <YAxis
        tickFormatter={(value) =>
          new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(
            Number(value),
          )
        }
        width={48}
        tickLine={false}
        axisLine={false}
        tick={{ fontSize: 11, fill: 'var(--muted)' }}
      />
      <Tooltip
        formatter={(_value, name, item) => [
          money(item.payload?.[`${String(item.dataKey)}Raw`], currency),
          String(name),
        ]}
        labelFormatter={(label) => shortDate(String(label))}
        contentStyle={TOOLTIP_STYLE}
        labelStyle={{ color: 'var(--muted)' }}
        itemStyle={{ color: 'var(--text)' }}
        cursor={{ fill: 'var(--hover)', stroke: 'var(--line)' }}
      />
    </>
  );
  return (
    <Panel className="trend-panel">
      <SectionHead
        title={title}
        description="Gerçek hareketler, para birimleri ayrı ayrı."
        action={
          currencies.length > 0 ? (
            <select
              className="small-select"
              aria-label="Grafik para birimi"
              value={currency}
              onChange={(event) => setSelectedCurrency(event.target.value as Currency)}
            >
              {currencies.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          ) : undefined
        }
      />
      {!compact && (
        <div className="chart-tabs" role="group" aria-label="Grafik görünümü">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              aria-pressed={kind === tab.key}
              className={kind === tab.key ? 'active' : ''}
              onClick={() => setKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {!rows.length || !context.transactionCount ? (
        <Empty
          compact
          icon={<ChartNoAxesCombined size={24} />}
          title="Finansal hikâyeniz burada şekillenecek"
          detail="Nakit, harcama ve borcunuzun zaman içindeki değişimini görmek için bir işlem ekleyin."
        />
      ) : (
        <div
          className="chart-canvas"
          role="img"
          aria-label={`Kayıtlarınıza göre ${currency} cinsinden ${tabs.find((tab) => tab.key === kind)?.label}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'cash' ? (
              <AreaChart data={rows} margin={{ top: 12, right: 12, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="cash-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                {axis}
                <Area
                  type="monotone"
                  dataKey="cash"
                  name="Nakit bakiyesi"
                  stroke="var(--teal)"
                  strokeWidth={2.5}
                  fill="url(#cash-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={rows} margin={{ top: 12, right: 12, bottom: 5, left: 0 }}>
                {axis}
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: 12, paddingTop: 18 }}
                  formatter={(value) => <span style={{ color: 'var(--muted)' }}>{value}</span>}
                />
                {kind === 'income' ? (
                  <>
                    <Bar
                      dataKey="income"
                      name="Gelir"
                      fill="var(--teal)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="expense"
                      name="Gerçek harcamalar"
                      fill="var(--blue)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </>
                ) : kind === 'debt' ? (
                  <>
                    <Bar
                      dataKey="usage"
                      name="Yeni borç kullanımı"
                      fill="var(--blue)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="paid"
                      name="Ödenen borç"
                      fill="var(--teal)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <Bar
                    dataKey="expense"
                    name="Gerçek harcamalar"
                    fill="var(--blue)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function CategoryChart({ context }: { context: FinancialContext }) {
  const [selected, setSelected] = useState<Currency>('TRY');
  const currencies = CURRENCIES.filter((currency) =>
    context.categoryTotals.some((category) => Number(category.totals[currency] || 0) > 0),
  );
  const currency = currencies.includes(selected) ? selected : currencies[0] || 'TRY';
  const rows = context.categoryTotals
    .filter((category) => Number(category.totals[currency] || 0) > 0)
    .map((category) => ({
      name: category.category,
      value: Number(category.totals[currency]),
      amount: category.totals[currency]!,
    }));
  return (
    <Panel className="category-panel">
      <SectionHead
        title="Harcama dağılımı"
        description="Kategorilere göre gerçek harcamalar."
        action={
          currencies.length > 0 ? (
            <select
              className="small-select"
              value={currency}
              onChange={(event) => setSelected(event.target.value as Currency)}
              aria-label="Kategori grafiği para birimi"
            >
              {currencies.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          ) : undefined
        }
      />
      {!rows.length ? (
        <Empty
          compact
          icon={<BarChart3 size={24} />}
          title="Büyük resme yer açın"
          detail="Harcama ekledikçe kategorileriniz burada görünür."
        />
      ) : (
        <>
          <div
            className="donut-canvas"
            role="img"
            aria-label={`${currency} cinsinden harcama kategorileri`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={65}
                  outerRadius={90}
                  paddingAngle={3}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {rows.map((row, index) => (
                    <Cell key={row.name} fill={PALETTE[index % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(_value, _name, item) => money(item.payload.amount, currency)}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--muted)' }}
                  itemStyle={{ color: 'var(--text)' }}
                  cursor={{ fill: 'var(--hover)', stroke: 'var(--line)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="category-legend">
            {rows.map((row, index) => (
              <div key={row.name}>
                <span>
                  <i style={{ background: PALETTE[index % PALETTE.length] }} />
                  {row.name}
                </span>
                <strong>{money(row.amount, currency)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
