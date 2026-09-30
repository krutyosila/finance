export const CURRENCIES = ['TRY', 'USD', 'EUR', 'USDT'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const TRANSACTION_TYPES = [
  'INCOME',
  'EXPENSE',
  'DEBT_PAYMENT',
  'DEBT_USAGE',
  'TRANSFER',
  'SAVINGS',
  'REFUND',
  'ADJUSTMENT',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export const ACCOUNT_TYPES = [
  'BANK',
  'CASH',
  'CREDIT_CARD',
  'OVERDRAFT',
  'WALLET',
  'SAVINGS',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const DEBT_TYPES = ['CREDIT_CARD', 'OVERDRAFT', 'LOAN', 'PERSONAL', 'OTHER'] as const;
export type DebtType = (typeof DEBT_TYPES)[number];
export type MoneyTotals = Partial<Record<Currency, string>>;
export type Scope = 'PERSONAL' | 'BUSINESS';
export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export interface TransactionInput {
  type: TransactionType;
  amount: string;
  currency: Currency;
  timestamp?: string;
  amountTRY?: string | null;
  exchangeRate?: string | null;
  category?: string;
  description: string;
  accountId?: string | null;
  destinationAccountId?: string | null;
  destinationAmount?: string | null;
  debtId?: string | null;
  counterparty?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  scope?: Scope;
  debtComponent?: 'PRINCIPAL' | 'INTEREST' | 'FEE';
  obligationId?: string | null;
  subscriptionId?: string | null;
}
export interface Transaction extends Omit<TransactionInput, 'timestamp'> {
  id: string;
  timestamp: string;
  amountMinor: number;
  amountTRY: string | null;
  exchangeRate: string | null;
  category: string;
  accountId: string | null;
  destinationAccountId: string | null;
  destinationAmount: string | null;
  debtId: string | null;
  scope: Scope;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface AccountInput {
  name: string;
  owner?: string;
  type: AccountType;
  currency: Currency;
  openingBalance?: string;
  creditLimit?: string | null;
  currentDebt?: string | null;
  notes?: string;
}
export interface Account extends AccountInput {
  id: string;
  owner: string;
  openingBalance: string;
  currentBalance: string;
  currentDebt: string | null;
  creditLimit: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DebtInput {
  name: string;
  type: DebtType;
  currency: Currency;
  openingBalance?: string;
  creditLimit?: string | null;
  accountId?: string | null;
  notes?: string;
}
export interface Debt extends DebtInput {
  id: string;
  openingBalance: string;
  currentBalance: string;
  payments: string;
  newUsage: string;
  interest: string;
  fees: string;
  netChange: string;
  creditLimit: string | null;
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ObligationInput {
  name: string;
  amount: string;
  currency: Currency;
  frequency: Frequency;
  dueDate: string;
  category?: string;
  accountId?: string | null;
  active?: boolean;
  scope?: Scope;
}
export interface Obligation extends ObligationInput {
  id: string;
  active: boolean;
  status: 'UPCOMING' | 'PAID' | 'OVERDUE';
  createdAt: string;
  updatedAt: string;
}
export interface SubscriptionInput {
  service: string;
  amount: string;
  currency: Currency;
  frequency: Frequency;
  nextRenewal: string;
  accountId?: string | null;
  category?: string;
  scope?: Scope;
  active?: boolean;
}
export interface Subscription extends SubscriptionInput {
  id: string;
  active: boolean;
  status: 'UPCOMING' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}
export interface Cycle {
  id: string;
  name: string;
  start: string;
  end: string | null;
  createdAt: string;
}
export interface Metrics {
  availableCash: MoneyTotals;
  income: MoneyTotals;
  expenses: MoneyTotals;
  cashOutflow: MoneyTotals;
  debt: MoneyTotals;
  debtPayments: MoneyTotals;
  debtUsage: MoneyTotals;
  savings: MoneyTotals;
  savingsAdded: MoneyTotals;
  netCashFlow: MoneyTotals;
  assets: MoneyTotals;
  netFinancialPosition: MoneyTotals;
}
export interface FinancialContext {
  generatedAt: string;
  currentCycle: Cycle | null;
  accounts: Account[];
  balances: MoneyTotals;
  metrics: Metrics;
  income: MoneyTotals;
  expenses: MoneyTotals;
  cashOutflow: MoneyTotals;
  debts: Debt[];
  debtPayments: MoneyTotals;
  debtUsage: MoneyTotals;
  savings: MoneyTotals;
  subscriptions: Subscription[];
  recurringObligations: Obligation[];
  categoryTotals: { category: string; totals: MoneyTotals }[];
  recentTransactions: Transaction[];
  netFinancialPosition: MoneyTotals;
  transactionCount: number;
  unassignedCash: MoneyTotals;
  charts: {
    daily: {
      date: string;
      income: MoneyTotals;
      expenses: MoneyTotals;
      cashBalance: MoneyTotals;
      debtUsage: MoneyTotals;
      debtPayments: MoneyTotals;
    }[];
  };
  period: { from: string | null; to: string | null };
  openingPosition: MoneyTotals;
  positionChange: MoneyTotals;
  scopeTotals: { PERSONAL: MoneyTotals; BUSINESS: MoneyTotals };
}
export interface ParseResult {
  text: string;
  draft: Partial<TransactionInput>;
  certain: boolean;
  issues: string[];
}
export interface EntryResult {
  saved: boolean;
  transaction?: Transaction;
  confirmation?: ParseResult;
}
export interface TransactionFilter {
  search?: string;
  type?: string;
  currency?: string;
  category?: string;
  accountId?: string;
  from?: string;
  to?: string;
  deleted?: boolean;
  scope?: string;
}
export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  timestamp: string;
}
