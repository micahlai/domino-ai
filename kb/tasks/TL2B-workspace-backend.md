# TL2B: constraints, scenarios and saved run backend

- **Goal:** immutable versioned rules, parent-linked scenarios, comparisons and paginated saved-run catalog implement TL1C/TL2/TL4 core.
- **Folder:** apps/web/convex (ONLY timeline/workspace*.ts, optional timeline/workspace/ helpers, schemas/timeline.schema.ts, schemaComposition.test.ts; preserve all Field/other files).
- **Contracts used:** WeeklySeedV1, Snapshot, CompanyModel, ChangeSchema, ConstraintSchema, ForecastSchema, OperationSummaryV1, WeeklyResultRefV1; read-only engine API/evaluateRules.
- **Done when:** new convex-test tests cover rules add/edit/remove/reopen, pre-existing/new breaches, targeted deadline/outside horizon/runway, nested changes once, request conflicts/retries, company/target isolation, date/money/row bounds, pagination/seam JSON. pnpm check and separate Convex typecheck pass.
- **Notes:** implement kb/features/timeline/TL2-TL5-interface.md exactly. Read baseline implementation/audit and weekly spec. You alone add timelineRuns + timelineQuestions schema; do not implement question functions. No shared math/contracts/root schema/dashboard edits, no backend services/env/provider calls. User explicitly authorizes parallel workers through TL5. Commit clear TL1C/TL2/TL4 steps, no merge/push. Ask lead promptly if wire contract needs amendment.

## Result
- Done:
- What changed (files):
- Watch out:
