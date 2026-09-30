CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0), owner TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('BANK','CASH','CREDIT_CARD','OVERDRAFT','WALLET','SAVINGS')),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR','USDT')), opening_minor INTEGER NOT NULL CHECK(typeof(opening_minor)='integer'),
 credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR (typeof(credit_limit_minor)='integer' AND credit_limit_minor>=0)), notes TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS debts (
 id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) > 0),type TEXT NOT NULL CHECK(type IN ('CREDIT_CARD','OVERDRAFT','LOAN','PERSONAL','OTHER')),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR','USDT')),opening_minor INTEGER NOT NULL CHECK(typeof(opening_minor)='integer' AND opening_minor>=0),
 credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR (typeof(credit_limit_minor)='integer' AND credit_limit_minor>=0)),account_id TEXT REFERENCES accounts(id),notes TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS debt_account_unique ON debts(account_id) WHERE deleted_at IS NULL AND account_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS obligations (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR','USDT')),
 frequency TEXT NOT NULL CHECK(frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),due_date TEXT NOT NULL,category TEXT NOT NULL,account_id TEXT REFERENCES accounts(id),active INTEGER NOT NULL CHECK(active IN (0,1)),scope TEXT NOT NULL CHECK(scope IN ('PERSONAL','BUSINESS')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id TEXT PRIMARY KEY,service TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR','USDT')),
 frequency TEXT NOT NULL CHECK(frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),next_renewal TEXT NOT NULL,category TEXT NOT NULL,account_id TEXT REFERENCES accounts(id),active INTEGER NOT NULL CHECK(active IN (0,1)),scope TEXT NOT NULL CHECK(scope IN ('PERSONAL','BUSINESS')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
 id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('INCOME','EXPENSE','DEBT_PAYMENT','DEBT_USAGE','TRANSFER','SAVINGS','REFUND','ADJUSTMENT')),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND (amount_minor>0 OR type='ADJUSTMENT' OR (type='SAVINGS' AND amount_minor!=0))),currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR','USDT')),
 amount_try_minor INTEGER CHECK(amount_try_minor IS NULL OR typeof(amount_try_minor)='integer'),exchange_rate TEXT,category TEXT NOT NULL,description TEXT NOT NULL CHECK(length(trim(description))>0),
 account_id TEXT REFERENCES accounts(id),destination_account_id TEXT REFERENCES accounts(id),destination_minor INTEGER CHECK(destination_minor IS NULL OR (typeof(destination_minor)='integer' AND (destination_minor>0 OR (type='SAVINGS' AND destination_minor!=0)))),debt_id TEXT REFERENCES debts(id),counterparty TEXT,payment_method TEXT,notes TEXT,
 scope TEXT NOT NULL CHECK(scope IN ('PERSONAL','BUSINESS')),debt_component TEXT NOT NULL CHECK(debt_component IN ('PRINCIPAL','INTEREST','FEE')),obligation_id TEXT REFERENCES obligations(id),subscription_id TEXT REFERENCES subscriptions(id),obligation_occurrence TEXT,subscription_occurrence TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS transactions_debt ON transactions(debt_id);
CREATE INDEX IF NOT EXISTS transactions_account ON transactions(account_id);
CREATE TABLE IF NOT EXISTS cycles (id TEXT PRIMARY KEY,name TEXT NOT NULL,start TEXT NOT NULL,end TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,entity TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('CREATE','EDIT','DELETE','RESTORE')),before_json TEXT,after_json TEXT,timestamp TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_entity ON audit(entity_id);
