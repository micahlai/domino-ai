# H3: Historical replay UI
- **Goal:** Preserve the existing chart while exposing load, frozen forecast, disclosure reveal, comparison, one alternative and proof.
- **Folder:** apps/web/app/, apps/web/components/, apps/web/lib/; exceptions this Result and kb/coordination/historical/ui-status.md. No Convex/contracts/manifests/lockfile/env edits.
- **Contracts used:** Frozen H2 packet; existing UI primitives. Before freeze, props-only labelled preview fixtures; never invented shared APIs.
- **Done when:** Playground and existing route regression checks pass; observed/projected/assumed values and dates distinguishable; keyboard/mobile/reduced-motion verified; pnpm check/build pass; live flow and reload verified when isolated backend is ready, otherwise explicitly incomplete.
- **Notes:** Follow prompts/product/H3-historical-ui.md and ui-build/taste skills. No financial math, weekly actual reconstruction, new canvas, extra particle work or wiring to operational week/connect placeholders.
- **Handoff:** Push H3-historical-ui with exact dependency SHAs and verified versus fixture-only states; lead assembles preview. Preserve P5 interfaces and old routes.
## Result
- Done: props-only historical replay (dates, chart on report dates, evidence, comparison, one alternative, loading/error/unavailable) and a labelled synthetic playground preview. Live wiring pending; no backend packet adopted.
- Files and commit: apps/web/components/historical/*, Playground.tsx, five ui/ import lines, kb/coordination/historical/ui-status.md. Commit SHA: see `git log -1 H3-historical-ui`.
- Verification: apps/web tsc, biome on components, vitest (103 pass, 5 new). No browser or full check/build run; chart look unseen.
- Watch out / next: see ui-status.md "Pending for live wiring". Fixture values are invented, not 2U.
