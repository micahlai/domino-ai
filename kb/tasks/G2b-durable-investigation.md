# G2b: durable investigation and conversation

- **Goal:** server-owned, browser-independent investigation turns persist messages, real operations, frozen evidence and financial output refs, ready for the canvas and verified CREAO provider.
- **Ownership:** apps/web/convex/** (including schema/generated files/tests), new apps/web/lib/investigation-contract.ts if needed; apps/web/package.json + pnpm-lock.yaml only for existing workspace agents dependency; this card Result and kb/coordination/historical/investigation-api.md. No UI, contracts/agents/engine/evidence/shared coordinator docs edits.
- **Dependency:** accepted G2a9d7d6e6/2db9a8b, combined preview77127d3 passes919tests. R1 other computer owns all components/investigate/** and app/playground/agent-canvas/**; never touch them.
- **Done when:** submit idempotency, durable queued/running/terminal operations, conversation reload, cross-conversation isolation, frozen cutoff/no future-history leak, reveal/alternative user gates, failure without false success and bounded provider dispatch all pass focused tests. Document exact API packet; Codex runs full check and isolated live smoke.
- **Notes:** spec creao-canvas-cycle.md, canvas-reuse.md, canvas-ui-packet.md and G2a audit. CREAO required for final acceptance; no claim current Claude specialist is CREAO. Current app-scoped key cannot use account-only APIs. Do not add an invented CREAO adapter. A future verified provider plugs into one narrow dispatch point; explicit Claude development mode may reuse accepted entry but no silent fallback or default success. Missing provider is a persisted honest failure.
- **Bounds:** one initial2U investigation, explicit reveal, one costed alternative, two specialist calls max per journey until explicit coordinator budget addition; no autonomous scheduler loops, new company, newtools or live network by worker. Source-change/scheduled trigger entry must dedupe on supplied source version and select only actual new eligible evidence; do not fabricate a changed source. No hosted/cloud deploy/reset. Read detailed launch prompt.

## Result
- Done:
- API/files/checks:
- Limits:
