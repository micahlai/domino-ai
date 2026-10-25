# Field swarms takeover, 2026-10-25

- Branch: `field/swarms` in `../domino-field-swarms`, based on engine commit `8857294`.
- Implemented bounded audit checkers, bounded forecasters, cash-minimum advisors with suggestion records, and an Apify Store toolbox with shared run caps. Suggestions record a person's decision only.
- An audit pending marker preserves the committed snapshot, previous snapshot and tie-out inputs until every checker and the forecast recompute finish. A failed checker leaves the version retryable; a newer snapshot waits. Findings and retry phase/count commit together.
- Advisor writes require the latest active analyst run and current snapshot. Recommendations and person decisions require the exact run and snapshot version seen. Website crawl cache keys include company, actor and URL.
- Verification: web and Convex TypeScript checks pass; agents TypeScript and advisor tests pass (3/3); authored-file Biome passes; final web Vitest passes (87 files, 1,145 tests); `pnpm --filter @domino/web exec next build --webpack` passes. The default Turbopack build failed in this environment when binding a worker port, after an earlier sandboxed attempt could not fetch Inter.
- CREAO advisor role is `field_advisor@creao-3e8215ca6876`. It needs a separately verified app/profile pair in `DOMINO_CREAO_VERIFIED_PROFILES` before live recommendation. No profile was marked verified and no live provider call was made. Engine suggestions remain available without it.
- No isolated runtime was started here. The integration owner will run combined smoke in its own backend and UI.
