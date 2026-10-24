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
- Repair (audit P1/P2 on db6ac41): preview evidence is now filtered by stage (baseline holds only items published by the cutoff). The chart takes an optional backend-supplied `nowcast` (modeled estimate at the cutoff, dashed hollow circle); forecast and alternative both branch from it, so they no longer diverge before Mar 15. With no nowcast the alternative starts at its own first point; the UI invents no cash.
- Tests: apps/web tsc clean, biome clean, vitest components/historical 9 pass (4 new: visible sources by stage, shared branch point, no invented start). No browser, full check or build run.
- Limitations: nowcast is a local view prop and a fixture value; the live packet must supply it (or the alternative stays unanchored). The sheet content is tested via `EvidenceList`, not an opened dialog (no DOM test env). Pre-reveal leaks from a real payload are still reported, not hidden, by the component. Commit SHA: see `git log -1 H3-historical-ui`.
