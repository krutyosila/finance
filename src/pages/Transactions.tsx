import { useEffect, useState } from 'react';
import {
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Filter,
  History,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  CURRENCIES,
  TRANSACTION_TYPES,
  type FinancialContext,
  type Transaction,
} from '../../shared/types';
import { useResource } from '../api';
import { date, money, typeNames } from '../format';
import {
  Button,
  Empty,
  ErrorMessage,
  IconButton,
  Loading,
  PageIntro,
  Panel,
  Tag,
} from '../components/ui';

export function Transactions({
  context,
  revision,
  onAdd,
  onEdit,
  onDelete,
  onRestore,
  onDuplicate,
  onHistory,
}: {
  context: FinancialContext;
  revision: number;
  onAdd: () => void;
  onEdit: (record: Transaction) => void;
  onDelete: (record: Transaction) => void;
  onRestore: (record: Transaction) => void;
  onDuplicate: (record: Transaction) => void;
  onHistory: (record: Transaction) => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    type: '',
    currency: '',
    category: '',
    accountId: '',
    from: '',
    to: '',
    scope: '',
    deleted: false,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams();
  if (query) params.set('search', query);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  const {
    data: records,
    loading,
    error,
    refresh,
  } = useResource<Transaction[]>(`/transactions?${params}`, revision);
  const change =
    (key: keyof typeof filters) =>
    (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
      setFilters((previous) => ({ ...previous, [key]: event.target.value }));
  const accountName = (id: string | null) =>
    context.accounts.find((account) => account.id === id)?.name || 'Hesapsız nakit';
  const hasFilters = Object.values(filters).some((value) => !!value) || !!search;
  return (
    <>
      <PageIntro
        eyebrow="GÜNLÜK AYRINTILAR"
        title="İşlemler"
        description="Giren, çıkan ve hesaplar arasında hareket eden paranın tüm kaydı."
        action={
          <Button onClick={onAdd}>
            <Plus size={17} />
            İşlem ekle
          </Button>
        }
      />
      <Panel className="transaction-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="İşlemlerde ara"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Açıklama, kategori veya notlarda ara…"
            />
            {search && (
              <IconButton label="Aramayı temizle" onClick={() => setSearch('')}>
                <X size={15} />
              </IconButton>
            )}
          </div>
          <div className="toolbar-actions">
            <button
              className={`filter-button ${filtersOpen ? 'active' : ''}`}
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={16} />
              Filtreler{hasFilters && <i />}
            </button>
            <label className="trash-toggle">
              <input
                type="checkbox"
                checked={filters.deleted}
                onChange={(event) =>
                  setFilters((previous) => ({ ...previous, deleted: event.target.checked }))
                }
              />
              Yalnızca silinenler
            </label>
          </div>
        </div>
        {filtersOpen && (
          <div className="filter-grid">
            <label>
              Tür
              <select value={filters.type} onChange={change('type')}>
                <option value="">Tüm türler</option>
                {TRANSACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {typeNames[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Para birimi
              <select value={filters.currency} onChange={change('currency')}>
                <option value="">Tüm para birimleri</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label>
              Hesap
              <select value={filters.accountId} onChange={change('accountId')}>
                <option value="">Tüm hesaplar</option>
                {context.accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kategori
              <input
                value={filters.category}
                onChange={change('category')}
                placeholder="Tüm kategoriler"
              />
            </label>
            <label>
              Başlangıç
              <input type="date" value={filters.from} onChange={change('from')} />
            </label>
            <label>
              Bitiş
              <input type="date" value={filters.to} onChange={change('to')} />
            </label>
            <label>
              Kapsam
              <select value={filters.scope} onChange={change('scope')}>
                <option value="">Kişisel ve iş</option>
                <option value="PERSONAL">Kişisel</option>
                <option value="BUSINESS">İş</option>
              </select>
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({
                  type: '',
                  currency: '',
                  category: '',
                  accountId: '',
                  from: '',
                  to: '',
                  scope: '',
                  deleted: false,
                });
                setSearch('');
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        )}
        {error ? (
          <ErrorMessage message={error} retry={refresh} />
        ) : loading && !records ? (
          <Loading />
        ) : !records?.length ? (
          <Empty
            icon={hasFilters ? <Filter size={27} /> : <ReceiptIcon />}
            title={
              filters.deleted
                ? 'Silinen işlem yok'
                : hasFilters
                  ? 'Bu filtrelere uygun işlem bulunamadı'
                  : 'Net bir görünüm, tek bir kayıtla başlar'
            }
            detail={
              hasFilters
                ? 'Başka bir arama deneyin veya filtreleri temizleyin.'
                : 'Gelir, harcama, transfer veya borç hareketi kaydedin. Her işlem kendi türünde izlenir.'
            }
            action={
              !hasFilters ? (
                <Button variant="secondary" onClick={onAdd}>
                  <Plus size={16} />
                  İlk işleminizi ekleyin
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-scroll" aria-busy={loading}>
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th>Açıklama</th>
                    <th>Tür</th>
                    <th>Hesap</th>
                    <th>Tarih</th>
                    <th className="align-right">Tutar</th>
                    <th>
                      <span className="sr-only">İşlemler</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((transaction) => (
                    <tr key={transaction.id} className={transaction.deletedAt ? 'deleted-row' : ''}>
                      <td>
                        <button
                          className="table-description"
                          onClick={() =>
                            transaction.deletedAt ? onHistory(transaction) : onEdit(transaction)
                          }
                        >
                          <span className={`activity-icon type-${transaction.type}`}>
                            {transaction.type === 'INCOME' || transaction.type === 'REFUND' ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </span>
                          <span>
                            <strong>{transaction.description}</strong>
                            <small>
                              {transaction.category || 'Kategorisiz'}
                              {transaction.scope === 'BUSINESS' ? ' · İş' : ''}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <Tag
                          tone={
                            transaction.type === 'INCOME' || transaction.type === 'REFUND'
                              ? 'teal'
                              : transaction.type === 'DEBT_PAYMENT' ||
                                  transaction.type === 'DEBT_USAGE'
                                ? 'blue'
                                : ''
                          }
                        >
                          {typeNames[transaction.type]}
                        </Tag>
                      </td>
                      <td>
                        <span className="account-cell">{accountName(transaction.accountId)}</span>
                        {transaction.destinationAccountId && (
                          <small className="destination-cell">
                            → {accountName(transaction.destinationAccountId)}
                          </small>
                        )}
                      </td>
                      <td className="date-cell">{date(transaction.timestamp)}</td>
                      <td className="align-right">
                        <strong className="table-amount">
                          {money(transaction.amount, transaction.currency)}
                        </strong>
                        {transaction.currency !== 'TRY' && (
                          <small className="destination-cell">
                            {transaction.amountTRY
                              ? `${money(transaction.amountTRY)} gerçek tutar`
                              : transaction.exchangeRate
                                ? `Kur ${transaction.exchangeRate} TRY`
                                : 'TRY karşılığı girilmedi'}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <IconButton
                            label="İşlem geçmişini gör"
                            onClick={() => onHistory(transaction)}
                          >
                            <History size={16} />
                          </IconButton>
                          {transaction.deletedAt ? (
                            <IconButton
                              label="İşlemi geri yükle"
                              onClick={() => onRestore(transaction)}
                            >
                              <ArchiveRestore size={16} />
                            </IconButton>
                          ) : (
                            <>
                              <IconButton
                                label="İşlemi çoğalt"
                                onClick={() => onDuplicate(transaction)}
                              >
                                <Copy size={15} />
                              </IconButton>
                              <IconButton label="İşlemi sil" onClick={() => onDelete(transaction)}>
                                <Trash2 size={15} />
                              </IconButton>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              {records.length} {records.length === 1 ? 'işlem' : 'işlem'}
              {loading ? ' · Güncelleniyor…' : ''}
              <span>Tüm tutarlar kendi para biriminde saklanır.</span>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
function ReceiptIcon() {
  return <History size={27} />;
}
