# Timeline chat safety repair

- Goal: repair the five assistant findings before integrating friend b9f25bb.
- Checkout: /Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-field-timeline-chat-safe, branch field/timeline-chat-safe, based on b9f25bb plus task card 74f19c9.
- Done: original company/request/conversation/text/revision fingerprint; atomic request claims; accepted replay and stale/saved/limit checks before provider. Optional metadata extends the existing Timeline chat request table. No new table, root schema or public receipt shape.
- Retry details: concurrent exact requests return the original unconfirmed revision while its owner runs. The existing client keeps that request uncertain. Failed attempts can retry; abandoned claims expire after 140 seconds, with attempt numbers excluding late completion. A committed result survives a lost response and ignores regenerated model output. Legacy assistant receipts replay only after verifying the stored exact user turn/revision/conversation; legacy grammar receipts also replay.
- Meaning and money: model fields copy actual user spans; original wording retains negation, conditions, daily/maximum limits and other unsupported qualifiers. Existing typed drafts use deterministic clarification/correction. Model prose and offered choice labels are discarded. Questions display only checked resolver answers/citations or explicit clarification. Financial calculations remain in existing engine/resolver paths.
- Audit followup: 183e655 still let rejected daily/maximum wording reach weaker chat fallback grammar, and let model dates omit an explicit year. Save now persists clarification before any fallback and clears a ready proposal on rejected wording, including no-key mode. Questions use the same wording gate before provider/fallback dispatch. Date provenance preserves complete years, malformed suffixes and signs; cash amounts/dates stay in their source clause. Fixed fallback parsing shares the date guard.
- Regression evidence: the four initial audit reproduction cases failed before these changes and passed afterward. Additional cases cover whitespace in maximum qualifiers, malformed years/signs, selected-week replacement, and borrowing a shorter date from another clause. All providers are mocked.
- Deadline: one abort signal and 110-second total budget includes all provider steps and retries, below the question lease. Tests cover a three-call loop, abort and absence of later calls.
- Scope: assistant/chat/questions backend, related tests, optional metadata in timeline/chat/table.ts, task Result and this note only. No UI/Field/shared-contract/root-schema changes. No private provider thinking is persisted or exposed. Trace UI remains a separate task.

## Verification

Use Node 24.11.1 via `PATH=/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH`.

- `pnpm install --offline --frozen-lockfile`: unavailable tarball. Approved `pnpm install --frozen-lockfile` completed; lockfile unchanged.
- `pnpm --filter @domino/web exec vitest run convex/timeline`: 309 passed across 12 files.
- `pnpm --filter @domino/web exec vitest run convex/timeline/chat/assistant.test.ts`: 29 passed, also included in the full Timeline run.
- `pnpm --filter @domino/web typecheck`: passed.
- `pnpm --filter @domino/web exec tsc --noEmit -p convex`: passed.
- Scoped Biome on changed Timeline backend modules/tests: passed, 9 changed code/test files in the followup.
- Exported staged source tree in /private/tmp/domino-timeline-safe-index-p7ibqj2l: 129 focused assistant/question/provider tests, web tsc and Convex tsc passed using the installed dependency links.
- `git diff --check`: passed.

## Limits and next step

- The assistant is intentionally narrower than the friend's unrestricted dialogue. Bare unqualified numbers and model-normalized values without exact source spans require clarification. Corrections use the existing explicit single-field format; Start over remains the explicit reset control.
- No real provider call, deployment, browser session, server or live database mutation occurred. The absent local generated Convex guide was read from the existing domino-ai checkout. No credentials were read or printed.
- Integration owner reviews the repair, merges with the friend branch, then runs combined checks/build/browser and verifies the desktop/phone UI, Field links and slash-containing company IDs. Existing runtime ownership is unchanged; this worker started no service.
