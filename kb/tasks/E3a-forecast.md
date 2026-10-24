# E3a: Deterministic forecast and scenario changes
- **Goal:** Compute a trustworthy 13-week cash schedule; first slice of E3, not the full domino engine.
- **Folder:** `packages/engine/` only; exception: this card's Result section.
- **Contracts used:** `Engine.forecast`, `Snapshot`, `CompanyModel`, `Change`, `ForecastSchema`.
- **Done when:** `src/forecast.test.ts` covers balances, restricted cash, paid/unsigned exclusions, UTC boundaries, all eight changes, critical-bill rejection, input immutability and ambiguous deal rejection; package tests and `pnpm check` pass.
- **Notes:** Read `skills/engine-tdd/SKILL.md`, build-spec §§6.1/6.7 and `kb/tasks/launch-plan-2026-10-24.md` (shared rules and E3a). Use `fixtures.snapshot/model` plus small independently calculated cases, never fixture forecast arrays as an oracle.
- **Scope:** Keep public contracts fixed; use an internal dated cash schedule for changes. Wire only `engine.forecast`; leave other methods explicitly unbuilt. No new dependencies.
- **Owner:** Claude Code, launched by Jayden; implementation commit `f9b5ad2` on `E3a-forecast`, sibling worktree `domino-E3a`. Codex brain coordinates review; do not launch a duplicate worker.
- **Coordination:** You are not alone. Preserve others' changes; do not edit board, handoffs, contracts, shared lockfile or other cards. Report contract needs in Result.
## Result (worker fills this in when done)
- Done: 2026-10-24, Claude Code (Opus 5.5) at the user's request instead of Codex. Branch `E3a-forecast`, worktree `../domino-E3a` (created by this worker; it did not exist). `engine.forecast` wired; other methods still notBuilt. Verified on Node 24.11.1: `pnpm --filter @domino/engine test` 26 passed; `pnpm check` passed (4 typechecks, 13 contract + 26 engine tests, lint).
- What changed (files): `packages/engine/src/{dates,schedule,changes,forecast,forecast.test,index}.ts`. No contracts, manifests, lockfile or deps changed. This card is untracked in main, so this Result lives only in the main checkout, not on the branch.
- Watch out (provisional conventions, need brain review):
  - Original fixture throws "ambiguous" (deal_acme_renewal vs inv_acme_2027). Tests drop that deal.
  - Flows dated before week 0 (overdue, or between asOf and the first Monday) land in week 0; flows after the last week are dropped. Payroll dated on or before asOf counts as already paid.
  - Missing customer delay in the model means 0 days late.
  - churn removes invoice/deal cash whose current scheduled date is on or after fromDate (not issued date).
  - Changes to a known record with no remaining cash (paid, lost, churned) are no-ops; unknown ids throw. Negative add_cash/remove_cash amounts throw.
  - shift_hire savings count as inflow (outflow stays nonnegative), dated at the week start. Per-day rate is a float summed per week, then rounded once.
  - Recurring spend anchored at asOf + everyDays (as the plan says).
  - Not built: dominoes, applyChanges on Snapshot, min_cash domino test from the E3 prompt. Next: E3b after the contract requests are resolved.

## Brain reconciliation (2026-10-24)
- Verified f9b5ad2 exists on E3a-forecast and changes only six engine source/test files. No merge or push performed by this brain.
- Fresh TURBO_FORCE=true pnpm check under Node 24.11.1 passed: four package typechecks, 26 engine tests, 13 contract tests and lint.
- The card is currently tracked on main; the worker Result was left as an uncommitted main-checkout edit, not in f9b5ad2. Preserved above as the worker's report.
- Worktree creation overlapped planning: the brain found and reused Claude's clean E3a checkout, fast-forwarding it to planning commit 82540a6 before f9b5ad2. No user changes were reset.
- The raw-fixture ambiguity guard was specified by the brain. It remains an explicit integration limitation, not an unexpected worker regression.
- Independent GPT-6 Astra review blocks merge on historical hire savings and exact cent rounding. See kb/reviews/E3a-f9b5ad2.md; Claude's next task is kb/tasks/E3a-r1-money-dates.md on the existing branch.
