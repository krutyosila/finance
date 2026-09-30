# AI Account Chain Implementation Plan

> **For agentic workers:** Apply test-driven development and an independent final review. Existing user authorization covers the account-chain correction and the Soyturk release. Work in the clean existing workspace; do not create real financial test records.

**Goal:** Create missing movement accounts, preserve currency-specific balances, and interpret deposits, currency conversion and inter-account transfers as one confirmed atomic plan.

**Architecture:** Keep the existing ledger and strict provider schema. Prepare account references and TRY destination amounts locally before dry-run/confirmation; update provider instructions and currency labels in the existing preview.

**Tech Stack:** TypeScript, React, Express, better-sqlite3, Vitest; Node 22 in production.

## Global Constraints

- No database migration, dependency or proxy/service configuration changes.
- Use existing minor/converted/decimal money helpers, never binary floating point calculations.
- Preview performs no persistent writes; confirm remains atomic and idempotent.
- A named transaction account absent from the system becomes a proposed account. Standalone balance/debt definitions still require explicit balances.
- Zero is a visible tracking baseline for new movement accounts, not an invented historical balance.
- Missing FX proceeds must never be inferred from a subsequent transfer; only an actual total or explicit transaction rate is accepted.
- Existing unique accounts are reused; ambiguity blocks confirmation.

### Task 1: Account chain preparation and provider instructions

**Files:** create `server/ai/account-chain.ts`, `tests/ai-account-chain.test.ts`; modify `server/ai/plan.ts`, `server/ai/plan-schema.ts`, `tests/ai-plan-provider.test.ts`.

**Interfaces:** `prepareAccountChain(plan: AiPlan, accounts: Account[]): AiPlan` returns normalized drafts and targeted issues without writes. Existing `AiPlanService.preview` and `confirm` use it. Existing schema fields and shared types remain unchanged.

- [ ] Write a red regression with Paribu USD, Paribu TRY, VakıfBank TRY account drafts lacking openingBalance and INCOME2500USD, TRANSFER2500USD receiving100000TRY, TRANSFER90000TRY. Assert preview no writes, final balances `[0,10000,90000]`, one USD income, no expenses and same receipt on retry.
- [ ] Add tests for missing proceeds (retained drafts, targeted question, no writes), explicit rate40 (destination100000), contradictory rate40/total105000, existing/partial accounts preserving balances, ambiguous accounts, standalone missing balances and a shared default transaction timestamp.
- [ ] Reuse the pure `validateAccountInput(input: unknown)` from `server/core/service.ts` for supplied account fields before relinking a draft; reject conflicting explicit opening balance/limit. Preserve `createAccount`'s existing validation and money semantics.
- [ ] Run `npx vitest run tests/ai-account-chain.test.ts` and inspect expected failures.
- [ ] Implement pure account matching/relinking, zero tracking note for missing movement-account baseline, explicit TRY rate conversion using `decimal(converted(minor(amount), rate))`, and targeted unresolved FX questions.
- [ ] Apply preparation before preview's uncertain return and inside confirmed database transaction; retain the original payload hash for receipts. Use one timestamp for all omitted transaction dates.
- [ ] Replace the absent-account prohibition with account creation/reuse instructions. Add the complete Paribu example, actual-total follow-up, economic ordering, currency-specific accounts and no double-counting rules.
- [ ] Add strict-provider-schema chain transport coverage and assert prompt instructions cover missing accounts/FX without mistaking mock tests for language-model evaluation.
- [ ] Run backend tests plus typecheck; fix failures before integration.

### Task 2: Currency-aware preview and example

**Files:** modify `src/components/aiPlanPresentation.ts`, `src/components/QuickEntry.tsx`, `tests/ai-plan-ui.test.ts`.

**Interfaces:** retain `describeAiItem`; account titles and links include currency when known, including local references. Existing unknown-currency labels remain.

- [ ] Write failing tests distinguishing local Paribu USD/TRY and existing VakıfBank TRY references.
- [ ] Format account titles/links with currency, show the prepared tracking note through existing notes fields, and update the entry example with a complete deposit/conversion/transfer chain.
- [ ] Run `npx vitest run tests/ai-plan-ui.test.ts` and typecheck. Do not compute financial balances in browser code.

### Task 3: Verification and publication

**Files:** update README/API explanation; use existing deployment script and SSH identity without displaying secret contents.

- [ ] Independently review the full diff for spec compliance and money/reference safety; resolve material findings.
- [ ] Run full `npm test`, `npm run build`, `git diff --check` and formatting checks.
- [ ] Commit/push only requested source/tests/docs; run the installed Soyturk updater (backs up financial/auth data and tests/builds in isolation).
- [ ] Verify active release SHA, service, public health and public assets.
- [ ] If configured, run controlled provider previews against an in-memory database with synthetic accounts only. Verify original incomplete note asks for proceeds; a100000TRY follow-up yields ParibuTRY10000 and VakıfBankTRY90000 without touching production financial records.
