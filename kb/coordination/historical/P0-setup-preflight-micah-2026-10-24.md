# P0 setup preflight on Micah's machine, 2026-10-24

Scope: shared-setup intake and read-only technical preflight. The latest user asks this chat to dispatch shared setup; cross-machine handoff/active-slot confirmation is pending, so no implementation worker has been launched. This is not a replacement for P0 acceptance.

## Actual ownership and preserved work

- Published preview remains `a1b9341178c8d3a0629bdf5492165b18dab114ac` at inspection. Local main remains `694ab2a0eb1828c34aa6b5cfc39609d25e2e708f` with its prior dirty setup/PDF files preserved.
- Local setup documentation worktree/branch: `codex/timeline-p0-checkpoint`, prior commit `6db3b338119f69a0ee051c2f9a4868a897c66ca2`. No local S2/P0-C/L1/L2 implementation checkout or loaded chat found. Existing unrelated sessions preserved.
- L1 is accepted at `a72f143`, integrated `507fbe1`; those audit/integration records supersede the older HANDOFF first-rejection summary. No replacement L1 worker needed.
- S2 remains published at `1154972c3edae09d0a5df7c19c553b329b1b46fa`, pending, no catalog code/index. Index reservation handoff is recorded in ../../features/timeline/HANDOFF.md. Catalog stays Timeline-owned. Unknown unpushed remote work must be preserved if surfaced.
- Published coordination records a Jayden shared lead and two implementation repairs, P0-C and L2. Their actual current PIDs/worktree state and worker count cannot be inspected through this host's local tools. The user has been asked to confirm the handoff and current count. No duplicate P0-C/L2 worker or competing global-doc writer is started.
- Existing local Convex listener 3210/3211 (older p1-web-shell checkout) remains untouched. No remote runtimes/database accessed. No local Domino automation was found; remote monitor state is unverified and no automation state was changed. Keep the monitor PAUSED.

## Resolved Convex guide and layout prerequisites

- `convex/_generated/ai/guidelines.md` is absent in the checkout. Installed Convex 1.48.0 CLI `src/cli/lib/versionApi.ts` obtains the canonical guide from https://version.convex.dev/v1/guidelines. That exact official guide was downloaded to `/tmp/domino-convex-guidelines-20261024.md` and read fully before any backend edit.
- Guide SHA-256: `b6b776e9d4dacfe8da23a58c9d11ab9cc9c505891c8f6b9fa9cdc69e4266ac37`, 286 lines; targets Convex ^1.44.0. P0 scope preserves existing dependency versions and legacy code rather than applying unrelated dependency/component recommendations.
- Installed CLI `src/bundler/index.ts` entryPoints supports nested ordinary modules, excludes `_generated`, schema.ts and multi-dot test files. Planned `schema/{legacy,field,timeline}.ts` are ordinary modules containing no registered functions. Root schema.ts can import their table objects and remain the one composition point. Actual fragment code, bundling/typecheck and independent review remain P0-S work, not proven by this inspection.

## Baseline to preserve in P0-S

- Existing schema contains 22 tables: legacy 14, Timeline 4, Field 4. Schema validation enabled.
- Legacy: companies, sources, snapshots, models, constraints, risks, branches, fixes, resilience, history, approvals, grades, explanations, log.
- Timeline: historicalRuns, historicalReveals, historicalRevealReceipts, historicalActivity.
- Field: investigationRequests, investigationConversations, investigationMessages, investigationOperations.
- SHA-256 of exact UTF-8 `schema.export()` string, without trailing newline: `002638240006672faf9259ec4a10f247cb5766e87dd2a2b9fbccb3a371503fa2`. Local exported artifact: `/tmp/domino-p0-schema-a1b9341.json` (saved file includes a newline). P0-S must preserve every table validator/index and verify structural equality except the explicitly reviewed additive conversation index. Avoid object-spread duplicate-name overwrites; test table-set disjointness.
- P0-S may own only the already released `investigationConversations.by_case_createdAt(caseId,createdAt)` addition. It has not been implemented or reviewed yet. Do not claim the index or schema acceptance complete.

## Checks actually run

- Installed frozen workspace dependencies locally with scripts disabled. No lockfile/dependency declaration changes.
- Node v26.3.1, pnpm 9.12.0: `pnpm --filter @domino/web exec vitest run convex/tests/historical.test.ts convex/tests/investigation.test.ts convex/tests/backend.test.ts` passes 55/55 tests in 3 files (13 historical, 22 investigation, 20 backend). These are existing in-memory convex-test suites, not a real local database or final P0 acceptance.
- Read-only schema export and local tree/ref/process inspection. No backend/schema/API code modified; no protected evaluation inputs, secrets or provider calls.
- Full combined checks/build/browser not run in this preflight. No accepted P0 base or fixture hashes claimed.

## Next ordered work

1. Confirm cross-machine setup handoff, actual repair branches/commits, safe checkpoints and global implementation slots (cap three, including implementing leads/helpers).
2. Retrieve and independently audit the existing P0-C repair. Current published round 1 at 189fb0d is rejected; its implementation object is not present in this clone and no P0-C branch is advertised remotely. Do not recreate the contract in parallel.
3. Assign one P0-S worker after ownership/slots permit; preserve old row validators/API shape, add/review the bounded S2 index, compose fragments and test equivalence/old saved shapes. No migration/reset/shared deployment.
4. Only after accepted C/S, assign one P0-H UI worker. Verify full embedded closure/cutoff/company/roles, canonical snapshot/seed hashes and tamper rejection, method equality, separate reveal fixture, frozen legacy consumers/routes, exact isolated backend commands and actual provider-free browser journey.
5. Independently review ready commits, integrate the shared setup only in its designated integration branch, run combined checks/build/browser, record one exact accepted base/fixture hashes/namespaces/two feature starting points. Main stays untouched. Feature-owned internal queues begin afterward.
