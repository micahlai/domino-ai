# I2: First computed Convex prototype
- **Goal:** Persist real E3/E4 results for a separate demo company and let existing event/fix actions work.
- **Folder:** apps/web/convex only; exceptions: this card Result and generated API files from CLI.
- **Contracts used:** Existing engine methods, C1 contexts, Branch/RiskEvent/FixCandidate and Convex API references.
- **Done when:** Convex integration tests prove computed reports/branches, idempotency, ancestry once, approvals preserved, cross-company rejection and coherent writes; pnpm check/build pass.
- **Notes:** Read kb/spec/computed-prototype.md, convex-api.md, local AGENTS and main's convex/_generated/ai/guidelines.md. No UI, schema or shared contracts changes.
- **Scope:** engine.recompute/addEvent/simulateFix, transactional helpers, separate create-once dev seed and tests. Connectors, live agents, week.advance and legacy backfill stay follow-ups.
- **Launch:** Claude Opus/high in ../domino-I2, I2-computed-prototype; 30-minute checkpoint, direct user authorization.
- **Coordination:** You are not alone. No env, dependencies, other worktrees, board/handoffs, pull/rebase/reset/stash/merge/push. Do not deploy or seed a running database. Commit owned changes and Result; Codex reviews/integrates.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
