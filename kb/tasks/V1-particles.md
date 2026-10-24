# V1-particles: Restrained timeline particles

- **Goal:** Restrained timeline particles.
- **Folder:** `apps/web/components`
- **Contracts used:** Universe, ResilienceReport, HistoryWeek, PastEvent, Cents, ISODate.
- **Done when:** Existing playground and company timeline show particles emitted across each entire chart path, with emission density proportional to scenario probability; selection and fix morphs stay aligned; motion pauses offscreen/hidden and for reduced motion; bounded rendering passes checks/build and browser review.
- **Notes:** Canvas overlay only, no financial calculations or contracts/backend changes. Cache sampled paths, cap density and pixel ratio, one animation loop, no per-frame React updates. User requests soft embers shed from full-length lines, not moving beads or flashes.
