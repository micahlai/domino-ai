# I2-r2: Validate arbitrary nested fix ancestry
- **Goal:** Keep the corrected stale-context guard while allowing valid deeper fix chains.
- **Folder:** apps/web/convex only; exception: this card Result. Continue I2 branch/worktree.
- **Contracts used:** Existing Branch/FixCandidate, engine.scoreFix, C1 ancestry context.
- **Done when:** An unchanged event -> early-payment fix -> hiring fix -> third unique fix succeeds; stale rule/risk/candidate/ancestor changes still reject atomically; full check/build pass.
- **Finding:** c599afa fixes both original blockers, but checkContext at publish.ts 501 requires every stored ancestor in calculate's base/event/one-level-fix map. Valid deeper parents are absent and rejected. Repro: /tmp/domino-i2-r1-nesting-probe.ts. Existing nesting test stops one level too early.
- **Repair direction:** Walk the verified chain root to parent. For a nested fix missing from the generated map, resolve its unique saved candidate from its parent using the exact engine branch ID relation, then rebuild it with engine.scoreFix, the rebuilt parent, and complete preceding changes exactly once. Validate company scope, candidate identity/targets and saved gain; compare the rebuilt assessment with stored data excluding only decision status. Do not merely skip missing ancestors or trust their saved cash. Retain risk comparison, proposal manifest and approval guards.
- **Scope:** No schema/contracts/UI/dependencies/env/provider/deployment changes. Add positive 3-fix-depth and negative stale-depth regressions, not a parallel implementation of engine math.
- **Coordination:** You are not alone. No other checkout edits, secrets, network, subagents, external messages, board/handoffs, pull/rebase/reset/stash/merge/push. Commit owned changes and Result for re-review.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
