# Universal AI Entry Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement independent tasks in this session and review the combined result.

**Goal:** Enable Turkish natural-language creation of every existing finance record type, including related records in one confirmed batch.

**Architecture:** Add a typed preview/confirm plan alongside the legacy transaction AI. Strict provider output feeds a server validation and atomic execution service; a unified browser review asks for missing details before confirmation.

**Tech Stack:** Existing TypeScript, React 19, Express 5, Zod 3, better-sqlite3, Vitest; no new dependencies.

## Global Constraints

- Maximum 12.000 characters and 25 records per plan.
- Creation kinds: transaction, account, debt, obligation, subscription, cycle.
- No live financial data or paid OpenAI requests in tests.
- Existing API/CLI transaction behavior, authentication, secret handling and financial invariants remain supported.
- Preview leaves no financial records, audit rows or receipts. Confirmation is all-or-nothing and idempotent.
- Required amounts, account opening balances/debt, dates and reference IDs are never guessed.
- UI prose is Turkish and uses the existing visual system.

## Shared contract

```ts
type AiRecordKind = 'transaction' | 'account' | 'debt' | 'obligation' | 'subscription' | 'cycle';
type AiRecordDraft = { key: string } & (
  | { kind: 'transaction'; data: Partial<TransactionInput> }
  | { kind: 'account'; data: Partial<AccountInput> }
  | { kind: 'debt'; data: Partial<DebtInput> }
  | { kind: 'obligation'; data: Partial<ObligationInput> }
  | { kind: 'subscription'; data: Partial<SubscriptionInput> }
  | { kind: 'cycle'; data: { name?: string; start?: string } }
);
interface AiPlan {
  text: string;
  certain: boolean;
  issues: string[];
  items: AiRecordDraft[];
}
type AiPlanResult =
  | { saved: true; records: { key: string; kind: AiRecordKind; id: string }[] }
  | { saved: false; confirmation: AiPlan };
// Local references use @key. Existing references use actual IDs.
// AiInterpreter gains optional interpretPlan(text, references): Promise<AiPlan>.
// AiReferences gains optional subscriptions, obligations and currentCycle metadata.
```

### Task 1: Provider plan schema and shared types (root)

Files: shared/types.ts, server/ai/client.ts, server/ai/plan-schema.ts, tests/ai-plan-provider.test.ts.

- [x] Add a mocked-provider test expecting a strict account+subscription plan and metadata-only references; run it and observe missing plan support.
- [x] Define the shared contract above; build strict anyOf item schemas with nullable, required provider fields and allowlisted enums; strip nulls into partial inputs.
- [x] Add interpretPlan using the existing bounded Responses transport; use instructions distinguishing entity definitions from actual money movements and asking for missing facts.
- [x] Run provider tests alongside legacy AI tests.

### Task 2: Atomic plan service (backend agent)

Files: server/ai/plan.ts, tests/ai-plan.test.ts.

Produces `new AiPlanService(finance, interpreter)`, `preview(text): Promise<AiPlan>`, `confirm(plan, requestId, authorize?): AiPlanResult`.

- [x] Write temporary-database behavior tests for all kinds, related account+subscription batches, missing opening balance/date, preview rollback, batch rollback and persistent retries. Observe failures before implementation.
- [x] Validate untrusted plan shape and required per-kind inputs. Resolve @key references by dependency order, including automatically linked credit-account debt. Validate existing ID kind, currency and duplicate entity definitions.
- [x] Execute previews under a rollback transaction; execute confirmed plans plus a `plan:` receipt under one immediate SQLite transaction. Call authorization inside the write transaction. Never save uncertain plans.
- [x] Run backend tests and report exact evidence.

### Task 3: Unified review UI (frontend agent)

Files: src/components/QuickEntry.tsx, src/components/AiPlanReview.tsx, src/App.tsx, src/styles.css, tests/ai-plan-ui.test.ts.

Consumes `POST /ai/entry {text}` -> AiPlan and `POST /ai/entry/confirm {plan,requestId}` -> AiPlanResult.

- [x] Add render or pure presentation-helper tests for all kind names, linked record labels and incomplete plans; observe failures.
- [x] Use a multiline input and preview-only initial submission. Show all items in a modal with human-readable fields and relationships. Incomplete plans require follow-up text; re-submit accumulated context with later corrections taking precedence.
- [x] Keep a stable confirmation request ID across network retries and disable repeat clicks. Reset request ID on revised plans. On success refresh context and close; on validation failure show returned confirmation. Never persist finance text in browser storage.
- [x] Run UI tests/type checks and report evidence.

### Task 4: Integrate endpoints, CLI, docs and review (root)

Files: server/app.ts, server/cli.ts, tests/ai-plan-interfaces.test.ts, README.md, docs/API.md.

- [x] Write API/CLI tests verifying preview-only behavior, confirmed multi-record writes, duplicate delivery, unauthenticated rejection and authorization after asynchronous AI; observe failures.
- [x] Register new authenticated endpoints with the same post-provider authorization check. Add CLI ai preview and ai confirm; incomplete confirmation returns code 2, failures code 1.
- [x] Document all kinds, examples, new onay/ek bilgi behavior and data sharing metadata.
- [x] Review changes with a fresh agent, repair findings, run full tests/typecheck/build and verify the browser flow with isolated test data.
