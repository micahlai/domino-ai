# E6 · Agents: CREAO + Claude adapters (Jayden)

Tool: Claude Code. Branch: `E6-agents`. Folder: `packages/agents`. Depends on: S0.
Skill files (in skills/): kb-sync.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md. Read AGENTS.md, kb/spec/build-spec.md §9, and the Agents interface in packages/contracts/src/modules.ts.

Implement packages/agents:
1. src/claude.ts: all five jobs with the Anthropic TypeScript SDK (ANTHROPIC_API_KEY, ANTHROPIC_MODEL).
   Use tool-use / JSON output with the Zod schemas converted to JSON schema (zod-to-json-schema).
2. src/creao.ts: mapSource, readConstraints, weeklyBrief through the CREAO agent API (CREAO_API_BASE_URL,
   CREAO_API_KEY, CREAO_AGENT_ID_*). FIRST, find the real API from the CREAO docs/starter pack and write what you
   found in kb/research/sponsors.md (endpoints, auth, how to pass input, how to get output, typical latency).
   If you cannot confirm the API, stop and tell me; keep the Claude version working.
   Also write the system instructions to paste into each CREAO agent on agent.creao.ai in
   packages/agents/creao-agents/<job>.md (what it receives, JSON it must return, rules).
3. src/index.ts: createAgents(env) returns an Agents object that routes each job by AGENT_BACKEND_<JOB>.
   Every result is parsed with Zod; on failure retry once, then fall back to Claude. Log which backend answered.
4. Prompts (src/prompts/*.ts): follow §9.2. Agents return Change objects and evidence; they never calculate money.
   explain: max 3 sentences, plain words, names the week and amount (design-spec §6 words).
5. A small cache helper keyed by a hash of the input (the Convex side stores it; here just export hashInput()).

Tests: routing by env; Zod rejection triggers retry then fallback (mock the clients); prompt builders include the
contract JSON schema. Add a manual script (pnpm --filter @domino/agents try:<job>) that runs one real call against
fixtures and prints the result.
When done: pnpm check passes, board row E6, handoff with the CREAO findings.
```
