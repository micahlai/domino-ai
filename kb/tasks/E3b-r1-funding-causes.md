# E3b-r1: Correct daily savings, causal attribution and bill identity
- **Goal:** Resolve all three blockers from the independent e77474d audit before E3b merges.
- **Folder:** `packages/engine/` only; exception: copy this card from main to this checkout and fill its Result.
- **Contracts used:** Existing Snapshot, Change, Forecast, DominoContext, Constraint and Domino; no shared contract edits.
- **Done when:** Regression tests reproduce then fix both hire-date cases, unrelated-event/drop causal blame and both duplicate-bill cases from kb/reviews/E3b-e77474d.md; all prior rounding tests and full `pnpm check` pass.
- **Notes:** Read the review from main, the E3b implementation brief and skills/engine-tdd/SKILL.md. Preserve weekly exact rounded totals while exposing actual daily savings; prove cause per candidate or omit the arrow; reject ambiguous bill IDs.
- **Launch:** Claude Code continues in ../domino-E3b on E3b-dominoes at e77474d. Codex independently audits the repair before merge or E4 launch.
- **Scope:** No new features, contracts, dependencies, Convex, provider calls or approval semantics. Preserve queue/horizon rules and evidenced consequences.
- **Coordination:** You are not alone. Do not reset/rebase/merge/push or edit main/board/handoffs; keep existing work. Commit scoped changes plus your local card Result, record red/green outcomes and return the commit hash.
## Result (worker fills this in when done)
- Done: All three e77474d blockers fixed. `pnpm check` passes: engine 75 (forecast 39, dominoes 36), contracts 35, web 43, agents 20, sim 5 = 178 tests; typechecks and lint clean (lead reran). Red/green, all new tests prefixed `r1:`:
  - Nov 6 hire savings: red (bill funded Nov 2) -> green (Nov 2 deadline breached).
  - Oct 31 hire savings: red (funded Nov 2) -> green (funded Oct 31, clear).
  - Month-crossing/half-cent weekly conservation (1000 -> 227 as 33/33/32/32/32/33/32; 465 -> 106 as 16 + 15x6): red -> green.
  - Week zero keeps pre-Monday days on real dates: red -> green.
  - Review causal case (delay_invoice -1 plus remove_cash 70000): red (blamed event) -> green (no arrow).
  - Earlier unrelated drop then separate shock: red (blamed drop) -> green (no arrow; drop still links to its event).
  - Delayed-receipt chain with an unrelated early event: green before and after (regression guard, not expected red).
  - Duplicate bill IDs, same due date: red (clear) -> green (throws "ambiguous bill id b").
  - Duplicate bill IDs, Nov 2/Nov 3 with Nov 3 receipt: red (false breach) -> green (throws). Both checked on forecast, cashSchedule, evaluateOnSchedule and dominoes with/without context.
- What changed (files): packages/engine/src/changes.ts (hire savings per actual day as successive differences of rounded cumulative exact savings within each forecast bucket; weekly totals unchanged), schedule.ts (assertUniqueBillIds in baseSchedule), rules.ts (same guard first in checkConstraints, covering evaluateOnSchedule), dominoes.ts (latestCause/causedByScenario removed; per-candidate counterfactual re-forecast), forecast.test.ts, dominoes.test.ts.
- Watch out:
  - causedBy is still emitted only when context.baseline is supplied (caller opt-in); proof itself comes from re-forecasting with the candidate's own changes removed. Kept only if exactly one candidate removes the drop, or removes/delays the breach. Proven drops are preferred over events; two or more proven of one kind gives no arrow.
  - pay_by_date breaches still never get causedBy (extending proof to daily funding would be new behaviour).
  - Churn touches every invoice/deal of that customer, so one churn often proves several events and the uniqueness rule drops the arrow (conservative).
  - Not fixed (out of scope): duplicate invoice/deal IDs are not rejected; add_cash/remove_cash/shift_hire still produce no markers and cannot be named as causes.

Brain audit: 565c3fa passes 178 branch tests. Daily savings and duplicate identities are independently cleared. One customer-churn causal-scope blocker remains; see kb/reviews/E3b-r1-565c3fa.md and E3b-r2-causal-scope.md. Not merged.
