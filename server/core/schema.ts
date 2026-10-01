import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
};
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  type: text('type').notNull(),
  currency: text('currency').notNull(),
  openingMinor: integer('opening_minor').notNull(),
  creditLimitMinor: integer('credit_limit_minor'),
  notes: text('notes'),
  ...timestamps,
});
export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  currency: text('currency').notNull(),
  openingMinor: integer('opening_minor').notNull(),
  creditLimitMinor: integer('credit_limit_minor'),
  accountId: text('account_id').references(() => accounts.id),
  notes: text('notes'),
  ...timestamps,
});
export const obligations = sqliteTable('obligations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  frequency: text('frequency').notNull(),
  dueDate: text('due_date').notNull(),
  category: text('category').notNull(),
  accountId: text('account_id').references(() => accounts.id),
  active: integer('active', { mode: 'boolean' }).notNull(),
  scope: text('scope').notNull(),
  ...timestamps,
});
export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  service: text('service').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  frequency: text('frequency').notNull(),
  nextRenewal: text('next_renewal').notNull(),
  category: text('category').notNull(),
  accountId: text('account_id').references(() => accounts.id),
  active: integer('active', { mode: 'boolean' }).notNull(),
  scope: text('scope').notNull(),
  ...timestamps,
});
export const labels = sqliteTable('labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  description: text('description'),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  type: text('type').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  amountTRYMinor: integer('amount_try_minor'),
  exchangeRate: text('exchange_rate'),
  category: text('category').notNull(),
  labelId: text('label_id').references(() => labels.id),
  description: text('description').notNull(),
  accountId: text('account_id').references(() => accounts.id),
  destinationAccountId: text('destination_account_id').references(() => accounts.id),
  destinationMinor: integer('destination_minor'),
  debtId: text('debt_id').references(() => debts.id),
  counterparty: text('counterparty'),
  paymentMethod: text('payment_method'),
  notes: text('notes'),
  scope: text('scope').notNull(),
  debtComponent: text('debt_component').notNull(),
  obligationId: text('obligation_id').references(() => obligations.id),
  subscriptionId: text('subscription_id').references(() => subscriptions.id),
  obligationOccurrence: text('obligation_occurrence'),
  subscriptionOccurrence: text('subscription_occurrence'),
  ...timestamps,
});
export const cycles = sqliteTable('cycles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  start: text('start').notNull(),
  end: text('end'),
  createdAt: text('created_at').notNull(),
});
export const audit = sqliteTable('audit', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  before: text('before_json'),
  after: text('after_json'),
  timestamp: text('timestamp').notNull(),
});
export type AccountRow = typeof accounts.$inferSelect;
export type DebtRow = typeof debts.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type ObligationRow = typeof obligations.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
