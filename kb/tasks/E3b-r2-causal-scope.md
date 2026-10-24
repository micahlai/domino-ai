# E3b-r2: Scope causal proof to the represented cash effect
- **Goal:** Remove the remaining false customer-churn causal links before E3b integration.
- **Folder:** `packages/engine/` only; exception: copy this card from main into the worker checkout and fill its Result.
- **Contracts used:** Existing Change, DominoContext, Forecast and Domino; no public contract changes.
- **Done when:** Both exact cases A/B in kb/reviews/E3b-r1-565c3fa.md reproduce red then pass without false arrows; isolated supported chains/consequences and all r1 regressions still pass; full `pnpm check` passes.
- **Notes:** Read the review from main and skills/engine-tdd/SKILL.md. Removing a customer-wide churn cannot prove a single-record cause when it restores other cash. Scope proof to the actual represented effect or conservatively omit ambiguous arrows.
- **Launch:** Claude continues ../domino-E3b, E3b-dominoes at 565c3fa; no rebase or merge of current main. Codex independently re-reviews before integration/E4.
- **Scope:** Smallest causal fix and regression tests only. Preserve verified daily savings, exact weekly totals, duplicate-bill guards, queue rules and evidenced consequence links. No general causal framework or new features.
- **Coordination:** You are not alone. No main, contracts, dependencies, board/handoffs, env changes, git reset/rebase/merge/push. Commit owned engine files and local Result; report red/green evidence and commit hash.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
