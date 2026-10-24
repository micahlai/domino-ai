# Week pipeline and retained forecast generations

Status: planned integration direction, not implemented. Fixed-snapshot computed prototype is already working. Complete pure engine/simulator adoption and source pulls first.

## Decisions

- Keep all old snapshot generations and their decisions immutable. Current queries show the generation matching the latest committed snapshot; branch.get and decision-record links can still resolve historical generations. Recompute changes only the current generation, and stale-parent simulation still rejects. Saved proposal ordering must be scoped by generation, never shared across dates. New-date proposals are newly validated against current inputs; do not silently carry obsolete invoice changes across weeks.
- Add explicit internal simulator state with a version and durable run identity. Public next-week requests carry a client-generated requestId and expectedVersion. Retries of the same request return its prior status; a different request with a stale version fails. One active transition per company. Approvals continue to record decisions only and never inject changes automatically.
- Candidate next world remains private until the transition succeeds. The mock source HTTP layer can expose its observable Snapshot to authenticated source pulls by run/version, never runtime/answer keys. A failed pull leaves the current company forecast and version unchanged, with a clear failure status.
- Persist each originating snapshot before outcomes arrive. Grade the old forecast against genuinely observed bank data after the advance. Learn only from preserved authentic origins and complete closed-week windows. The simulator starts world.week25 while company.currentWeek0 is the demo offset; increment both consistently. A Friday-to-Friday advance closes the preceding Monday-to-Sunday week only when the grading window is complete.
- Reconciliation is exact in cents. Nessie account.balance is the seeded opening balance, so current cash is opening plus known posted transaction totals. Seed writes require a durable ledger and stable per-company event identity. An uncertain POST response must be reconciled by the unique synthetic marker before retrying. No blind duplicate financial mock posts or deleting remote resources.

## Minimal persisted additions to settle before implementation

Internal simulation world/version; workflow request/status/candidate state; per-company Nessie resource IDs and posting ledger; per-generation proposal order and authentic-origin references. Use explicit indexed tables or rigorously validated payload schemas. Do not place credentials in records or logs. Existing snapshots/models/grades/explanations/approvals remain the public domain records. Shared schema changes need an explicit task-card exception and independent review.

## Action sequence

Connect: create deterministic synthetic world, publish only observable sources, seed isolated Nessie resources, fetch API docs/samples, ask validated mapper and document reader, normalize/pull every source, reconcile bank/tie-out, commit snapshot/model/constraints and compute all outputs. Initial model assumptions must be labelled; no claimed historical learning without preserved replay evidence. Source progress/errors and actual provider identities are logged without secrets.

Advance: reserve request/version, compute deterministic candidate, publish mock candidate sources and reconcile Nessie postings once, pull/validate new observations, grade prior forecast, learn from authentic prior origins, prepare current generation, atomically commit world/version/snapshot/model/grade/computed output, then generate/cache the optional weekly brief. A brief failure must not roll back already-committed accounting state; log the error and allow bounded retry. External effects cannot participate in the Convex transaction, so the durable ledger and candidate must survive retries.

Agent actions: use provider routing and schema-versioned hashes. Cache explanations on exact branch input hash; reject or avoid attaching results if branch inputs changed while awaiting a provider. Proposals only create candidates after engine scoring and validation. Never fabricate gains, automatically approve, move money or contact anyone.

Counterargument: retained generations and retry records add work. Reusing the current single-snapshot replacement path would either reject every approved prior week or silently erase decision history; explicit versions are required before enabling Next week.
