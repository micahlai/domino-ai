# E6b: Real provider adapters and validated output
- **Goal:** Run all five jobs through real Claude/CREAO transports with bounded validated fallback.
- **Folder:** packages/agents only; exception: this card Result.
- **Contracts used:** Agents, ProviderClient, FieldMapping, Constraint, FixCandidate and C1 targets/evidence.
- **Done when:** Injected-fetch tests cover exact requests, extraction, failure/time/size limits, credential-safe redirects and routing; prompts expose schemas; full pnpm check passes.
- **Notes:** Read kb/spec/provider-adapters.md, current provider-feasibility.md, sponsors.md, build-spec9 and existing E6a router. Use native fetch and existing Zod; no new dependencies.
- **Scope:** Provider clients, prompts, createAgents(env), hashInput, safe diagnostics, explicit manual smoke scripts and CREAO instruction files. No actual provider runs by worker.
- **Launch:** Claude Opus/high in ../domino-E6b, E6b-provider-adapters, 30-minute checkpoint. Independent Codex audit before integration/live smoke.
- **Coordination:** You are not alone. No secrets/env reads, other worktrees, contracts, dependencies/lockfile, board/handoffs, live APIs, reset/rebase/stash/merge/push or subagents. Commit owned files and Result.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
