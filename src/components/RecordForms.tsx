import { useState } from 'react';
import {
  ACCOUNT_TYPES,
  CURRENCIES,
  DEBT_TYPES,
  type Account,
  type Debt,
  type FinancialContext,
  type Obligation,
  type Subscription,
} from '../../shared/types';
import { api } from '../api';
import { findCatalogLabel } from '../../shared/labelNames';
import { accountNames, dateInput, debtNames, frequencyNames } from '../format';
import { ErrorMessage, Field, FormFooter } from './ui';

type RecordKind = 'accounts' | 'debts' | 'recurring' | 'subscriptions';
type Record = Account | Debt | Obligation | Subscription;
export function RecordForm({
  kind,
  record,
  context,
  onClose,
  onSaved,
}: {
  kind: RecordKind;
  record?: Record;
  context: FinancialContext;
  onClose: () => void;
  onSaved: () => void;
}) {
  const account = record as Account | undefined;
  const debt = record as Debt | undefined;
  const schedule = record as Obligation | Subscription | undefined;
  const isAccount = kind === 'accounts';
  const isDebt = kind === 'debts';
  const subscription = kind === 'subscriptions';
  const scheduled = !isAccount && !isDebt;
  const [values, setValues] = useState({
    name:
      (subscription
        ? (record as Subscription | undefined)?.service
        : (record as Account | Debt | Obligation | undefined)?.name) || '',
    type: isAccount || isDebt ? account?.type || (isAccount ? 'BANK' : 'OTHER') : '',
    currency: record?.currency || 'TRY',
    openingBalance: isAccount || isDebt ? account?.openingBalance || '0' : '0',
    creditLimit: isAccount || isDebt ? account?.creditLimit || '' : '',
    owner: isAccount ? account?.owner || '' : '',
    notes: isAccount || isDebt ? account?.notes || '' : '',
    amount: scheduled ? schedule?.amount || '' : '',
    frequency: scheduled ? schedule?.frequency || 'MONTHLY' : 'MONTHLY',
    dueDate: dateInput(
      subscription
        ? (record as Subscription | undefined)?.nextRenewal
        : (record as Obligation | undefined)?.dueDate,
    ),
    accountId: (isDebt ? debt?.accountId : scheduled ? schedule?.accountId : '') || '',
    category: scheduled
      ? findCatalogLabel(context.labels, schedule?.category)?.name || schedule?.category || ''
      : '',
    scope: scheduled ? schedule?.scope || 'PERSONAL' : 'PERSONAL',
    active: scheduled ? (schedule?.active ?? true) : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change =
    (key: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((previous) => ({ ...previous, [key]: event.target.value }));
  const decimal = (value: string) => value.trim().replace(',', '.');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    let payload: unknown;
    if (isAccount)
      payload = {
        name: values.name,
        owner: values.owner,
        type: values.type,
        currency: values.currency,
        openingBalance: decimal(values.openingBalance),
        creditLimit: decimal(values.creditLimit) || null,
        ...(!record && (values.type === 'CREDIT_CARD' || values.type === 'OVERDRAFT')
          ? { currentDebt: decimal(values.openingBalance) }
          : {}),
        notes: values.notes,
      };
    else if (isDebt)
      payload = {
        name: values.name,
        type: values.type,
        currency: values.currency,
        openingBalance: decimal(values.openingBalance),
        creditLimit: decimal(values.creditLimit) || null,
        accountId: values.accountId || null,
        notes: values.notes,
      };
    else
      payload = {
        [subscription ? 'service' : 'name']: values.name,
        amount: decimal(values.amount),
        currency: values.currency,
        frequency: values.frequency,
        [subscription ? 'nextRenewal' : 'dueDate']: values.dueDate,
        accountId: values.accountId || null,
        category: values.category,
        scope: values.scope,
        active: values.active,
      };
    try {
      await api(`/${kind}${record ? `/${record.id}` : ''}`, record ? 'PATCH' : 'POST', payload);
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const liability = isAccount && (values.type === 'CREDIT_CARD' || values.type === 'OVERDRAFT');
  const selectedLabel = findCatalogLabel(context.labels, values.category);
  return (
    <form className="record-form" onSubmit={save}>
      {error && <ErrorMessage message={error} />}
      <div className="form-grid">
        <Field label={subscription ? 'Hizmet adı' : 'Ad'} wide>
          <input
            autoFocus
            value={values.name}
            onChange={change('name')}
            placeholder={
              isAccount ? 'Hesabınıza ad verin' : isDebt ? 'Borcunuza ad verin' : 'Ödeme ne için?'
            }
            required
            maxLength={200}
          />
        </Field>
        {(isAccount || isDebt) && (
          <Field label="Tür">
            <select value={values.type} onChange={change('type')} disabled={isAccount && !!record}>
              {(isAccount ? ACCOUNT_TYPES : DEBT_TYPES).map((type) => (
                <option key={type} value={type}>
                  {isAccount
                    ? accountNames[type as keyof typeof accountNames]
                    : debtNames[type as keyof typeof debtNames]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Para birimi">
          <select value={values.currency} onChange={change('currency')}>
            {CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </Field>
        {(isAccount || isDebt) && (
          <Field
            label={isDebt || liability ? 'Başlangıç borç bakiyesi' : 'Başlangıç bakiyesi'}
            hint="Gerçek başlangıç bakiyenizi girin. Sıfır olabilir."
          >
            <input
              inputMode="decimal"
              value={values.openingBalance}
              onChange={change('openingBalance')}
              required
            />
          </Field>
        )}
        {(isDebt || liability) && (
          <Field
            label="Kredi limiti (isteğe bağlı)"
            hint="Kullanılabilir kredi varlıklara dâhil edilmez."
          >
            <input
              inputMode="decimal"
              value={values.creditLimit}
              onChange={change('creditLimit')}
              placeholder="Yoksa boş bırakın"
            />
          </Field>
        )}
        {isAccount && (
          <Field label="Hesap sahibi">
            <input
              value={values.owner}
              onChange={change('owner')}
              placeholder="Adınız (isteğe bağlı)"
              maxLength={200}
            />
          </Field>
        )}
        {scheduled && (
          <>
            <Field label="Beklenen tutar">
              <input
                inputMode="decimal"
                value={values.amount}
                onChange={change('amount')}
                placeholder="0,00"
                required
              />
            </Field>
            <Field label="Sıklık">
              <select value={values.frequency} onChange={change('frequency')}>
                {Object.entries(frequencyNames).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={subscription ? 'Sonraki yenileme' : 'Vade tarihi'}>
              <input type="date" value={values.dueDate} onChange={change('dueDate')} required />
            </Field>
          </>
        )}
        {(scheduled || isDebt) && (
          <Field label={isDebt ? 'Bağlı kredi hesabı (isteğe bağlı)' : 'Ödeme hesabı'}>
            <select
              value={values.accountId}
              onChange={change('accountId')}
              disabled={isDebt && !!record}
            >
              <option value="">{isDebt ? 'Bağlı hesap yok' : 'Hesapsız nakit'}</option>
              {context.accounts
                .filter(
                  (item) =>
                    !isDebt ||
                    ((item.type === 'CREDIT_CARD' || item.type === 'OVERDRAFT') &&
                      (!context.debts.some((linked) => linked.accountId === item.id) ||
                        debt?.accountId === item.id)),
                )
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · {item.currency}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {scheduled && (
          <>
            <Field label="Etiket">
              <select value={values.category} onChange={change('category')}>
                <option value="">Etiket yok</option>
                {values.category && (!selectedLabel || selectedLabel.archived) && (
                  <option value={values.category}>
                    {values.category}
                    {selectedLabel?.archived ? ' (arşivlenmiş)' : ''}
                  </option>
                )}
                {context.labels
                  ?.filter((label) => !label.archived)
                  .map((label) => (
                    <option key={label.id} value={label.name}>
                      {label.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Kişisel veya iş">
              <select value={values.scope} onChange={change('scope')}>
                <option value="PERSONAL">Kişisel</option>
                <option value="BUSINESS">İş</option>
              </select>
            </Field>
            <Field label="Durum">
              <select
                value={values.active ? 'true' : 'false'}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, active: event.target.value === 'true' }))
                }
              >
                <option value="true">Aktif</option>
                <option value="false">{subscription ? 'İptal edildi' : 'Pasif'}</option>
              </select>
            </Field>
          </>
        )}
        {(isAccount || isDebt) && (
          <Field label="Notlar" wide>
            <textarea
              rows={3}
              value={values.notes}
              onChange={change('notes')}
              placeholder="İsteğe bağlı ayrıntılar"
              maxLength={2000}
            />
          </Field>
        )}
      </div>
      {scheduled && (
        <p className="form-note">
          Bu planlanmış bir ödemedir. Yalnızca ödeme kaydedildiğinde gerçek harcamaya dönüşür.
        </p>
      )}
      {liability && <p className="form-note">Bu hesabın borcu Borçlar sayfasında da görünür.</p>}
      <FormFooter
        onClose={onClose}
        busy={busy}
        label={
          record
            ? 'Değişiklikleri kaydet'
            : `${isAccount ? 'Hesap' : isDebt ? 'Borç' : subscription ? 'Abonelik' : 'Düzenli ödeme'} oluştur`
        }
      />
    </form>
  );
}
