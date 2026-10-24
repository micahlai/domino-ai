# E1a: Seeded Kestrel data and summary
- **Goal:** Generate reproducible Kestrel input with 26 weeks of dated history and a useful summary CLI.
- **Folder:** `packages/sim/` only; exception: this card's Result section.
- **Contracts used:** `Simulator.createCompany`, `CompanyProfile`, `WorldStateSchema`, `SnapshotSchema`, `PlannedEvent`.
- **Done when:** `src/create.test.ts` proves seed reproducibility/variation, 26 Monday-bucket history, cash reconciliation, unique IDs, valid references, 18-24-day Acme mean and schema validity; `pnpm sim:print` prints a real summary; package tests and `pnpm check` pass.
- **Notes:** Read `skills/engine-tdd/SKILL.md`, build-spec §7 and `kb/tasks/launch-plan-2026-10-24.md` (shared rules and E1a). Reuse customer IDs/names from `fixtures.snapshot`; profile amounts are stated demo assumptions.
- **Scope:** Seeded RNG, Kestrel profile, `createCompany`, package-local print CLI/tests; leave `advanceWeek` and `answerKey` explicitly unbuilt, reject unbuilt profiles. No engine dependency, EDGAR claims or mock servers.
- **Launch:** Codex, GPT-6 Sol, high; branch `E1a-kestrel`, sibling worktree `domino-E1a`. Offline S0 gate only; 90-minute limit, then report/split.
- **Coordination:** You are not alone. Preserve others' changes; do not edit board, handoffs, contracts, shared lockfile or other cards. Report follow-ups in Result.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
