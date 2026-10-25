# Judge flow acceptance, Oct 25

- Branch: `field/judge-simple`. Completed the abandoned three-step company health, source selection and live map flow with Play/Pause, three surprise presets, reset and CSV access.
- Review fix: surprise presets require their actual data sources (Stripe for late customer, QuickBooks for a bill); UI and backend share the same requirements.
- Checks: web and Convex tsc pass; changed-file Biome pass; full web Vitest 1,143 tests pass; after the source guard fix, focused21 judge tests pass. `pnpm --filter @domino/web build --webpack` passes. Default Turbopack build failed on Google font network access, then on its worker port permission; webpack is the supported fallback, no app workaround added.
- Isolated smoke: backend3290/3291, Next3130. Browser created cash-crunch Judge Co.12, map read six sources, engine verdict At risk; unexpected750,000-dollar bill ingested and lowered projected cash; Play advanced days and Pause stopped the clock. Screenshot `/tmp/field-judge-smoke.png`.
- These are isolated test records. No live3114/3260 data or protected ports changed. Lead owns cleanup and final combined smoke.
