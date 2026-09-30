# Local Finance Implementation Plan

> For agentic workers: use subagent-driven-development to execute tasks and review each deliverable.

**Goal:** A running local first finance application with an empty financial database, shared engine, usable UI/API/CLI and verified accounting.

**Architecture:** React/Vite frontend proxies to Express on 127.0.0.1:4317. API and CLI call FinanceService using Drizzle and SQLite. Shared types in `shared/types.ts` define the interface contracts.

**Tech Stack:** Node 22, TypeScript, React 19, Vite 6, SQLite/better-sqlite3, Drizzle, Express 5, Tailwind 4, Recharts 3, Vitest 3.

## Global Constraints

- No seeded financial records or automatic accounts.
- No floating point arithmetic for financial calculations or invented exchange rates.
- Bind frontend and API to 127.0.0.1 only.
- Test databases must be temporary and independent of data/finance.sqlite.

## Engine deliverable

- [x] Define schema/migration in `server/core/schema.ts`, `server/migrations/0001_initial.sql` and `server/core/database.ts`.
- [x] Write engine/parser tests in `tests/engine.test.ts` before implementation and observe missing behavior.
- [x] Implement `FinanceService` with account/debt/transaction/schedule/cycle CRUD, audit, context, reports, parser and shared accounting. Public contracts use `shared/types.ts`.
- [x] Run `npm test -- tests/engine.test.ts` and review accounting against the brief.

## API and CLI deliverable

- [x] Write integration tests in `tests/interfaces.test.ts` before handlers.
- [x] Implement local API and CLI adapters in `server/app.ts`, `server/index.ts`, `server/cli.ts` using FinanceService exclusively.
- [x] Implement shared safe backups/restores/export in `server/maintenance.ts`; test recovery and exact JSON outputs in temporary directories.
- [x] Write README, API and metric documentation; verify against engine code.

## Interface deliverable

- [x] Implement empty dashboard, real charts once transactions exist, global quick add with confirmation and all seven navigation pages under `src/`.
- [x] Add account/debt/cycle/schedule creation and editing, transaction edit/delete/restore/duplicate/search/filter.
- [x] Run typecheck/build then browser checks at desktop and narrow widths. Exercise writes against a temporary verification instance only.

## Final integration

- [x] Independently review financial rules and implementation; resolve findings with regression tests.
- [x] Run `npm test`, `npm run build`, initialize empty schema, start app and verify API/CLI/UI.
- [x] Query all production financial tables to confirm zero records. Deliver URL, commands, path, test results and concrete limitations.
