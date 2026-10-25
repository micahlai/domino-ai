# TL2B-R1: close independently reproduced workspace boundaries

- **Goal:** all accepted request ids are immutable bindings and relative events cannot move cash into history or run unbounded loops.
- **Folder:** apps/web/convex (same TL2B whitelist; may add timelineRunRequests or equivalent Timeline-owned receipt table in schemas/timeline.schema.ts and composition expectation).
- **Contracts used:** same TL2B shared types and read-only engine schedule/evaluator; no shared edits.
- **Done when:** focused original + independent probes pass, pnpm check + Convex typecheck pass, exact request alias conflicts/date/loop regressions covered.
- **Notes:** read /tmp/tl5-audit/review.md and original TL2B card. Fix: bound shift_hire exclusive toDate <= horizonEnd+1 BEFORE engine loop; bind alias open requests atomically (reused root cannot leave accepted key reusable for different inputs or operation); validate effective relative invoice/bill cash dates against frozen model + cumulative changes (e.g -366 days currently rewrites into history). Preserve intentional delay past horizon when it removes in-horizon cash; reject nonexistent/no-remaining-cash targets or changes entirely ignored. Prefer shared schedule semantics, no duplicate financial math. Parent unable must not imply newly caused breach. All actionLabels represent the scenario as a group, not individual causal proof. Update Result, commit on existing TL2-events-backend, no service/env/main/push. Do not delegate.

## Result
- Done:
- What changed:
- Watch out:
