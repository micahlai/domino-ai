# E3a: Deterministic forecast and scenario changes
- **Goal:** Compute a trustworthy 13-week cash schedule; first slice of E3, not the full domino engine.
- **Folder:** `packages/engine/` only; exception: this card's Result section.
- **Contracts used:** `Engine.forecast`, `Snapshot`, `CompanyModel`, `Change`, `ForecastSchema`.
- **Done when:** `src/forecast.test.ts` covers balances, restricted cash, paid/unsigned exclusions, UTC boundaries, all eight changes, critical-bill rejection, input immutability and ambiguous deal rejection; package tests and `pnpm check` pass.
- **Notes:** Read `skills/engine-tdd/SKILL.md`, build-spec §§6.1/6.7 and `kb/tasks/launch-plan-2026-10-24.md` (shared rules and E3a). Use `fixtures.snapshot/model` plus small independently calculated cases, never fixture forecast arrays as an oracle.
- **Scope:** Keep public contracts fixed; use an internal dated cash schedule for changes. Wire only `engine.forecast`; leave other methods explicitly unbuilt. No new dependencies.
- **Launch:** Codex, GPT-6.1 Sol, high; branch `E3a-forecast`, sibling worktree `domino-E3a`. Offline S0 gate only; 90-minute limit, then report/split.
- **Coordination:** You are not alone. Preserve others' changes; do not edit board, handoffs, contracts, shared lockfile or other cards. Report contract needs in Result.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
