# TL1S: immutable weekly run table

- **Goal:** Persist an imported weekly seed and baseline without writing Field tables.
- **Folder:** `apps/web/convex/schemas` (ONLY timeline.schema.ts; additive Timeline tables explicitly authorized).
- **Contracts used:** WeeklySeedV1, Snapshot, CompanyModel, Constraint, Forecast, Domino, HistoryWeek, PastEvent.
- **Done when:** Bounded append-only runs have request/run/company indexes; legacy composition tests pass; root schema/Field/legacy unchanged.
- **Notes:** ../features/timeline/TL1-implementation.md. One Claude worker executes TL1S then TL1B then TL1U sequentially.

## Result
- Done:
- What changed (files):
- Watch out:
