# E6a: Provider feasibility and validated job routing
- **Goal:** Establish the provider contract and test job routing without depending on credentials or an invented CREAO API.
- **Folder:** `packages/agents/` only; exception: this card's Result section.
- **Contracts used:** `Agents`, `AgentJob`, `AgentBackend`, `FieldMappingSchema`, `ConstraintSchema`, `FixCandidateSchema`; string schemas for text jobs.
- **Done when:** `src/routing.test.ts` verifies five-job defaults/overrides, output validation, bounded retry/fallback and final failure; `provider-feasibility.md` cites primary docs or says unconfirmed; package tests and `pnpm check` pass.
- **Notes:** Read build-spec §9, `fixtures.branches/snapshot/model`, and `kb/tasks/launch-plan-2026-10-24.md` (shared rules and E6a). Existing all-Claude default conflicts with the spec.
- **Scope:** Injected provider clients returning unknown, validated `Agents` facade, capability report; no production adapters, new dependencies, lockfile edits, live paid calls or fake API endpoints.
- **Launch:** Codex, GPT-6 Sol, high; branch `E6a-agent-feasibility`, sibling worktree `domino-E6a`. Offline tests plus public docs; 60-minute limit, then report/split.
- **Coordination:** You are not alone. Preserve others' changes; do not edit board, handoffs, contracts or other cards. Record sponsor findings and dependency requests in Result for the brain.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
