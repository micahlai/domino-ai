# E7a-r1: Exact validation and consistent observation boundaries
- **Goal:** Fix the four reproduced grading and learning audit defects without expanding the feature.
- **Folder:** packages/engine only; exception: this card Result. Continue existing E7a worktree/branch.
- **Contracts used:** Existing E7a/C2 contracts, no type changes.
- **Done when:** Each review case is a red/green regression test; full pnpm check passes; unchanged/no-evidence learning behavior remains intact for valid inputs.
- **Notes:** Read kb/reviews/E7a-c7fd940.md and /tmp/e7a-independent-audit.ts. Use BigInt for the forecast balance equation. For accumulated bank cash beyond safe Cents range, explicitly reject with an informative range error before formatting; this slice does not widen the Cents domain. Validate the current calendar cutoff whenever a learning context is supplied. Validate replay-bank dates, safe amounts and unique IDs regardless of whether candidate generation changes anything.
- **Scope:** Small shared validation helpers are allowed. No broader engine refactor, future billing, contracts, web, simulator, dependencies or environment edits. Preserve context-free legacy learn returning its model unchanged.
- **Coordination:** You are not alone. No other checkout edits, subagents, secrets, network, external messages, board/handoffs, pull/rebase/reset/stash/merge/push. Commit owned files and Result for independent review.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
