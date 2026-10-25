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
