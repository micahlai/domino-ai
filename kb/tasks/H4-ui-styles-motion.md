# H4: Clean reusable UI, four styles and real activity motion
- **Goal:** Switch among Original, Ramp, Hyphenate and shadcn without changing financial state, with meaningful live activity transitions.
- **Folder:** apps/web/app/, apps/web/components/, apps/web/lib/; exceptions this Result and kb/coordination/historical/ui-styles-result.md. No backend/manifests/env edits.
- **Contracts used:** Frozen historical and optional activity packet from H2; shared existing UI primitives. No invented live APIs or fake product agent events.
- **Done when:** Four styled views and selector work; state/persistence/invalid inputs and event dedupe/order checked; same-state screenshots desktop/mobile; keyboard/reduced-motion/portals verified; pnpm check/build pass; live versus preview activity documented.
- **Notes:** Follow prompts/product/H4-ui-styles-motion.md and kb/spec/ui-styles-motion-2026-10-24.md. Reuse installed shadcn/Radix/Motion, preserve current look by default, no four duplicated app trees.
- **Handoff:** H4-ui-styles-motion in ../domino-H4 from accepted H3 SHA after UI ownership release. Publish exact commit and reference fidelity report to C0; no main merge.
## Result
- Done (H4a styles checkpoint only): style registry, four token sets, header selector, localStorage + validated `?style=` (URL wins, not stored), pre-paint SSR script, portal/canvas colors, `--primary-ink`, chart heading overlap fix. Not done: comparison playground, activity motion, screenshots.
- Files and commit: see kb/coordination/historical/ui-styles-result.md. Commit: styles checkpoint on H4-ui-styles-motion (SHA from `git log -1`).
- Verification: tsc, biome, vitest (115 pass) in apps/web. No browser/build/full check run (C0).
- Watch out / next: C0 browser pass for all four styles (contrast, mobile, hydration, header wrap at 375px, label overlap). Visual refs: hex values read directly from ramp.com and hyphenate.ai CSS; layout/density inferred. Activity: no live/fixture events, waits on accepted H2 schema.
