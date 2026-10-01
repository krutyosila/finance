import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import {
  CURRENCIES,
  TRANSACTION_TYPES,
  type FinancialContext,
  type Transaction,
  type TransactionInput,
} from '../../shared/types';
import { api } from '../api';
import { localDateTime, transactionTimestamp, typeNames } from '../format';
import { ErrorMessage, Field, FormFooter } from './ui';
import { LabelSelect } from './LabelSelect';

export function TransactionForm({
  context,
  initial,
  transaction,
  issues = [],
  payPath,
  onClose,
  onSaved,
}: {
  context: FinancialContext;
  initial?: Partial<TransactionInput>;
  transaction?: Transaction;
  issues?: string[];
  payPath?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const seed = transaction || initial || {};
  const [originalInstant] = useState(() => seed.timestamp || new Date().toISOString());
  const [values, setValues] = useState({
    type: seed.type || '',
    amount: seed.amount || '',
    currency: seed.currency || 'TRY',
    timestamp: localDateTime(originalInstant),
    description: seed.description || '',
    labelId: seed.labelId || '',
    accountId: seed.accountId || '',
    destinationAccountId: seed.destinationAccountId || '',
    destinationAmount: seed.destinationAmount || '',
    debtId: seed.debtId || '',
    amountTRY: seed.amountTRY || '',
    exchangeRate: seed.exchangeRate || '',
    notes: seed.notes || '',
    counterparty: seed.counterparty || '',
    paymentMethod: seed.paymentMethod || '',
    scope: seed.scope || 'PERSONAL',
    debtComponent: seed.debtComponent || 'PRINCIPAL',
  });
  const [advanced, setAdvanced] = useState(
    !!(
      seed.notes ||
      seed.counterparty ||
      seed.paymentMethod ||
      seed.amountTRY ||
      seed.exchangeRate
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change =
    (key: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setValues((previous) => ({
        ...previous,
        [key]: value,
        ...(key === 'type'
          ? {
              ...(!['DEBT_PAYMENT', 'DEBT_USAGE', 'EXPENSE', 'REFUND', 'ADJUSTMENT'].includes(value)
                ? { debtId: '' }
                : {}),
              ...(!['TRANSFER', 'SAVINGS'].includes(value)
                ? { destinationAccountId: '', destinationAmount: '' }
                : {}),
            }
          : {}),
      }));
    };
  const selectAccounts = (destination = false) => (
    <>
      <option value="">{destination ? 'Hedef hesabı seçin' : 'Hesapsız nakit'}</option>
      {context.accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {account.currency}
        </option>
      ))}
    </>
  );
  const movement = values.type === 'TRANSFER' || values.type === 'SAVINGS';
  const debt = values.type === 'DEBT_PAYMENT' || values.type === 'DEBT_USAGE';
  const sourceAccount = context.accounts.find((account) => account.id === values.accountId);
  const liabilityAccount =
    sourceAccount?.type === 'CREDIT_CARD' || sourceAccount?.type === 'OVERDRAFT';
  const debtComponentEditable =
    ['EXPENSE', 'ADJUSTMENT'].includes(values.type) && (!!values.debtId || liabilityAccount);
  const foreignDestination =
    context.accounts.find((account) => account.id === values.destinationAccountId)?.currency !==
    values.currency;
  const decimal = (value: string) => value.trim().replace(',', '.');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!values.type) {
      setError('Kaydetmeden önce işlem türünü seçin.');
      return;
    }
    setBusy(true);
    setError('');
    const payload: TransactionInput = {
      type: values.type as TransactionInput['type'],
      amount: decimal(values.amount),
      currency: values.currency as TransactionInput['currency'],
      timestamp: transactionTimestamp(values.timestamp, originalInstant),
      description: values.description.trim(),
      labelId: values.labelId || null,
      scope: values.scope as TransactionInput['scope'],
      accountId: values.accountId || null,
      destinationAccountId: movement ? values.destinationAccountId || null : null,
      destinationAmount: movement ? decimal(values.destinationAmount) || null : null,
      debtId: debt || values.debtId ? values.debtId || null : null,
      debtComponent: debtComponentEditable
        ? (values.debtComponent as TransactionInput['debtComponent'])
        : transaction && values.type === transaction.type
          ? transaction.debtComponent || 'PRINCIPAL'
          : 'PRINCIPAL',
      amountTRY: values.currency === 'TRY' ? null : decimal(values.amountTRY) || null,
      exchangeRate: values.currency === 'TRY' ? null : decimal(values.exchangeRate) || null,
      counterparty: values.counterparty.trim() || null,
      paymentMethod: values.paymentMethod.trim() || null,
      notes: values.notes.trim() || null,
      obligationId: seed.obligationId || null,
      subscriptionId: seed.subscriptionId || null,
    };
    try {
      await api(
        payPath || (transaction ? `/transactions/${transaction.id}` : '/transactions'),
        transaction ? 'PATCH' : 'POST',
        payload,
      );
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="record-form" onSubmit={save}>
      {issues.length > 0 && (
        <div className="notice">
          <Info size={18} />
          <div>
            <strong>Birkaç ayrıntıyı tamamlamanız gerekiyor</strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {error && <ErrorMessage message={error} />}
      <div className="form-grid">
        <Field label="İşlem türü">
          <select
            value={values.type}
            onChange={change('type')}
            required
            autoFocus={!values.type}
            disabled={!!payPath}
          >
            <option value="" disabled>
              Tür seçin
            </option>
            {TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeNames[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tarih ve saat">
          <input
            type="datetime-local"
            value={values.timestamp}
            onChange={change('timestamp')}
            required
          />
        </Field>
        <Field
          label="Tutar"
          hint={
            values.type === 'ADJUSTMENT'
              ? 'Pozitif tutar bakiyeyi artırır; negatif tutar azaltır.'
              : values.type === 'SAVINGS'
                ? '250 biriktirmek için; -250 birikimden çekmek için.'
                : undefined
          }
        >
          <input
            type="text"
            inputMode="decimal"
            value={values.amount}
            onChange={change('amount')}
            placeholder="0,00"
            pattern={
              values.type === 'ADJUSTMENT' || values.type === 'SAVINGS'
                ? '-?[0-9]+([.,][0-9]{1,2})?'
                : '[0-9]+([.,][0-9]{1,2})?'
            }
            required
          />
        </Field>
        <Field label="Para birimi">
          <select value={values.currency} onChange={change('currency')} disabled={!!payPath}>
            {CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </Field>
        <Field label="Açıklama" wide>
          <input
            value={values.description}
            onChange={change('description')}
            placeholder="Bu işlem ne içindi?"
            maxLength={500}
            required
          />
        </Field>
        <Field
          label={movement ? 'Kaynak hesap' : 'Hesap'}
          hint={
            values.type === 'TRANSFER'
              ? 'Paranın çıkacağı hesabı seçin.'
              : 'Hesap oluşturmadan nakit kaydıyla başlayabilirsiniz.'
          }
        >
          <select
            value={values.accountId}
            onChange={change('accountId')}
            required={values.type === 'TRANSFER'}
          >
            {selectAccounts()}
          </select>
        </Field>
        <Field label="Etiket" hint="Her işlem için tek etiket seçebilirsiniz.">
          <LabelSelect
            labels={context.labels}
            value={values.labelId}
            preserveArchived={!!transaction}
            disabled={busy}
            onChange={(labelId) =>
              setValues((previous) => ({ ...previous, labelId: labelId || '' }))
            }
          />
        </Field>
        {movement && (
          <>
            <Field
              label={values.type === 'SAVINGS' ? 'Birikim hesabı (isteğe bağlı)' : 'Hedef hesap'}
              hint={
                values.type === 'SAVINGS'
                  ? 'Birikim hesabı seçin veya hesap oluşturmadan birikim izleyin.'
                  : undefined
              }
            >
              <select
                value={values.destinationAccountId}
                onChange={change('destinationAccountId')}
                required={values.type === 'TRANSFER'}
              >
                <option value="">
                  {values.type === 'SAVINGS' ? 'Hesapsız birikim' : 'Hedef hesabı seçin'}
                </option>
                {context.accounts
                  .filter((account) => values.type !== 'SAVINGS' || account.type === 'SAVINGS')
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
              </select>
            </Field>
            {(values.type === 'TRANSFER' ||
              (!!values.destinationAccountId && foreignDestination)) && (
              <Field
                label="Alınan tutar"
                hint="Farklı para birimleri arasındaki transferlerde gereklidir."
              >
                <input
                  inputMode="decimal"
                  value={values.destinationAmount}
                  onChange={change('destinationAmount')}
                  placeholder="Aynı para biriminde işlem tutarıyla aynı"
                />
              </Field>
            )}
          </>
        )}
        {(debt ||
          (['EXPENSE', 'REFUND', 'ADJUSTMENT'].includes(values.type) &&
            context.debts.length > 0)) && (
          <Field
            label="Borç"
            hint={
              debt && !context.debts.length
                ? 'Önce Borçlar sayfasından bir borç oluşturun.'
                : undefined
            }
          >
            <select value={values.debtId} onChange={change('debtId')} required={debt}>
              <option value="">{debt ? 'Borcu seçin' : 'Bağlı borç yok'}</option>
              {context.debts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </select>
          </Field>
        )}
        {debtComponentEditable && (
          <Field
            label="Borç bileşeni"
            hint={
              values.type === 'EXPENSE'
                ? 'Borçta biriken faiz ve masrafı burada ayrı izleyebilirsiniz.'
                : 'Düzeltmenin hangi borç bileşenine ait olduğunu seçin.'
            }
          >
            <select value={values.debtComponent} onChange={change('debtComponent')}>
              <option value="PRINCIPAL">Anapara</option>
              <option value="INTEREST">Faiz</option>
              <option value="FEE">Masraf</option>
            </select>
          </Field>
        )}
        <Field label="Kişisel veya iş">
          <select value={values.scope} onChange={change('scope')}>
            <option value="PERSONAL">Kişisel</option>
            <option value="BUSINESS">İş</option>
          </select>
        </Field>
      </div>
      {values.type === 'DEBT_PAYMENT' && (
        <p className="form-note">
          <Info size={15} /> Önceden kaydedilmiş borcun ödemesi nakdi ve borcu azaltır; yeni harcama
          oluşturmaz. Kredi kartına borcundan fazla yatırılan tutar kart bakiyesi olur. Faiz ve
          masrafı oluştuğunda harcama olarak ayrıca kaydedin.
        </p>
      )}
      {values.type === 'DEBT_USAGE' && (
        <p className="form-note">
          <Info size={15} /> Yeni borç kullanımı nakdi ve borcun anaparasını artırır. Alışveriş,
          faiz ve masrafları borca bağlı harcama olarak ayrıca kaydedin.
        </p>
      )}
      {debtComponentEditable && values.type === 'ADJUSTMENT' && (
        <p className="form-note">
          <Info size={15} /> Borç düzeltmesi harcama oluşturmaz. Gerçekleşmiş faiz veya masraf
          harcaması için işlem türünü Harcama seçin.
        </p>
      )}
      {movement && (
        <p className="form-note">
          <Info size={15} /> Kendi paranızı hesaplar arasında taşımak gelir veya harcama sayılmaz.
        </p>
      )}
      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced(!advanced)}
      >
        Ek ayrıntılar <ChevronDown size={17} className={advanced ? 'rotate' : ''} />
      </button>
      {advanced && (
        <div className="form-grid advanced-fields">
          {values.currency !== 'TRY' && (
            <>
              <Field
                label="Gerçek TRY tutarı"
                hint="Yalnızca TRY olarak alınan gerçek tutarı biliyorsanız."
              >
                <input
                  inputMode="decimal"
                  value={values.amountTRY}
                  onChange={change('amountTRY')}
                  placeholder="Bilmiyorsanız boş bırakın"
                />
              </Field>
              <Field
                label="TRY dönüşüm kuru"
                hint="Sizin girdiğiniz kur kullanılır; kur varsayılmaz."
              >
                <input
                  inputMode="decimal"
                  value={values.exchangeRate}
                  onChange={change('exchangeRate')}
                  placeholder="Bilmiyorsanız boş bırakın"
                />
              </Field>
            </>
          )}
          <Field label="Karşı taraf">
            <input
              value={values.counterparty}
              onChange={change('counterparty')}
              placeholder="Kişi veya işletme"
              maxLength={200}
            />
          </Field>
          <Field label="Ödeme yöntemi">
            <input
              value={values.paymentMethod}
              onChange={change('paymentMethod')}
              placeholder="Örn. Banka havalesi"
              maxLength={120}
            />
          </Field>
          <Field label="Notlar" wide>
            <textarea
              value={values.notes}
              onChange={change('notes')}
              placeholder="Hatırlamak istediğiniz başka bir ayrıntı"
              rows={3}
              maxLength={2000}
            />
          </Field>
        </div>
      )}
      <FormFooter
        onClose={onClose}
        busy={busy}
        label={transaction ? 'Değişiklikleri kaydet' : payPath ? 'Ödeme kaydet' : 'İşlemi kaydet'}
      />
    </form>
  );
}
