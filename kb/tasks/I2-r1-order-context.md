# I2-r1: Preserve proposal order and reject stale assessments
- **Goal:** Resolve the two reproduced audit blockers before computed prototype deployment.
- **Folder:** apps/web/convex only; exception: this card Result. Continue existing I2 worktree/branch.
- **Contracts used:** Existing I2 functions and schemas, no schema/contract changes.
- **Done when:** Both review probes become regression tests, full check/build pass, unchanged reruns write nothing and preserve decisions.
- **Notes:** Read kb/reviews/I2-7488d52.md and kb/spec/computed-prototype.md. Tests must assert caller order, never sort the expected proposals to match implementation.
- **Order repair:** Preserve explicit first-seen proposal order. Persist the useful-proposal ID sequence separately from per-branch display ranking, using an engine.proposal-order log entry with ordered refs (no schema change). On rerun resolve saved payloads in manifest order; append genuinely new explicit IDs in caller order. Reject conflicting duplicate IDs or missing referenced payloads instead of guessing. Do not write another manifest on unchanged retry. Discarded nowhere-useful proposals need not remain in the manifest. Existing deployed computed data does not exist yet; never infer missing order from ranked rows.
- **Context repair:** Reject simulateFix when the parent or its ancestry's current assessment differs, including current dominoes and known risk definitions/probabilities that can change without cash changes. Rebuild full ordered context once, with the correct parent baseline for each branch. Reject before saving; leave every table unchanged. Do not silently refresh only the child. Keep valid nested ancestry support and decided-branch protection.
- **Minor:** Correct the seed Nessie source base URL to https://prod-api.nessieisreal.com. No live calls or deployment.
- **Coordination:** You are not alone. No other checkouts, UI, env, dependencies, board/handoffs, subagents, pull/rebase/reset/stash/merge/push. Commit owned changes and Result for independent audit.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
