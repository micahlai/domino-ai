# E3a-r1: Fix historical savings and cent rounding
- **Goal:** Fix the two independently reproduced E3a correctness defects before merge.
- **Folder:** `packages/engine/` only; exception: this card copied into this worktree and its Result section.
- **Contracts used:** Existing `Engine.forecast`, `Snapshot`, `CompanyModel`, `Change`; no contract edits.
- **Done when:** Regression tests prove historical-only hire savings are zero, straddling savings include only days after asOf (including days before the first Monday), February half-cent savings round to 25005 and the fractional-percent discount rounds to 45; focused tests and `pnpm check` pass.
- **Notes:** Read `kb/reviews/E3a-f9b5ad2.md` from the main checkout and `skills/engine-tdd/SKILL.md`. Use exact rational/integer arithmetic before final rounding; add no dependencies.
- **Scope:** Preserve ordered changes, public signatures and existing tests. Keep fixture ambiguity/domino contract work separate. Do not change the savings-as-inflow convention in this repair.
- **Launch:** Claude Code continues in existing `domino-E3a` on `E3a-forecast` at f9b5ad2. Copy this card from main into that worktree before starting; update/commit only that local copy's Result, never main's copy.
- **Coordination:** You are not alone. No reset, rebase, merge, push, board/handoff or shared-file edits. Record red/green commands, exact regression outcomes and scoped commit hash; return for independent review.
## Result (worker fills this in when done)
- Done: 2026-10-24, Claude Code (Opus 5.5) on `E3a-forecast`, on top of f9b5ad2. Node 24.11.1, pnpm 9.12.0.
  - Red: `pnpm --filter @domino/engine test` showed 2 failed, 26 passed. Historical hire credited 9677 (expected 0); February hire gave 25004 (expected 25005). The reviewer's numbers reproduced exactly.
  - Green: same command, 28 passed. `TURBO_FORCE=true pnpm check` passed: 4 typechecks, 13 contract + 28 engine tests, lint.
  - Regression outcomes: historical-only hire [2026-10-01, 2026-10-02) gives 0. Straddling [2026-10-29, 2026-11-03) with asOf 2026-10-30 gives 29677 in week 0 (Oct 31 + Nov 1-2; asOf excluded; pre-Monday days kept). February hire gives 25005. A 125-cent invoice at 64.4% gives 45.
- What changed (files): new `packages/engine/src/money.ts` (exact BigInt ratios, half-up rounding matching Math.round, decimal percent parsing); `changes.ts` (hire skips days on or before asOf, sums exact per-week ratios; discount uses exact math); `forecast.test.ts` (2 regression tests); this card copy.
- Watch out:
  - Percent is read as its shortest decimal form (String(64.4) is "64.4"), so a computed float like 64.40000000000001 is treated as that exact decimal. Correct for typed or validated input; callers should not pass arithmetic results.
  - Half-cent ties round toward +infinity, matching the prior Math.round convention. Banker's rounding was not requested.
  - Unchanged and still open: the fixture ambiguity guard, savings-as-inflow, the recurring anchor, dominoes/E3b. No contracts touched.

Brain verification: repair commit 4a9be26 is clean and unmerged. Independent GPT-6 Astra review found both blockers fixed; lead forced pnpm check passed 28 engine + 13 contract tests, four typechecks and lint. See kb/reviews/E3a-r1-4a9be26.md.
