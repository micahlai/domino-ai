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
- Done:
- What changed (files):
- Watch out:
