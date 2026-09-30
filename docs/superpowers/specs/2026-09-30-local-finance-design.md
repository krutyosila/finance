# Still Finance design

Build the requested local personal finance app in this empty workspace. No seeded financial or account records. The user's detailed brief authorizes implementation and execution without another design approval.

## Architecture and financial boundaries

React calls the localhost Express API on port 4317. Express and the CLI both instantiate `FinanceService` from `server/core/service.ts`; no interface maintains its own accounting state. SQLite lives at `data/finance.sqlite`. Drizzle provides schema and queries; committed SQL migrations initialize schema only. Transactions are soft deleted, all financial operations audited and atomic.

Money is decimal text at boundaries and integer minor units in storage and calculation, with exact decimal conversion through BigInt. TRY, USD, EUR, USDT remain distinct. A foreign transaction's user supplied conversion informs reporting; it does not silently exchange the source account's native currency.

Unassigned income/expenses are supported from day one through derived unassigned cash, without creating a bank account. Debt repayment decreases cash and debt; debt usage increases debt and cash; liability purchases increase actual expense and debt. Transfers and savings move owned assets and never increase income or expenses. Cash and savings exclude credit capacity. Overpayments are rejected. Cross currency transfers require an explicit received amount.

Cycles use custom start/end instants. Scheduled obligations are plans, linked actual transactions mark payments; schedules never create expenses automatically. Deleted records do not contribute to balances. Restore revalidates invariants.

## Interface direction

A calm, desktop first workspace with an ink/navy sidebar, mist white canvas, blue and teal accents, local bundled Manrope/Dm Sans fonts, tabular figures and thin dividers. A large Turkish compatible quick entry input anchors the dashboard. All financial cards and charts show empty states until records exist. Seven navigation pages support real CRUD; a global quick add opens the structured confirmation form. No external font or AI requests.

## Validation

Engine tests use temporary databases. Integration tests compare service, API and CLI results. Browser verification covers onboarding, confirmation, navigation and responsive behavior. Production SQLite remains empty throughout testing.
