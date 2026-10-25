# P0-S: independently owned persistence fragments
- **Goal:** both features extend their own tables without editing one shared schema file after the fork.
- **Owner:** one Claude backend worker after current S2 writer/index checkpoint; Codex audits independently.
- **Folder:** apps/web/convex only, plus this Result; schema.ts and three schema fragments with narrowly necessary schema tests.
- **Contracts used:** current stored validators/table/index definitions, unchanged public historical/investigation interfaces.
- **Done when:** existing rows/validators/indexes/API names preserved, table names disjoint, composed schema typechecks and existing backend tests pass; S2 index is reviewed/in shared base; no database mutation/reset/deploy.
- **Notes:** ../spec/independent-feature-lanes.md. Resolve missing generated Convex guide first. Inspect module-layout support; record exact paths. Do not implement L5/S4 or duplicate S2. Freeze root composition after audit.
## Result
- Prepared, not assigned or implemented.
- Changed files/checks/limits:
## Lead decisions (Oct 24, from read-only scout kb/reviews/P0S-prep-scout.md)
- Order: friend S2 (adds by_case_createdAt) is audited and integrated FIRST; P0-S branches from that base. P0-S must not add that index itself.
- Convex guide: read in place at ../domino-ai/apps/web/convex/_generated/ai/guidelines.md (convex 1.48.0). Do NOT run `npx convex ai-files install` (network, rewrites tracked AGENTS.md).
- Fragment files: apps/web/convex/schemas/{legacy,timeline,field}.schema.ts (two dots, so the Convex bundler skips them and api.d.ts does not change). Root schema.ts spreads the three fragment consts into defineSchema without widening types.
- Ownership: legacy 14 tables shared core (frozen); Timeline = historicalRuns, historicalReveals, historicalRevealReceipts, historicalActivity; Field = investigationRequests, investigationConversations, investigationMessages, investigationOperations. Seams to document, not change: investigation.ts writes historicalRuns via historical.ts helpers (owner column); S2 catalog reads Field tables.
- Verification: tsc (web + convex), web vitest, biome on apps/web/convex. Never run convex dev/codegen/deploy/run or touch 3102/3210/3214.
