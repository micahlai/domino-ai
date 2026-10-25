# TL2B: constraints, scenarios and saved run backend

- **Goal:** immutable versioned rules, parent-linked scenarios, comparisons and paginated saved-run catalog implement TL1C/TL2/TL4 core.
- **Folder:** apps/web/convex (ONLY timeline/workspace*.ts, optional timeline/workspace/ helpers, schemas/timeline.schema.ts, schemaComposition.test.ts; preserve all Field/other files).
- **Contracts used:** WeeklySeedV1, Snapshot, CompanyModel, ChangeSchema, ConstraintSchema, ForecastSchema, OperationSummaryV1, WeeklyResultRefV1; read-only engine API/evaluateRules.
- **Done when:** new convex-test tests cover rules add/edit/remove/reopen, pre-existing/new breaches, targeted deadline/outside horizon/runway, nested changes once, request conflicts/retries, company/target isolation, date/money/row bounds, pagination/seam JSON. pnpm check and separate Convex typecheck pass.
- **Notes:** implement kb/features/timeline/TL2-TL5-interface.md exactly. Read baseline implementation/audit and weekly spec. You alone add timelineRuns + timelineQuestions schema; do not implement question functions. No shared math/contracts/root schema/dashboard edits, no backend services/env/provider calls. User explicitly authorizes parallel workers through TL5. Commit clear TL1C/TL2/TL4 steps, no merge/push. Ask lead promptly if wire contract needs amendment.

## Result
- Done: `timeline/workspace` implements open, reviseConstraints, simulate, get, catalog, graph and resultRef per TL2-TL5-interface.md (TL1C/TL2/TL4 commits 59484eb, 23099b5, 6d96fe7). Immutable runs; rule receipts come from the shared `evaluateRules` with the parent judged under the same rules (new / pre_existing / resolved / clear / outside_horizon / unable). 33 new convex-test cases. `pnpm check` passes (web 551, contracts 496, engine 344, agents 298, sim 5; lint 326 files) and separate `tsc --noEmit -p convex` passes.
- What changed (files): `apps/web/convex/schemas/timeline.schema.ts` (timelineRuns, timelineQuestions), `schemaComposition.test.ts` (25 tables), new `timeline/workspace.ts`, `workspaceInput.ts`, `workspaceRules.ts`, `workspaceRefs.ts`, `workspace.test.ts`. No contracts, engine, root schema, Field, baselines.ts or dashboard edits. No question functions.
- Watch out:
  - Engine subpath import `@domino/engine/src/rules` (package has no exports map), read-only. Include it in the lane import inventory.
  - `open`: one root per baseline (run id derived from company+baseline). A second requestId for an existing root returns it (`created:false`) but does not bind that requestId.
  - Workspace input checks copy the private TL1 helpers (baselines.ts was out of scope). The money bound also counts change amounts and leaves 2x headroom so comparison deltas stay exact.
  - Rejected with explanations: changes dated on or before asOf, or targeting paid invoices/bills (`HISTORICAL_CHANGE`); dated changes after the last forecast Sunday (`OUTSIDE_HORIZON`); critical bill delays; repeated change labels; depth > 20; > 64 total changes. A delay that pushes existing cash past the horizon is accepted, because that is its real effect.
  - `reviseConstraints` rejects an identical rule set (`NO_CHANGE`). `simulate` needs >= 1 change; `constraintsJson` and `constraintNote` must come together.
  - Receipt values: min_cash breach = usable at the breach close plus exact shortfall; min_cash clear = the lowest weekly usable and its week (date null). Runway value/shortfall are always null. pay_by_date value = days from original due to projected funding, shortfall = days past the deadline (null if not funded in the horizon).
  - `graph` returns at most 100 rows, oldest first; the UI should treat exactly 100 as possibly truncated. `catalog` uses Convex `paginationOptsValidator`, page size 1-100.
  - Root reuses the baseline's frozen forecast/dominoes. Rules-only runs call dominoes without a counterfactual (no causal claim).
  - Not run: real Convex backend or CLI codegen (`_generated/api` unchanged; use `workspaceRefs`). No push or merge.
