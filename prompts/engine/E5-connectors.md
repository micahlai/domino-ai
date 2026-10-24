# E5 · Connectors + tie-out (Jayden)

Tool: Claude Code. Branch: `E5-connectors`. Folder: `apps/web/convex/connectors/`. Depends on: E2, P2.
Skill files (in skills/): kb-sync.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md. Read AGENTS.md, kb/spec/build-spec.md §8, kb/spec/convex-api.md.

In apps/web/convex/connectors/ (Convex actions; do not edit schema.ts, ask Micah via kb/requests.md if needed):
1. One module per source: stripe.ts, crm.ts, cards.ts, books.ts, payroll.ts, docs.ts (all our mock servers via
   MOCKS_BASE_URL + MOCKS_API_KEY) and nessie.ts (Nessie API). Each takes a base URL, so a real API can replace a mock later.
2. Each one: pull raw records, apply the saved FieldMapping[] from the sources table (applyMapping in
   connectors/mapping.ts: dotted field paths, dollars-string to cents, date normalisation), then parse with the
   canonical Zod schemas. Records that fail parsing are counted and logged, never silently dropped.
3. buildSnapshot.ts: merge all sources into one Snapshot (cashOnHand from Nessie balance; restrictedCash from the
   constraints/documents step if known, else 0 and flagged).
4. tieOut.ts: Stripe payouts last 4 weeks vs Nessie deposits from Stripe, within 1%. Write "ok" or "needs_review" to sources.
5. Until E6 is merged, use the reference mappings from packages/sim/src/eval/trueMappings.ts ONLY behind a
   DEV_USE_TRUE_MAPPINGS=1 flag, so the UI can move on. Remove the flag use from the demo path once E6 works.

Tests: applyMapping unit tests (cents conversion, nested paths); buildSnapshot on recorded sample responses
(save samples in connectors/__samples__/).
When done: pnpm check passes, board row E5, handoff.
```
