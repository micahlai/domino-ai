# S2: read-only saved investigation catalog
- **Goal:** company Simulations can list and reopen real saved investigations without dispatching work.
- **Owner:** friend on second computer; branch S2-simulation-catalog. Do not launch locally.
- **Ownership:** apps/web/convex/investigationCatalog.ts, investigationCatalog.test.ts; apps/web/convex/schema.ts ONLY add by_case_createdAt on investigationConversations(caseId,createdAt); generated api.d.ts ONLY generated registration if necessary; this Result. No other files, UI, shared contracts or existing investigation/historical implementation edits.
- **Dependency:** current preview accepted G7; independent of G8/S1/U1. S4 waits until this schema ownership is released.
- **API:** public query investigationCatalog.list({caseId,paginationOpts}) using existing pagination conventions, bounded 1..25 items, newest first, exact curated case filter. Read operations with bounded query and detect truncation, fail closed. Return allowlisted identity/question/createdAt and status, current operation title/kind/status, saved forecast/run IDs and reveal presence only when proven by succeeded operations. Never packets, remote run IDs, credentials, raw provider output or private memory.
- **Status:** queued/running work -> running; unresolved unknown remains unknown; succeeded forecast plus failed specialist -> partial, not completed; all terminal success -> completed; no successful output plus terminal failures -> failed. Empty operations explicitly pending/unknown, never completed. Document precedence. Do not expose hypothetical event support that does not exist yet.
- **Scope:** investigation-owned history only; legacy direct historical runs remain reachable through known links, not silently relabelled. No mutations/schedulers/provider calls/new tables/denormalized status columns.
- **Tests:** case isolation, stable pagination/newest order, bounded reads, statuses including unknown+failed, partial forecast, safe allowlist, empty state and repeated reads produce no writes. Reuse existing backend test harness. Focused tests/typecheck/lint; parent full suite and runtime gate.
- **Launch:** prompts/shared/S2-friend-catalog.md. Use Claude orchestrator/ponytail, one process. Commit/push only own branch, no main or preview merge. Stop at checkpoint.
## Result
- Pending.
