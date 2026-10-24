# E4-r1: Preserve daily risks and trustworthy timeline identity
- **Goal:** Fix the three blockers in kb/reviews/E4-2340ff8.md before E4 integration.
- **Folder:** packages/engine/ only; exception: this card's Result in the worker checkout.
- **Contracts used:** Existing Snapshot, RiskEvent, Universe and PastEvent; no shared type changes.
- **Done when:** Each exact review case reproduces red then passes; daily-risk output survives despite equal weekly totals; all risk sets have distinct stable IDs; no signing event uses expectedClose as an actual date; full pnpm check passes.
- **Notes:** Read the review from main, the updated E4 brief and skills/engine-tdd/SKILL.md. Preserve verified money/date/score logic and all E3b regressions.
- **Launch:** Codex directly runs Claude Opus in ../domino-E4, E4-multiverse at 2340ff8, under user authorization. Thirty-minute checkpoint; no second engine writer.
- **Scope:** Smallest repair and regression tests only. Keep ranking/top-five/all-adverse policies and genuine no-effect omission; do not restrict valid risk IDs. Omit dated big-deal signing markers until actual timestamps exist. No new feature, contract, dependency or provider work.
- **Coordination:** You are not alone. No other checkout, env, board/handoff, pull/rebase/reset/stash/merge/push or subagents. Commit owned engine changes and this Result. Record actual red/green evidence, full-check counts, limitations and hash.
## Result (worker fills this in when done)
- Done: All three review blockers are fixed test-first. Each regression was written and run red before any implementation edit (`vitest run -t "E4-r1|daily deadline"`: 3 failed, 1 passed):
  1. risks: exact review case → `expected [] to deeply equal [["risk_late_i", 0, 0.1]]`. The same test asserts the delayed and base weekly forecasts are byte-equal, and that assertion passed. A guard test (deadline 11-04 still met, or no constraints) passed throughout, so true no-effect omission stays.
  2. stress-test: risks a, b, a+b, base → `expected 10 to be 12` unique IDs.
  3. history: exact review case → got `past_deal_won` dated 2026-09-01 with note "close date 2026-09-01"; expected `[]`.
  Green: engine 121/121 (117 + 4 new). `TURBO_FORCE=true pnpm check` passes: 5/5 typechecks, 240 tests (engine 121, contracts 35, web 59, agents 20, sim 5), biome lint clean (130 files).
- What changed (files):
  - `packages/engine/src/risks.ts`: `scanRisks` now uses its `constraints`. A candidate is dropped only if the weekly inflow/outflow is equal AND every rule outcome matches the base. A rule outcome is the constraint ID, its status and the first breach date, all from the shared `evaluateOnSchedule` on the candidate's own `cashSchedule`. Impact, probability, ranking (`compareRisks`), the top-five cap and evidence are unchanged.
  - `packages/engine/src/stress-test.ts`: universe ID is now `u_` + `JSON.stringify` of the canonical sorted risk-ID array (`u_[]`, `u_["base"]`, `u_["a+b"]`, `u_["a","b"]`). It is injective for any string IDs, still depends only on the risk set, and the internal dedupe key is unchanged.
  - `packages/engine/src/history.ts`: removed `bigDeals` and `BIG_DEAL`. `pastEvents` no longer emits any deal-signing marker. Late-payment, payroll and spend-spike markers are unchanged.
  - Tests: new regressions in `risks.test.ts`, `stress-test.test.ts` and `history.test.ts`. Earlier stress-test ID literals were moved to the new encoding (same sets, order and scores). The history test no longer expects `past_deal_big`.
- Watch out:
  - Universe ID format changed (`u_base` → `u_[]`, `u_rA+rB` → `u_["rA","rB"]`). The original E4 card's Result still describes the old format; I left that card alone as instructed. Contract fixtures (`packages/contracts/src/fixtures`) still build their own illustrative `u_…+…` IDs, and engine code does not read them. Anything that later parses or matches engine universe IDs must treat them as opaque, or decode them as JSON.
  - `scanRisks` now validates constraints through the shared evaluator. Duplicate constraint IDs, or a pay_by_date with a missing or unknown bill, now throw, as in dominoes and stressTest. Before, they were ignored.
  - A risk kept only for a daily-rule change has `impactLowPoint` 0. Under the unchanged policy it ranks by ID after positive-impact risks, and stressTest leaves it out of the all-adverse set (impact not positive). It still gets its own single-risk universe, and pairs if it is in the top four.
  - Kestrel: a throwaway probe (deleted, not committed) confirmed that all four scanned risks already differ weekly. The fixture scan output is unchanged by this repair.
  - `big_deal` PastEvents stay omitted until an actual signing/close timestamp exists in contracts. No new field was added. No live provider data was checked.
