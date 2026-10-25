# TL1S: immutable weekly run table

- **Goal:** Persist an imported weekly seed and baseline without writing Field tables.
- **Folder:** `apps/web/convex` (ONLY schemas/timeline.schema.ts and schemaComposition.test.ts; additive Timeline table and matching regression expectations explicitly authorized).
- **Contracts used:** WeeklySeedV1, Snapshot, CompanyModel, Constraint, Forecast, Domino, HistoryWeek, PastEvent.
- **Done when:** Bounded append-only runs have request/run/company indexes; legacy composition tests pass; root schema/Field/legacy unchanged.
- **Notes:** ../features/timeline/TL1-implementation.md. One Claude worker executes TL1S then TL1B then TL1U sequentially.

## Result
- Done: Added append-only `timelineBaselines` (string company id, domain runId, requestId, seed id/hash, input hash, method version, canonical seed text, frozen model/constraints/forecast/dominoes/history/pastEvents, savedAt) with `by_company_and_runId`, `by_company_and_requestId`, `by_company_and_seedId`. Composition test now expects 23 tables; every legacy table/index expectation is unchanged and passes.
- What changed (files): `apps/web/convex/schemas/timeline.schema.ts`, `apps/web/convex/schemaComposition.test.ts`.
- Watch out: Root `schema.ts`, Field fragment and legacy validators untouched. Payloads are `v.any()` like the existing lane tables; reads re-parse them with contract schemas. Row size is bounded in TL1B (canonical seed <= 600,000 chars, model/constraints JSON <= 64 KiB each) to stay under the 1 MiB document limit. Deploy adds a new empty table only; no backfill.
