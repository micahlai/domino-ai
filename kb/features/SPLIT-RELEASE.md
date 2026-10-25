# Split release (Oct 24)

- Common base: the commit that adds this file on preview/historical-overnight (see `git log -1 -- kb/features/SPLIT-RELEASE.md`). Both `field/main` and `timeline/main` start there.
- Includes: L0-L3, E0, S2 catalog, P0-C (quarterly JSON-text seam), P0-S schema fragments, P0-H harnesses, P0 v2 weekly seam (`packages/contracts/src/weekly-boundary.ts`) and weekly lane ownership.
- Checks at base (lead, uncached, Node 24): contracts 496, engine 344, sim 5, agents 298, web 466 tests; all typechecks incl. convex; lint 307 files; `next build` passes; routes /, /playground, /playground/field-seam, /playground/timeline-seam, /case/2u, /historical, /investigate, /c/kestrel all 200.
- Weekly fixture: validKestrelWeeklySeed contentHash db8ad3dc94f49b962f1763ad005b43cdc07bbbd494f99f1ca07a3018ca25cfab, fixtureHash 36110dba71f77b925a5891a910f634a29501c368c314895f8a09ea826ac4c6ac.
- Ownership: kb/features/field/BRIEF.md, kb/features/timeline/BRIEF.md, apps/web/convex/schemas/*.schema.ts, `node apps/web/scripts/lane-imports.mjs` (18 frozen legacy cross-lane imports; no new ones).
- Audit level: user loosened gates Oct 24 for speed. Quick Codex pass on the weekly contract found 2 P2s, fixed in 4679b75; no re-audit.
- Worktrees: ../domino-field (field/main), ../domino-timeline (timeline/main). Owner prompts: prompts/shared/jayden-field-feature-owner.md, prompts/shared/friend-timeline-feature-owner.md.
