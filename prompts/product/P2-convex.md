# P2 · Convex schema, queries, mutations (Micah)

Tool: Claude Code or Codex ("Codex OK"). Branch: `P2-convex`. Folder: `apps/web/convex` (not connectors/ or actions/). Depends on: P1.
Skill files (in skills/): kb-sync.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md. Read AGENTS.md and kb/spec/convex-api.md (this is the contract).

1. apps/web/convex/schema.ts: every table and index in convex-api.md. Large objects (Snapshot, Branch, ResilienceReport...) as v.any()
   and parse with the Zod schemas from @domino/contracts in a small helper (convex/lib/parse.ts) when read or written.
2. Queries and mutations exactly as named in convex-api.md. Mutations validate inputs with Zod (Change[] for events.add).
   Mutations that need heavy work only schedule the action names from convex-api.md (Jayden implements those);
   create placeholder internal actions that throw "not built" so scheduling compiles.
3. convex/dev/seedFixtures.ts: an internal mutation that loads @domino/contracts/fixtures into every table for a
   company "kestrel" (branches, risks, fixes with gains, resilience with and without fixes, history, past events, constraints, model).
   Add a root script "pnpm convex:fixtures" that runs it. The UI uses this until real data flows.
4. Tests: a few query/mutation tests with convex-test if quick; otherwise test the Zod parse helper.

When done: pnpm check passes, data from fixtures visible in the Convex dashboard, board row P2, handoff.
```
