# E3b: Linked receipts and evidenced dominoes
- **Goal:** Forecast the C1 Kestrel snapshot without double-counting receipts and explain real rule breaches.
- **Folder:** `packages/engine/` only; exception: this card's Result in the worker checkout.
- **Contracts used:** Engine.forecast/dominoes, Deal.invoiceId, Constraint, DominoContext, Forecast, Domino, Change.
- **Depends on:** C1 merged at 3c54e67; reviewed E3a repair 4a9be26 integrated at 59fe62d; combined 131-test check passes.
- **Done when:** forecast.test.ts and dominoes.test.ts cover the E3b acceptance cases in the implementation brief; raw fixtures.snapshot forecasts successfully; full `pnpm check` passes.
- **Notes:** Read `kb/spec/engine-e3b-e4-implementation.md`, the C1 contract document, AGENTS.md and skills/engine-tdd/SKILL.md. Fixture forecasts are illustrations, not numerical oracles.
- **Launch:** Human launches Claude Code on E3b-dominoes in ../domino-E3b. Codex audits the diff and reruns checks before integration; do not start E4 in this worktree.
- **Scope:** Preserve exact cents/date repairs; expose a shared internal rule evaluator for E4. No scanRisks/scoreFix/stressTest, shared contracts, dependencies, Convex, seed updates or network calls.
- **Coordination:** You are not alone. Preserve others' work; no main, board/handoff, merge, push or rebase edits. Stop at 90 minutes and report a split if unfinished.
## Result (worker fills this in when done)
- Done: C1 receipt linkage (linked deals add no cash even when paid; explicit null adds once; missing invoiceId throws an unknown-mapping error); shared rule evaluator (min_cash weekly close strict-below, pay_by_date daily funding replay per brief, runway exact rational 13-week burn / 3); dominoes with optional context wired into engine. Raw Kestrel snapshot forecasts. `pnpm check` passes: engine 66 (forecast 37, dominoes 29), contracts 35, web 43, agents 20, sim 5 = 169 tests; typecheck and lint clean.
- What changed (files): packages/engine/src/{schedule.ts, forecast.ts (split into cashSchedule + forecastFromSchedule, math unchanged), dates.ts (horizonEnd), index.ts, forecast.test.ts}; new funding.ts (fundingDays replay), rules.ts (evaluateRules, evaluateOnSchedule, verifiedSchedule, weeklyBreach, compareBreaches for E4), dominoes.ts, dominoes.test.ts.
- Watch out (conventions where the brief was silent, for audit):
  - With context, dominoes/evaluateRules throw if the passed forecast differs from forecast(snapshot, context.model, context.changes); illustrative fixture forecasts cannot be combined with a context.
  - min_runway_months is treated as context-required (strict reading of C1), so dominoes(f, fixtures.constraints, snapshot) without context throws because con_runway is present. It is computable from the forecast alone if Codex prefers to relax this.
  - A consequence domino is causedBy its own breach even without baseline. Other causedBy links need context.baseline: drop -> event only if baseline has no qualifying drop that week and exactly one changed record explains it; min_cash/runway breach -> latest earlier drop, else sole earlier event, only if baseline does not break the same rule by that week. pay_by_date breaches never get causedBy.
  - Event markers come from net per-record diff of final vs no-change schedule (overdue dates clamped to asOf+1), so an overridden change emits nothing. add_cash/remove_cash/shift_hire produce no event or drop markers (no record ID to cite).
  - Ordering: week, date, type (event, drop, breach, consequence), stable key. Weekly rules break on Sunday close; pay_by_date on its deadline. Paid target bill = clear. Deadline after last forecast Sunday = beyond_horizon (omitted). Duplicate constraint IDs throw. Deal linked to an invoice absent from the snapshot throws (defence for unparsed input).
  - Labels include engine-formatted dollar amounts and ISO dates (display text; AGENTS.md "format money only in UI" may argue against). Evidence sources: invoice stripe, deal crm, bill books.
  - Duplicate bill IDs are not rejected by SnapshotSchema and would collapse in the event diff. Lost-receipt sensitivity for E4 should adjust the schedule and call evaluateOnSchedule; that hook is unexercised. dominoes.ts is 321 lines; functions not mechanically measured against the 40-line guideline.

Brain audit: e77474d passes 169 tests but is blocked on three reproduced correctness defects. See kb/reviews/E3b-e77474d.md and kb/tasks/E3b-r1-funding-causes.md. Not merged; E4 remains gated.

Repair update: 565c3fa clears the funding/identity findings but retains one causal-scope defect. Continue with kb/tasks/E3b-r2-causal-scope.md; review kb/reviews/E3b-r1-565c3fa.md.
