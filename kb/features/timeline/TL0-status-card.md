# TL0: Timeline split inventory

- **Goal:** Give the Timeline owner a source-backed backend inventory and ordered weekly integration queue.
- **Folder:** `kb/features/timeline` only.
- **Contracts used:** Read-only `WeeklySeedV1`, `WeeklyResultRefV1`, `OperationSummaryV1`, `Snapshot`, `CompanyModel`, `Constraint`, `Branch`, `Forecast`, `ResilienceReport`.
- **Done when:** Remote branch/base checked, current/new work distinguished, missing seam inputs recorded, baseline checks reported honestly.
- **Notes:** Weekly BRIEF/vision and owner prompt supersede quarterly-only milestones. No feature implementation or runtime changes.

## Result
- Done: inventory/queue and local pickup recorded; 1,609 tests, typechecks/lint, separate Convex typecheck and lane import inventory pass.
- What changed (files): ROADMAP.md, HANDOFF.md, boundary-requests.md and this card.
- Watch out: model/rule provenance and lane-local persistence need resolution; no build/browser/database/provider acceptance.
