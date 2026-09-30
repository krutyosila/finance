import { randomUUID } from 'node:crypto';
import { eq, isNull, asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { openDatabase } from './database';
import * as schema from './schema';
import { minor, decimal, add, converted } from './money';
import { parseEntry } from './parser';
import { CURRENCIES, TRANSACTION_TYPES, ACCOUNT_TYPES, DEBT_TYPES } from '../../shared/types';
import type {
  Account,
  AccountInput,
  Debt,
  DebtInput,
  Transaction,
  TransactionInput,
  TransactionFilter,
  Obligation,
  ObligationInput,
  Subscription,
  SubscriptionInput,
  Cycle,
  FinancialContext,
  MoneyTotals,
  Metrics,
  AuditEntry,
  ParseResult,
  EntryResult,
  Currency,
} from '../../shared/types';
const currency = z.enum(CURRENCIES),
  nullable = z.string().nullable().optional();
const name = z.string().trim().min(1).max(500),
  scope = z.enum(['PERSONAL', 'BUSINESS']);
const transactionValidator = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: z.string(),
  currency,
  timestamp: z.string().optional(),
  amountTRY: nullable,
  exchangeRate: nullable,
  category: z.string().max(100).optional(),
  description: name,
  accountId: nullable,
  destinationAccountId: nullable,
  destinationAmount: nullable,
  debtId: nullable,
  counterparty: nullable,
  paymentMethod: nullable,
  notes: nullable,
  scope: scope.optional(),
  debtComponent: z.enum(['PRINCIPAL', 'INTEREST', 'FEE']).optional(),
  obligationId: nullable,
  subscriptionId: nullable,
});
const accountValidator = z.object({
  name,
  owner: z.string().optional(),
  type: z.enum(ACCOUNT_TYPES),
  currency,
  openingBalance: z.string().optional(),
  creditLimit: nullable,
  currentDebt: nullable,
  notes: z.string().optional(),
});
export function validateAccountInput(input: unknown) {
  const p = accountValidator.parse(input),
    isLiability = p.type === 'CREDIT_CARD' || p.type === 'OVERDRAFT',
    opening = minor(p.openingBalance ?? '0', !isLiability),
    debtOpening = p.currentDebt == null ? opening : minor(p.currentDebt),
    creditLimit = p.creditLimit == null ? null : minor(p.creditLimit);
  if (!isLiability && p.currentDebt != null && debtOpening !== 0)
    throw new Error('Güncel borç yalnızca kredi kartı ve KMH hesaplarında kullanılabilir');
  return { p, isLiability, opening, debtOpening, creditLimit };
}
const debtValidator = z.object({
  name,
  type: z.enum(DEBT_TYPES),
  currency,
  openingBalance: z.string().optional(),
  creditLimit: nullable,
  accountId: nullable,
  notes: z.string().optional(),
});
const frequency = z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
const obligationValidator = z.object({
  name,
  amount: z.string(),
  currency,
  frequency,
  dueDate: z.string(),
  category: z.string().optional(),
  accountId: nullable,
  active: z.boolean().optional(),
  scope: scope.optional(),
});
const subscriptionValidator = z.object({
  service: name,
  amount: z.string(),
  currency,
  frequency,
  nextRenewal: z.string(),
  category: z.string().optional(),
  accountId: nullable,
  active: z.boolean().optional(),
  scope: scope.optional(),
});
const now = () => new Date().toISOString();
function instant(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  )
    throw new Error('Geçerli bir tarih veya saat dilimi içeren tarih ve saat girin');
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error('Geçersiz takvim tarihi');
  const d = new Date(value);
  if (
    !Number.isFinite(d.getTime()) ||
    (d.toISOString().slice(0, 10) !== value.slice(0, 10) && value.length === 10)
  )
    throw new Error('Geçersiz tarih');
  return d.toISOString();
}
function day(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || instant(value).slice(0, 10) !== value)
    throw new Error('Geçerli bir tarih girin (YYYY-AA-GG)');
  return value;
}
const liability = (a: schema.AccountRow | undefined) =>
  a?.type === 'CREDIT_CARD' || a?.type === 'OVERDRAFT';
type Totals = Partial<Record<Currency, number>>;
const total = (map: Totals, c: Currency, n: number) => {
  map[c] = add(map[c] ?? 0, n);
};
function money(map: Totals): MoneyTotals {
  return Object.fromEntries(Object.entries(map).map(([c, n]) => [c, decimal(n!)]));
}
const metricKeys = [
  'availableCash',
  'income',
  'expenses',
  'cashOutflow',
  'debt',
  'debtPayments',
  'debtUsage',
  'savings',
  'savingsAdded',
  'netCashFlow',
  'assets',
  'netFinancialPosition',
] as const;
type SourceRows = {
  accounts: schema.AccountRow[];
  debts: schema.DebtRow[];
  transactions: schema.TransactionRow[];
  obligations: schema.ObligationRow[];
  subscriptions: schema.SubscriptionRow[];
};
type Replay = {
  metrics: Record<(typeof metricKeys)[number], Totals>;
  unassigned: Totals;
  virtualSavings: Totals;
  accounts: Map<string, number>;
  debts: Map<
    string,
    { balance: number; payments: number; newUsage: number; interest: number; fees: number }
  >;
  categories: Map<string, Totals>;
  scope: { PERSONAL: Totals; BUSINESS: Totals };
};
export class FinanceService {
  readonly databasePath: string;
  readonly sqlite: ReturnType<typeof openDatabase>['sqlite'];
  private db: ReturnType<typeof openDatabase>['db'];
  constructor(databasePath?: string) {
    const opened = openDatabase(databasePath);
    this.databasePath = opened.databasePath;
    this.sqlite = opened.sqlite;
    this.db = opened.db;
  }
  close() {
    this.sqlite.close();
  }
  private rows(): SourceRows {
    return {
      obligations: this.db.select().from(schema.obligations).all(),
      subscriptions: this.db.select().from(schema.subscriptions).all(),
      accounts: this.db
        .select()
        .from(schema.accounts)
        .where(isNull(schema.accounts.deletedAt))
        .all(),
      debts: this.db.select().from(schema.debts).where(isNull(schema.debts.deletedAt)).all(),
      transactions: this.db
        .select()
        .from(schema.transactions)
        .where(isNull(schema.transactions.deletedAt))
        .orderBy(asc(schema.transactions.timestamp), sql`transactions.rowid`)
        .all(),
    };
  }
  private audit(entity: string, entityId: string, action: string, before: unknown, after: unknown) {
    this.db
      .insert(schema.audit)
      .values({
        id: randomUUID(),
        entity,
        entityId,
        action,
        before: before == null ? null : JSON.stringify(before),
        after: after == null ? null : JSON.stringify(after),
        timestamp: now(),
      })
      .run();
  }
  private atomic<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }
  private replay(
    transactions?: schema.TransactionRow[],
    flows?: schema.TransactionRow[],
    source?: SourceRows,
    onTransaction?: (transaction: schema.TransactionRow, state: Replay) => void,
  ): Replay {
    const rows = source ?? this.rows();
    const txs = transactions ?? rows.transactions;
    const selected = new Set((flows ?? txs).map((t) => t.id));
    const r: Replay = {
      metrics: Object.fromEntries(metricKeys.map((k) => [k, {}])) as Replay['metrics'],
      unassigned: {},
      virtualSavings: {},
      accounts: new Map(),
      debts: new Map(),
      categories: new Map(),
      scope: { PERSONAL: {}, BUSINESS: {} },
    };
    const accounts = new Map(rows.accounts.map((a) => [a.id, a])),
      debts = new Map(rows.debts.map((d) => [d.id, d]));
    for (const a of rows.accounts)
      if (!liability(a)) {
        if (a.type === 'SAVINGS' && a.openingMinor < 0)
          throw new Error('Birikim açılış bakiyesi negatif olamaz');
        r.accounts.set(a.id, a.openingMinor);
      }
    for (const d of rows.debts)
      r.debts.set(d.id, {
        balance: d.openingMinor,
        payments: 0,
        newUsage: 0,
        interest: 0,
        fees: 0,
      });
    const affectCash = (t: schema.TransactionRow, n: number, account?: schema.AccountRow) => {
      if (account && !liability(account)) {
        const next = add(r.accounts.get(account.id) ?? 0, n);
        if (account.type === 'SAVINGS' && next < 0)
          throw new Error('Çekilen tutar birikim hesabının bakiyesini aşıyor');
        r.accounts.set(account.id, next);
      } else total(r.unassigned, t.currency as Currency, n);
    };
    for (const t of txs) {
      this.validateReferences(t, rows);
      const c = t.currency as Currency,
        amount = t.amountMinor,
        a = t.accountId ? accounts.get(t.accountId) : undefined;
      const settledCurrency = (a?.currency ?? c) as Currency,
        settledAmount = a && a.currency !== c ? t.amountTRYMinor! : amount;
      const linked = t.debtId
        ? debts.get(t.debtId)
        : liability(a)
          ? rows.debts.find((d) => d.accountId === a!.id)
          : undefined;
      const debt = linked ? r.debts.get(linked.id) : undefined;
      const counted = selected.has(t.id);
      let cashDelta = 0,
        cashDeltaCurrency = settledCurrency,
        expense = 0;
      const increaseDebt = (delta: number, component: string = 'PRINCIPAL') => {
        if (!debt) throw new Error('Mevcut bir borç seçin');
        debt.balance = add(debt.balance, delta);
        if (debt.balance < 0)
          throw new Error('Ödeme veya iade, işlemin tarihinde kalan borcu aşıyor');
        if (delta > 0) {
          const key =
            component === 'INTEREST' ? 'interest' : component === 'FEE' ? 'fees' : 'newUsage';
          debt[key] = add(debt[key], delta);
        } else if (t.type === 'DEBT_PAYMENT') debt.payments = add(debt.payments, -delta);
      };
      if (t.type === 'INCOME') {
        affectCash(t, amount, a);
        if (a?.type !== 'SAVINGS') cashDelta = amount;
        if (counted) total(r.metrics.income, c, amount);
      } else if (t.type === 'EXPENSE') {
        expense = amount;
        if (debt) {
          increaseDebt(settledAmount, t.debtComponent);
          if (counted && t.debtComponent === 'PRINCIPAL')
            total(r.metrics.debtUsage, linked!.currency as Currency, settledAmount);
        } else {
          affectCash(t, -settledAmount, a);
          if (a?.type !== 'SAVINGS') cashDelta = -settledAmount;
          if (counted) total(r.metrics.cashOutflow, settledCurrency, settledAmount);
        }
      } else if (t.type === 'REFUND') {
        expense = -amount;
        if (debt) increaseDebt(-settledAmount);
        else {
          affectCash(t, settledAmount, a);
          if (a?.type !== 'SAVINGS') cashDelta = settledAmount;
        }
      } else if (t.type === 'DEBT_USAGE') {
        increaseDebt(amount, t.debtComponent);
        affectCash(t, amount, a);
        if (a?.type !== 'SAVINGS') cashDelta = amount;
        if (counted) total(r.metrics.debtUsage, c, amount);
      } else if (t.type === 'DEBT_PAYMENT') {
        increaseDebt(-amount);
        affectCash(t, -amount, a);
        if (a?.type !== 'SAVINGS') cashDelta = -amount;
        if (counted) {
          total(r.metrics.debtPayments, c, amount);
          total(r.metrics.cashOutflow, c, amount);
        }
      } else if (t.type === 'ADJUSTMENT') {
        if (debt) increaseDebt(amount, t.debtComponent);
        else {
          affectCash(t, amount, a);
          if (a?.type !== 'SAVINGS') cashDelta = amount;
        }
      } else if (t.type === 'TRANSFER' || t.type === 'SAVINGS') {
        affectCash(t, -amount, a);
        const destination = t.destinationAccountId
          ? accounts.get(t.destinationAccountId)
          : undefined;
        if (destination) {
          const next = add(r.accounts.get(destination.id) ?? 0, t.destinationMinor ?? amount);
          if (destination.type === 'SAVINGS' && next < 0)
            throw new Error('Çekilen tutar birikim hesabının bakiyesini aşıyor');
          r.accounts.set(destination.id, next);
        } else {
          total(r.virtualSavings, c, amount);
          if ((r.virtualSavings[c] ?? 0) < 0)
            throw new Error('Çekilen tutar hesapsız birikim bakiyesini aşıyor');
        }
        if (counted) {
          const sourceSaved = a?.type === 'SAVINGS',
            destSaved = destination?.type === 'SAVINGS' || !destination;
          if (!sourceSaved && destSaved) {
            total(
              r.metrics.savingsAdded,
              (destination?.currency as Currency) ?? c,
              t.destinationMinor ?? amount,
            );
            cashDelta = -amount;
          } else if (sourceSaved && !destSaved) {
            total(r.metrics.savingsAdded, c, -amount);
            cashDelta = t.destinationMinor ?? amount;
            cashDeltaCurrency = destination!.currency as Currency;
          }
        }
      }
      if (counted && cashDelta !== 0) total(r.metrics.netCashFlow, cashDeltaCurrency, cashDelta);
      if (counted && expense !== 0) {
        total(r.metrics.expenses, c, expense);
        const cat = r.categories.get(t.category) ?? {};
        total(cat, c, expense);
        r.categories.set(t.category, cat);
        total(r.scope[t.scope as 'PERSONAL' | 'BUSINESS'], c, expense);
      }
      // Validate running asset sums, as well as individual stored balances.
      const running: Totals = { ...r.unassigned };
      for (const a of rows.accounts)
        if (!liability(a)) total(running, a.currency as Currency, r.accounts.get(a.id) ?? 0);
      for (const [c, n] of Object.entries(r.virtualSavings)) total(running, c as Currency, n!);
      onTransaction?.(t, r);
    }
    r.metrics.availableCash = { ...r.unassigned };
    r.metrics.savings = { ...r.virtualSavings };
    r.metrics.assets = { ...r.unassigned };
    for (const a of rows.accounts)
      if (!liability(a)) {
        const balance = r.accounts.get(a.id) ?? 0;
        total(r.metrics.assets, a.currency as Currency, balance);
        total(
          a.type === 'SAVINGS' ? r.metrics.savings : r.metrics.availableCash,
          a.currency as Currency,
          balance,
        );
      }
    for (const [c, n] of Object.entries(r.virtualSavings))
      total(r.metrics.assets, c as Currency, n!);
    for (const d of rows.debts)
      total(r.metrics.debt, d.currency as Currency, r.debts.get(d.id)!.balance);
    r.metrics.netFinancialPosition = { ...r.metrics.assets };
    for (const [c, n] of Object.entries(r.metrics.debt))
      total(r.metrics.netFinancialPosition, c as Currency, -n!);
    return r;
  }
  private validateReferences(t: schema.TransactionRow, source?: SourceRows) {
    const records = source ?? this.rows(),
      a = t.accountId ? records.accounts.find((a) => a.id === t.accountId) : undefined,
      dst = t.destinationAccountId
        ? records.accounts.find((a) => a.id === t.destinationAccountId)
        : undefined,
      d = t.debtId ? records.debts.find((d) => d.id === t.debtId) : undefined;
    if (t.accountId && (!a || a.deletedAt)) throw new Error('Hesap bulunamadı');
    if (t.destinationAccountId && (!dst || dst.deletedAt))
      throw new Error('Hedef hesap bulunamadı');
    if (t.debtId && (!d || d.deletedAt)) throw new Error('Borç bulunamadı');
    const explicitTRYSettlement =
      a?.currency === 'TRY' &&
      t.currency !== 'TRY' &&
      t.amountTRYMinor != null &&
      t.amountTRYMinor > 0 &&
      ['EXPENSE', 'REFUND'].includes(t.type);
    if (a && a.currency !== t.currency && !explicitTRYSettlement)
      throw new Error(
        'Kaynak hesabın para birimi işlemle aynı olmalı veya TRY hesabı için gerçek TL tutarı girilmelidir',
      );
    if (
      d &&
      d.currency !== t.currency &&
      !(explicitTRYSettlement && liability(a) && d.accountId === a!.id)
    )
      throw new Error('Borcun para birimi işlemle aynı olmalıdır');
    if (liability(a)) {
      const linked = records.debts.find((x) => x.accountId === a!.id);
      if (!linked) throw new Error('Kredi kartı veya KMH hesabının bağlı borcu bulunamadı');
      if (d && d.id !== linked.id)
        throw new Error('Seçilen borç kredi kartı veya KMH hesabıyla eşleşmiyor');
      if (['INCOME', 'TRANSFER', 'SAVINGS', 'DEBT_PAYMENT', 'DEBT_USAGE'].includes(t.type))
        throw new Error('Bu işlem için banka, nakit, cüzdan veya birikim hesabı seçin');
    }
    if (t.type === 'DEBT_PAYMENT' || t.type === 'DEBT_USAGE') {
      if (!d && !liability(a)) throw new Error('Mevcut bir borç seçin');
    } else if (d && !['EXPENSE', 'REFUND', 'ADJUSTMENT'].includes(t.type))
      throw new Error('Bu işlem türüne borç bağlanamaz');
    if ((t.type === 'EXPENSE' || t.type === 'REFUND') && d && a && !liability(a))
      throw new Error(
        'Borçtan karşılanan harcama veya iade aynı işlemde nakit hesabını değiştiremez',
      );
    if (t.type === 'TRANSFER' || t.type === 'SAVINGS') {
      if (t.type === 'TRANSFER' && (!a || !dst))
        throw new Error('Transfer için kaynak ve hedef hesapları seçin');
      if (dst && liability(dst))
        throw new Error('Hedef olarak banka, nakit, cüzdan veya birikim hesabı seçin');
      if (a && dst && a.id === dst.id) throw new Error('Kaynak ve hedef hesaplar farklı olmalıdır');
      if (
        t.type === 'SAVINGS' &&
        t.destinationMinor != null &&
        t.destinationMinor < 0 !== t.amountMinor < 0
      )
        throw new Error('Birikim işleminde kaynak ve hedef tutarlarının işareti aynı olmalıdır');
      if (t.type === 'SAVINGS' && dst?.type !== 'SAVINGS' && dst)
        throw new Error('Birikim hedefi bir birikim hesabı olmalıdır');
      if (dst && dst.currency !== t.currency && t.destinationMinor == null)
        throw new Error(
          'Farklı para birimleri arasında transfer için hedef hesaba geçen tutarı girin',
        );
      if (
        dst &&
        dst.currency === t.currency &&
        t.destinationMinor != null &&
        t.destinationMinor !== t.amountMinor
      )
        throw new Error('Aynı para birimindeki transfer tutarları eşit olmalıdır');
    } else if (t.destinationAccountId || t.destinationMinor != null)
      throw new Error('Hedef hesap yalnızca transfer ve birikim işlemlerinde kullanılabilir');
    if (t.destinationMinor != null && !t.destinationAccountId)
      throw new Error('Alınan tutar için bir hedef hesap seçin');
    if (t.obligationId && t.subscriptionId)
      throw new Error('İşlem yalnızca bir düzenli ödeme veya aboneliğe bağlanabilir');
    if (t.obligationId || t.subscriptionId) {
      if (t.type !== 'EXPENSE')
        throw new Error('Düzenli ödeme ve abonelik ödemeleri gider türünde olmalıdır');
      const plan = t.obligationId
        ? records.obligations.find((p) => p.id === t.obligationId)
        : records.subscriptions.find((p) => p.id === t.subscriptionId);
      if (!plan) throw new Error('Düzenli ödeme veya abonelik bulunamadı');
    }
  }
  private transaction(row: schema.TransactionRow): Transaction {
    return {
      id: row.id,
      timestamp: row.timestamp,
      type: row.type as Transaction['type'],
      amount: decimal(row.amountMinor),
      amountMinor: row.amountMinor,
      currency: row.currency as Currency,
      amountTRY: row.amountTRYMinor == null ? null : decimal(row.amountTRYMinor),
      exchangeRate: row.exchangeRate,
      category: row.category,
      description: row.description,
      accountId: row.accountId,
      destinationAccountId: row.destinationAccountId,
      destinationAmount: row.destinationMinor == null ? null : decimal(row.destinationMinor),
      debtId: row.debtId,
      counterparty: row.counterparty,
      paymentMethod: row.paymentMethod,
      notes: row.notes,
      scope: row.scope as Transaction['scope'],
      debtComponent: row.debtComponent as Transaction['debtComponent'],
      obligationId: row.obligationId,
      subscriptionId: row.subscriptionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
  private normalizeTransaction(
    input: TransactionInput,
    previous?: schema.TransactionRow,
  ): schema.TransactionRow {
    const p = transactionValidator.parse(input),
      amount = minor(p.amount, p.type === 'ADJUSTMENT' || p.type === 'SAVINGS');
    if (p.type !== 'ADJUSTMENT' && (p.type === 'SAVINGS' ? amount === 0 : amount <= 0))
      throw new Error('Tutar sıfırdan büyük olmalıdır');
    const obligation = p.obligationId
      ? this.db
          .select()
          .from(schema.obligations)
          .where(eq(schema.obligations.id, p.obligationId))
          .get()
      : undefined;
    const subscription = p.subscriptionId
      ? this.db
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.id, p.subscriptionId))
          .get()
      : undefined;
    if (
      (p.obligationId &&
        (!obligation || obligation.deletedAt) &&
        previous?.obligationId !== p.obligationId) ||
      (p.subscriptionId &&
        (!subscription || subscription.deletedAt) &&
        previous?.subscriptionId !== p.subscriptionId)
    )
      throw new Error('Etkin düzenli ödeme veya abonelik bulunamadı');
    const linkedPlan = obligation ?? subscription;
    if (
      linkedPlan &&
      (!previous ||
        (p.obligationId && previous.obligationId !== p.obligationId) ||
        (p.subscriptionId && previous.subscriptionId !== p.subscriptionId)) &&
      linkedPlan.currency !== p.currency
    )
      throw new Error('Ödemenin para birimi düzenli kayıtla aynı olmalıdır');
    const row: schema.TransactionRow = {
      id: previous?.id ?? randomUUID(),
      timestamp: this.normalizeTransactionTimestamp(p.timestamp),
      type: p.type,
      amountMinor: amount,
      currency: p.currency,
      amountTRYMinor:
        p.amountTRY != null
          ? minor(p.amountTRY, p.type === 'ADJUSTMENT')
          : p.exchangeRate != null
            ? converted(amount, p.exchangeRate)
            : null,
      exchangeRate: p.exchangeRate ?? null,
      category:
        p.category?.trim() ||
        {
          INCOME: 'Gelir',
          EXPENSE: 'Diğer',
          DEBT_PAYMENT: 'Borç ödemesi',
          DEBT_USAGE: 'Borç kullanımı',
          TRANSFER: 'Transfer',
          SAVINGS: 'Birikim',
          REFUND: 'Diğer',
          ADJUSTMENT: 'Düzeltme',
        }[p.type],
      description: p.description,
      accountId: p.accountId ?? null,
      destinationAccountId: p.destinationAccountId ?? null,
      destinationMinor:
        p.destinationAmount != null ? minor(p.destinationAmount, p.type === 'SAVINGS') : null,
      debtId: p.debtId ?? null,
      counterparty: p.counterparty ?? null,
      paymentMethod: p.paymentMethod ?? null,
      notes: p.notes ?? null,
      scope: p.scope ?? 'PERSONAL',
      debtComponent: p.debtComponent ?? 'PRINCIPAL',
      obligationId: p.obligationId ?? null,
      subscriptionId: p.subscriptionId ?? null,
      obligationOccurrence:
        previous && previous.obligationId === p.obligationId
          ? previous.obligationOccurrence
          : (obligation?.dueDate ?? null),
      subscriptionOccurrence:
        previous && previous.subscriptionId === p.subscriptionId
          ? previous.subscriptionOccurrence
          : (subscription?.nextRenewal ?? null),
      createdAt: previous?.createdAt ?? now(),
      updatedAt: now(),
      deletedAt: previous?.deletedAt ?? null,
    };
    if (row.exchangeRate != null) converted(amount, row.exchangeRate);
    if (
      row.destinationMinor != null &&
      (row.type === 'SAVINGS' ? row.destinationMinor === 0 : row.destinationMinor <= 0)
    )
      throw new Error(
        'Hedef hesaba geçen tutar pozitif olmalıdır; birikim çekiminde negatif tutar kullanın',
      );
    this.validateReferences(row);
    return row;
  }
  listTransactions(filter: TransactionFilter = {}): Transaction[] {
    let rows = this.db
      .select()
      .from(schema.transactions)
      .all()
      .filter((t) => (filter.deleted ? !!t.deletedAt : !t.deletedAt));
    const from = filter.from ? this.bound(filter.from) : null,
      to = filter.to ? this.bound(filter.to, true) : null;
    rows = rows.filter(
      (t) =>
        (!filter.type || t.type === filter.type) &&
        (!filter.currency || t.currency === filter.currency) &&
        (!filter.category || t.category === filter.category) &&
        (!filter.accountId ||
          t.accountId === filter.accountId ||
          t.destinationAccountId === filter.accountId) &&
        (!filter.scope || t.scope === filter.scope) &&
        (!from || t.timestamp >= from) &&
        (!to || t.timestamp <= to) &&
        (!filter.search ||
          [t.description, t.category, t.notes ?? '', t.counterparty ?? '']
            .join(' ')
            .toLocaleLowerCase('tr')
            .includes(filter.search.toLocaleLowerCase('tr'))),
    );
    return rows
      .sort(
        (a, b) => b.timestamp.localeCompare(a.timestamp) || b.createdAt.localeCompare(a.createdAt),
      )
      .map((t) => this.transaction(t));
  }
  getTransaction(id: string): Transaction {
    const row = this.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id))
      .get();
    if (!row) throw new Error('İşlem bulunamadı');
    return this.transaction(row);
  }
  createTransaction(input: TransactionInput): Transaction {
    return this.atomic(() => {
      const row = this.normalizeTransaction(input);
      this.db.insert(schema.transactions).values(row).run();
      this.replay();
      const result = this.transaction(row);
      this.audit('TRANSACTION', row.id, 'CREATE', null, result);
      return result;
    });
  }
  updateTransaction(id: string, input: Partial<TransactionInput>): Transaction {
    return this.atomic(() => {
      const old = this.db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.id, id))
        .get();
      if (!old || old.deletedAt) throw new Error('Etkin işlem bulunamadı');
      const merged: TransactionInput = { ...this.transaction(old), ...input };
      if (
        input.amountTRY === undefined &&
        (input.amount !== undefined || input.exchangeRate !== undefined) &&
        merged.exchangeRate != null
      )
        merged.amountTRY = null;
      const row = this.normalizeTransaction(merged, old);
      this.db.update(schema.transactions).set(row).where(eq(schema.transactions.id, id)).run();
      this.replay();
      const result = this.transaction(row);
      this.audit('TRANSACTION', id, 'EDIT', this.transaction(old), result);
      return result;
    });
  }
  deleteTransaction(id: string) {
    return this.atomic(() => {
      const old = this.getTransaction(id);
      if (old.deletedAt) throw new Error('İşlem zaten silinmiş');
      this.db
        .update(schema.transactions)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(schema.transactions.id, id))
        .run();
      this.replay();
      this.audit('TRANSACTION', id, 'DELETE', old, this.getTransaction(id));
    });
  }
  restoreTransaction(id: string): Transaction {
    return this.atomic(() => {
      const old = this.getTransaction(id);
      if (!old.deletedAt) throw new Error('İşlem zaten etkin');
      this.db
        .update(schema.transactions)
        .set({ deletedAt: null, updatedAt: now() })
        .where(eq(schema.transactions.id, id))
        .run();
      this.replay();
      const result = this.getTransaction(id);
      this.audit('TRANSACTION', id, 'RESTORE', old, result);
      return result;
    });
  }
  duplicateTransaction(id: string): Transaction {
    const t = this.getTransaction(id);
    return this.createTransaction({
      ...t,
      timestamp: now(),
      obligationId: null,
      subscriptionId: null,
    });
  }
  private accountOutput(row: schema.AccountRow, r: Replay, debts?: schema.DebtRow[]): Account {
    const d = (debts ?? this.rows().debts).find((d) => d.accountId === row.id);
    const balance = liability(row) ? r.debts.get(d!.id)!.balance : (r.accounts.get(row.id) ?? 0);
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      type: row.type as Account['type'],
      currency: row.currency as Currency,
      openingBalance: decimal(liability(row) ? (d?.openingMinor ?? 0) : row.openingMinor),
      currentBalance: decimal(liability(row) ? -balance : balance),
      currentDebt: liability(row) ? decimal(balance) : null,
      creditLimit: row.creditLimitMinor == null ? null : decimal(row.creditLimitMinor),
      notes: row.notes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  listAccounts(): Account[] {
    const r = this.replay();
    return this.rows().accounts.map((a) => this.accountOutput(a, r));
  }
  createAccount(input: AccountInput): Account {
    return this.atomic(() => {
      const { p, isLiability, opening, debtOpening, creditLimit } = validateAccountInput(input),
        id = randomUUID(),
        date = now();
      const row: schema.AccountRow = {
        id,
        name: p.name,
        owner: p.owner ?? 'Ben',
        type: p.type,
        currency: p.currency,
        openingMinor: isLiability ? 0 : opening,
        creditLimitMinor: creditLimit,
        notes: p.notes ?? null,
        createdAt: date,
        updatedAt: date,
        deletedAt: null,
      };
      this.db.insert(schema.accounts).values(row).run();
      if (isLiability) {
        const debt: schema.DebtRow = {
          id: randomUUID(),
          name: p.name,
          type: p.type,
          currency: p.currency,
          openingMinor: debtOpening,
          creditLimitMinor: row.creditLimitMinor,
          accountId: id,
          notes: p.notes ?? null,
          createdAt: date,
          updatedAt: date,
          deletedAt: null,
        };
        this.db.insert(schema.debts).values(debt).run();
        this.audit('DEBT', debt.id, 'CREATE', null, this.debtOutput(debt, this.replay()));
      }
      const result = this.accountOutput(row, this.replay());
      this.audit('ACCOUNT', id, 'CREATE', null, result);
      return result;
    });
  }
  updateAccount(id: string, input: Partial<AccountInput>): Account {
    return this.atomic(() => {
      const old = this.listAccounts().find((a) => a.id === id);
      if (!old) throw new Error('Hesap bulunamadı');
      const source = this.rows().accounts.find((a) => a.id === id)!;
      const p = accountValidator.parse({ ...old, ...input });
      if (p.type !== source.type)
        throw new Error('Hesap türü değiştirilemez; yeni bir hesap oluşturun');
      const isLiability = liability(source),
        row = {
          ...source,
          name: p.name,
          owner: p.owner ?? 'Ben',
          currency: p.currency,
          openingMinor: isLiability ? 0 : minor(p.openingBalance ?? '0', true),
          creditLimitMinor: p.creditLimit == null ? null : minor(p.creditLimit),
          notes: p.notes ?? null,
          updatedAt: now(),
        };
      this.db.update(schema.accounts).set(row).where(eq(schema.accounts.id, id)).run();
      if (isLiability) {
        const linked = this.rows().debts.find((d) => d.accountId === id)!;
        const before = this.debtOutput(linked, this.replay());
        const opening =
          input.currentDebt != null
            ? add(minor(input.currentDebt), -add(minor(old.currentDebt!), -linked.openingMinor))
            : input.openingBalance != null
              ? minor(input.openingBalance)
              : linked.openingMinor;
        if (opening < 0) throw new Error('Girilen güncel borç, açılış borcunu negatif yapıyor');
        this.db
          .update(schema.debts)
          .set({
            name: p.name,
            currency: p.currency,
            openingMinor: opening,
            creditLimitMinor: row.creditLimitMinor,
            updatedAt: now(),
          })
          .where(eq(schema.debts.id, linked.id))
          .run();
        this.replay();
        this.audit(
          'DEBT',
          linked.id,
          'EDIT',
          before,
          this.listDebts().find((d) => d.id === linked.id),
        );
      }
      const result = this.accountOutput(row, this.replay());
      this.audit('ACCOUNT', id, 'EDIT', old, result);
      return result;
    });
  }
  deleteAccount(id: string) {
    return this.atomic(() => {
      const old = this.listAccounts().find((a) => a.id === id);
      if (!old) throw new Error('Hesap bulunamadı');
      if (
        this.db
          .select()
          .from(schema.transactions)
          .all()
          .some((t) => t.accountId === id || t.destinationAccountId === id)
      )
        throw new Error('Hesap işlem geçmişinde kullanıldığı için silinemez');
      if (
        this.db
          .select()
          .from(schema.obligations)
          .all()
          .some((x) => !x.deletedAt && x.accountId === id) ||
        this.db
          .select()
          .from(schema.subscriptions)
          .all()
          .some((x) => !x.deletedAt && x.accountId === id)
      )
        throw new Error('Hesap bir düzenli ödeme veya aboneliğe bağlı olduğu için silinemez');
      const debt = this.rows().debts.find((d) => d.accountId === id);
      if (debt) {
        if (
          this.db
            .select()
            .from(schema.transactions)
            .all()
            .some((t) => t.debtId === debt.id)
        )
          throw new Error('Bağlı borç işlem geçmişinde kullanıldığı için hesap silinemez');
        const before = this.listDebts().find((d) => d.id === debt.id);
        this.db
          .update(schema.debts)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(eq(schema.debts.id, debt.id))
          .run();
        this.audit('DEBT', debt.id, 'DELETE', before, null);
      }
      this.db
        .update(schema.accounts)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(schema.accounts.id, id))
        .run();
      this.replay();
      this.audit('ACCOUNT', id, 'DELETE', old, null);
    });
  }
  private debtOutput(row: schema.DebtRow, r: Replay): Debt {
    const stats = r.debts.get(row.id)!;
    return {
      id: row.id,
      name: row.name,
      type: row.type as Debt['type'],
      currency: row.currency as Currency,
      openingBalance: decimal(row.openingMinor),
      currentBalance: decimal(stats.balance),
      payments: decimal(stats.payments),
      newUsage: decimal(stats.newUsage),
      interest: decimal(stats.interest),
      fees: decimal(stats.fees),
      netChange: decimal(add(stats.balance, -row.openingMinor)),
      creditLimit: row.creditLimitMinor == null ? null : decimal(row.creditLimitMinor),
      accountId: row.accountId,
      notes: row.notes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  listDebts(): Debt[] {
    const r = this.replay();
    return this.rows().debts.map((d) => this.debtOutput(d, r));
  }
  createDebt(input: DebtInput): Debt {
    return this.atomic(() => {
      const p = debtValidator.parse(input);
      if (p.accountId) {
        const a = this.rows().accounts.find((a) => a.id === p.accountId);
        if (!a || !liability(a) || a.currency !== p.currency || a.type !== p.type)
          throw new Error('Bağlı borç mevcut kredi kartı veya KMH hesabıyla eşleşmelidir');
        if (this.rows().debts.some((d) => d.accountId === a.id))
          throw new Error('Bu kredi kartı veya KMH hesabına zaten bir borç bağlı');
      }
      const date = now(),
        row: schema.DebtRow = {
          id: randomUUID(),
          name: p.name,
          type: p.type,
          currency: p.currency,
          openingMinor: minor(p.openingBalance ?? '0'),
          creditLimitMinor: p.creditLimit == null ? null : minor(p.creditLimit),
          accountId: p.accountId ?? null,
          notes: p.notes ?? null,
          createdAt: date,
          updatedAt: date,
          deletedAt: null,
        };
      this.db.insert(schema.debts).values(row).run();
      const result = this.debtOutput(row, this.replay());
      this.audit('DEBT', row.id, 'CREATE', null, result);
      return result;
    });
  }
  updateDebt(id: string, input: Partial<DebtInput>): Debt {
    return this.atomic(() => {
      const old = this.listDebts().find((d) => d.id === id);
      if (!old) throw new Error('Borç bulunamadı');
      const source = this.rows().debts.find((d) => d.id === id)!;
      const p = debtValidator.parse({ ...old, ...input });
      if ((p.accountId ?? null) !== source.accountId)
        throw new Error('Borcun bağlı olduğu hesap değiştirilemez');
      if (source.accountId) {
        const a = this.rows().accounts.find((a) => a.id === source.accountId)!;
        if (p.currency !== a.currency || p.type !== a.type)
          throw new Error('Bağlı borcun türü ve para birimi hesapla aynı olmalıdır');
      }
      const row = {
        ...source,
        name: p.name,
        type: p.type,
        currency: p.currency,
        openingMinor: minor(p.openingBalance ?? '0'),
        creditLimitMinor: p.creditLimit == null ? null : minor(p.creditLimit),
        notes: p.notes ?? null,
        updatedAt: now(),
      };
      this.db.update(schema.debts).set(row).where(eq(schema.debts.id, id)).run();
      const result = this.debtOutput(row, this.replay());
      this.audit('DEBT', id, 'EDIT', old, result);
      return result;
    });
  }
  deleteDebt(id: string) {
    return this.atomic(() => {
      const old = this.listDebts().find((d) => d.id === id);
      if (!old) throw new Error('Borç bulunamadı');
      if (old.accountId)
        throw new Error('Bu borcu kaldırmak için bağlı kredi kartı veya KMH hesabını silin');
      if (
        this.db
          .select()
          .from(schema.transactions)
          .all()
          .some((t) => t.debtId === id)
      )
        throw new Error('Borç işlem geçmişinde kullanıldığı için silinemez');
      this.db
        .update(schema.debts)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(schema.debts.id, id))
        .run();
      this.replay();
      this.audit('DEBT', id, 'DELETE', old, null);
    });
  }
  private validatePlanAccount(accountId: string | null | undefined, currency: string) {
    if (accountId) {
      const account = this.rows().accounts.find((a) => a.id === accountId);
      if (!account || account.currency !== currency)
        throw new Error('Düzenli ödeme hesabı mevcut olmalı ve para birimi eşleşmelidir');
    }
  }
  private paid(kind: 'obligation' | 'subscription', id: string, occurrence: string) {
    return this.rows().transactions.some(
      (t) =>
        t.type === 'EXPENSE' &&
        (kind === 'obligation'
          ? t.obligationId === id && t.obligationOccurrence === occurrence
          : t.subscriptionId === id && t.subscriptionOccurrence === occurrence),
    );
  }
  private obligationOutput(row: schema.ObligationRow): Obligation {
    return {
      id: row.id,
      name: row.name,
      amount: decimal(row.amountMinor),
      currency: row.currency as Currency,
      frequency: row.frequency as Obligation['frequency'],
      dueDate: row.dueDate,
      category: row.category,
      accountId: row.accountId,
      active: row.active,
      scope: row.scope as Obligation['scope'],
      status: this.paid('obligation', row.id, row.dueDate)
        ? 'PAID'
        : row.dueDate < this.localDay(now())
          ? 'OVERDUE'
          : 'UPCOMING',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  listObligations(): Obligation[] {
    return this.db
      .select()
      .from(schema.obligations)
      .where(isNull(schema.obligations.deletedAt))
      .all()
      .map((o) => this.obligationOutput(o));
  }
  createObligation(input: ObligationInput): Obligation {
    return this.atomic(() => {
      const p = obligationValidator.parse(input);
      this.validatePlanAccount(p.accountId, p.currency);
      const amount = minor(p.amount);
      if (amount <= 0) throw new Error('Beklenen tutar pozitif olmalıdır');
      const date = now(),
        row: schema.ObligationRow = {
          id: randomUUID(),
          name: p.name,
          amountMinor: amount,
          currency: p.currency,
          frequency: p.frequency,
          dueDate: day(p.dueDate),
          category: p.category ?? 'Düzenli ödeme',
          accountId: p.accountId ?? null,
          active: p.active ?? true,
          scope: p.scope ?? 'PERSONAL',
          createdAt: date,
          updatedAt: date,
          deletedAt: null,
        };
      this.db.insert(schema.obligations).values(row).run();
      const result = this.obligationOutput(row);
      this.audit('OBLIGATION', row.id, 'CREATE', null, result);
      return result;
    });
  }
  updateObligation(id: string, input: Partial<ObligationInput>): Obligation {
    return this.atomic(() => {
      const old = this.listObligations().find((o) => o.id === id);
      if (!old) throw new Error('Düzenli ödeme bulunamadı');
      const p = obligationValidator.parse({ ...old, ...input });
      this.validatePlanAccount(p.accountId, p.currency);
      const amount = minor(p.amount);
      if (amount <= 0) throw new Error('Beklenen tutar pozitif olmalıdır');
      this.db
        .update(schema.obligations)
        .set({
          name: p.name,
          amountMinor: amount,
          currency: p.currency,
          frequency: p.frequency,
          dueDate: day(p.dueDate),
          category: p.category ?? 'Düzenli ödeme',
          accountId: p.accountId ?? null,
          active: p.active ?? true,
          scope: p.scope ?? 'PERSONAL',
          updatedAt: now(),
        })
        .where(eq(schema.obligations.id, id))
        .run();
      this.replay();
      const result = this.listObligations().find((o) => o.id === id)!;
      this.audit('OBLIGATION', id, 'EDIT', old, result);
      return result;
    });
  }
  deleteObligation(id: string) {
    return this.atomic(() => {
      const old = this.listObligations().find((o) => o.id === id);
      if (!old) throw new Error('Düzenli ödeme bulunamadı');
      this.db
        .update(schema.obligations)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(schema.obligations.id, id))
        .run();
      this.audit('OBLIGATION', id, 'DELETE', old, null);
    });
  }
  payObligation(id: string, input: TransactionInput): Transaction {
    return this.atomic(() => {
      const o = this.listObligations().find((o) => o.id === id);
      if (!o || !o.active) throw new Error('Etkin düzenli ödeme bulunamadı');
      if (o.status === 'PAID') throw new Error('Bu döneme ait ödeme zaten kaydedilmiş');
      if (input.type !== 'EXPENSE' || input.currency !== o.currency)
        throw new Error('Ödeme, düzenli ödemenin para biriminde bir gider olmalıdır');
      return this.createTransaction({
        ...input,
        accountId: input.accountId ?? o.accountId,
        category: input.category ?? o.category,
        scope: input.scope ?? o.scope,
        obligationId: id,
      });
    });
  }
  private subscriptionOutput(row: schema.SubscriptionRow): Subscription {
    return {
      id: row.id,
      service: row.service,
      amount: decimal(row.amountMinor),
      currency: row.currency as Currency,
      frequency: row.frequency as Subscription['frequency'],
      nextRenewal: row.nextRenewal,
      category: row.category,
      accountId: row.accountId,
      active: row.active,
      scope: row.scope as Subscription['scope'],
      status: !row.active
        ? 'CANCELLED'
        : this.paid('subscription', row.id, row.nextRenewal)
          ? 'PAID'
          : row.nextRenewal < this.localDay(now())
            ? 'OVERDUE'
            : 'UPCOMING',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  listSubscriptions(): Subscription[] {
    return this.db
      .select()
      .from(schema.subscriptions)
      .where(isNull(schema.subscriptions.deletedAt))
      .all()
      .map((s) => this.subscriptionOutput(s));
  }
  createSubscription(input: SubscriptionInput): Subscription {
    return this.atomic(() => {
      const p = subscriptionValidator.parse(input);
      this.validatePlanAccount(p.accountId, p.currency);
      const amount = minor(p.amount);
      if (amount <= 0) throw new Error('Beklenen tutar pozitif olmalıdır');
      const date = now(),
        row: schema.SubscriptionRow = {
          id: randomUUID(),
          service: p.service,
          amountMinor: amount,
          currency: p.currency,
          frequency: p.frequency,
          nextRenewal: day(p.nextRenewal),
          category: p.category ?? 'Abonelikler',
          accountId: p.accountId ?? null,
          active: p.active ?? true,
          scope: p.scope ?? 'PERSONAL',
          createdAt: date,
          updatedAt: date,
          deletedAt: null,
        };
      this.db.insert(schema.subscriptions).values(row).run();
      const result = this.subscriptionOutput(row);
      this.audit('SUBSCRIPTION', row.id, 'CREATE', null, result);
      return result;
    });
  }
  updateSubscription(id: string, input: Partial<SubscriptionInput>): Subscription {
    return this.atomic(() => {
      const old = this.listSubscriptions().find((s) => s.id === id);
      if (!old) throw new Error('Abonelik bulunamadı');
      const p = subscriptionValidator.parse({ ...old, ...input });
      this.validatePlanAccount(p.accountId, p.currency);
      const amount = minor(p.amount);
      if (amount <= 0) throw new Error('Beklenen tutar pozitif olmalıdır');
      this.db
        .update(schema.subscriptions)
        .set({
          service: p.service,
          amountMinor: amount,
          currency: p.currency,
          frequency: p.frequency,
          nextRenewal: day(p.nextRenewal),
          category: p.category ?? 'Abonelikler',
          accountId: p.accountId ?? null,
          active: p.active ?? true,
          scope: p.scope ?? 'PERSONAL',
          updatedAt: now(),
        })
        .where(eq(schema.subscriptions.id, id))
        .run();
      this.replay();
      const result = this.listSubscriptions().find((s) => s.id === id)!;
      this.audit('SUBSCRIPTION', id, 'EDIT', old, result);
      return result;
    });
  }
  deleteSubscription(id: string) {
    return this.atomic(() => {
      const old = this.listSubscriptions().find((s) => s.id === id);
      if (!old) throw new Error('Abonelik bulunamadı');
      this.db
        .update(schema.subscriptions)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(schema.subscriptions.id, id))
        .run();
      this.audit('SUBSCRIPTION', id, 'DELETE', old, null);
    });
  }
  paySubscription(id: string, input: TransactionInput): Transaction {
    return this.atomic(() => {
      const s = this.listSubscriptions().find((s) => s.id === id);
      if (!s || !s.active) throw new Error('Etkin abonelik bulunamadı');
      if (s.status === 'PAID') throw new Error('Bu döneme ait ödeme zaten kaydedilmiş');
      if (input.type !== 'EXPENSE' || input.currency !== s.currency)
        throw new Error('Ödeme, aboneliğin para biriminde bir gider olmalıdır');
      return this.createTransaction({
        ...input,
        accountId: input.accountId ?? s.accountId,
        category: input.category ?? s.category,
        scope: input.scope ?? s.scope,
        subscriptionId: id,
      });
    });
  }
  listCycles(): Cycle[] {
    return this.db.select().from(schema.cycles).orderBy(asc(schema.cycles.start)).all();
  }
  startCycle(input: { name?: string; start?: string } = {}): Cycle {
    return this.atomic(() => {
      if (this.listCycles().some((c) => !c.end))
        throw new Error('Yeni dönem başlatmadan önce açık dönemi kapatın');
      const start = input.start ? this.bound(input.start) : now();
      if (this.listCycles().some((c) => start <= c.end!))
        throw new Error('Bu dönem mevcut bir finans dönemiyle çakışıyor');
      const c: Cycle = {
        id: randomUUID(),
        name: input.name?.trim() || 'Finans dönemi',
        start,
        end: null,
        createdAt: now(),
      };
      this.db.insert(schema.cycles).values(c).run();
      this.audit('CYCLE', c.id, 'CREATE', null, c);
      return c;
    });
  }
  endCycle(id: string, end?: string): Cycle {
    return this.atomic(() => {
      const old = this.listCycles().find((c) => c.id === id);
      if (!old || old.end) throw new Error('Açık finans dönemi bulunamadı');
      const endTime = end ? this.bound(end, true) : now();
      if (endTime < old.start) throw new Error('Dönem bitişi başlangıçtan önce olamaz');
      if (
        this.listCycles().some(
          (c) => c.id !== id && c.start <= endTime && (c.end == null || c.end >= old.start),
        )
      )
        throw new Error('Bu dönem mevcut bir finans dönemiyle çakışıyor');
      this.db.update(schema.cycles).set({ end: endTime }).where(eq(schema.cycles.id, id)).run();
      const result = { ...old, end: endTime };
      this.audit('CYCLE', id, 'EDIT', old, result);
      return result;
    });
  }
  private localDay(timestamp: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.FINANCE_TIMEZONE ?? 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timestamp));
  }
  normalizeTransactionTimestamp(value?: string): string {
    return value ? this.bound(value) : now();
  }
  private bound(value: string, end = false): string {
    if (value.length !== 10) return instant(value);
    day(value);
    const zone = process.env.FINANCE_TIMEZONE ?? 'Europe/Istanbul';
    const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
      date.getUTCMilliseconds(),
    );
    return new Date(date.getTime() - (asUTC - date.getTime())).toISOString();
  }
  getContext(
    options: { from?: string; to?: string; cycleId?: string; all?: boolean } = {},
  ): FinancialContext {
    const cycles = this.listCycles(),
      cycle = options.cycleId
        ? cycles.find((c) => c.id === options.cycleId)
        : options.all || options.from || options.to
          ? null
          : (cycles.find((c) => !c.end) ?? null);
    if (options.cycleId && !cycle) throw new Error('Finans dönemi bulunamadı');
    const from = options.from ? this.bound(options.from) : (cycle?.start ?? null),
      to = options.to ? this.bound(options.to, true) : (cycle?.end ?? null);
    if (from && to && from > to) throw new Error('Rapor başlangıcı bitişten sonra olamaz');
    const rows = this.rows(),
      past = rows.transactions.filter((t) => !to || t.timestamp <= to),
      selected = past.filter((t) => !from || t.timestamp >= from);
    const selectedIds = new Set(selected.map((t) => t.id)),
      dailyMap = new Map<
        string,
        {
          date: string;
          income: Totals;
          expenses: Totals;
          cashBalance: Totals;
          debtUsage: Totals;
          debtPayments: Totals;
        }
      >();
    const previousFlows: {
      income: Totals;
      expenses: Totals;
      debtUsage: Totals;
      debtPayments: Totals;
    } = { income: {}, expenses: {}, debtUsage: {}, debtPayments: {} };
    const r = this.replay(past, selected, rows, (transaction, state) => {
        if (!selectedIds.has(transaction.id)) return;
        const date = this.localDay(transaction.timestamp),
          cell = dailyMap.get(date) ?? {
            date,
            income: {},
            expenses: {},
            cashBalance: {},
            debtUsage: {},
            debtPayments: {},
          };
        for (const key of ['income', 'expenses', 'debtUsage', 'debtPayments'] as const) {
          const current = state.metrics[key];
          for (const c of new Set([...Object.keys(current), ...Object.keys(previousFlows[key])])) {
            const delta = add(
              current[c as Currency] ?? 0,
              -(previousFlows[key][c as Currency] ?? 0),
            );
            if (delta !== 0) total(cell[key], c as Currency, delta);
          }
          previousFlows[key] = { ...current };
        }
        cell.cashBalance = { ...state.unassigned };
        for (const account of rows.accounts)
          if (!liability(account) && account.type !== 'SAVINGS')
            total(
              cell.cashBalance,
              account.currency as Currency,
              state.accounts.get(account.id) ?? 0,
            );
        dailyMap.set(date, cell);
      }),
      opening = this.replay(from ? past.filter((t) => t.timestamp < from) : [], [], rows);
    const positionChange: Totals = { ...r.metrics.netFinancialPosition };
    for (const [c, n] of Object.entries(opening.metrics.netFinancialPosition))
      total(positionChange, c as Currency, -n!);
    const metrics = Object.fromEntries(
      metricKeys.map((k) => [k, money(r.metrics[k])]),
    ) as unknown as Metrics;
    const daily = [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((cell) => ({
        date: cell.date,
        income: money(cell.income),
        expenses: money(cell.expenses),
        cashBalance: money(cell.cashBalance),
        debtUsage: money(cell.debtUsage),
        debtPayments: money(cell.debtPayments),
      }));
    return {
      generatedAt: now(),
      currentCycle: cycle ?? null,
      accounts: rows.accounts.map((a) => this.accountOutput(a, r, rows.debts)),
      balances: metrics.availableCash,
      metrics,
      income: metrics.income,
      expenses: metrics.expenses,
      cashOutflow: metrics.cashOutflow,
      debts: rows.debts.map((d) => this.debtOutput(d, r)),
      debtPayments: metrics.debtPayments,
      debtUsage: metrics.debtUsage,
      savings: metrics.savings,
      subscriptions: this.listSubscriptions(),
      recurringObligations: this.listObligations(),
      categoryTotals: [...r.categories].map(([category, totals]) => ({
        category,
        totals: money(totals),
      })),
      recentTransactions: [...selected]
        .reverse()
        .slice(0, 20)
        .map((t) => this.transaction(t)),
      netFinancialPosition: metrics.netFinancialPosition,
      transactionCount: selected.length,
      unassignedCash: money(r.unassigned),
      charts: { daily },
      period: { from, to },
      openingPosition: money(opening.metrics.netFinancialPosition),
      positionChange: money(positionChange),
      scopeTotals: { PERSONAL: money(r.scope.PERSONAL), BUSINESS: money(r.scope.BUSINESS) },
    };
  }
  listAudit(entityId?: string): AuditEntry[] {
    return this.db
      .select()
      .from(schema.audit)
      .all()
      .filter((a) => !entityId || a.entityId === entityId)
      .map((a) => ({
        ...a,
        before: a.before ? JSON.parse(a.before) : null,
        after: a.after ? JSON.parse(a.after) : null,
      }));
  }
  snapshot() {
    return {
      schemaVersion: 1,
      exportedAt: now(),
      context: this.getContext(),
      accounts: this.listAccounts(),
      debts: this.listDebts(),
      transactions: this.db
        .select()
        .from(schema.transactions)
        .all()
        .map((t) => this.transaction(t)),
      activeTransactions: this.listTransactions(),
      deletedTransactions: this.listTransactions({ deleted: true }),
      obligations: this.listObligations(),
      subscriptions: this.listSubscriptions(),
      cycles: this.listCycles(),
      audit: this.listAudit(),
      sourceRecords: {
        accounts: this.db.select().from(schema.accounts).all(),
        debts: this.db.select().from(schema.debts).all(),
        obligations: this.db.select().from(schema.obligations).all(),
        subscriptions: this.db.select().from(schema.subscriptions).all(),
        transactions: this.db.select().from(schema.transactions).all(),
      },
    };
  }
  parse(text: string): ParseResult {
    return parseEntry(text, this.listDebts());
  }
  addText(text: string): EntryResult {
    const confirmation = this.parse(text);
    if (!confirmation.certain) return { saved: false, confirmation };
    try {
      return {
        saved: true,
        transaction: this.createTransaction(confirmation.draft as TransactionInput),
      };
    } catch (error) {
      return {
        saved: false,
        confirmation: {
          ...confirmation,
          certain: false,
          issues: [
            ...confirmation.issues,
            error instanceof Error ? error.message : 'İşlemi kaydetmeden önce bilgileri onaylayın',
          ],
        },
      };
    }
  }
}
