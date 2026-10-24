# V3: Timeline scales and event details

- **Goal:** Replace Inspect week with time/cash scale controls and open event details when a recorded marker is clicked.
- **Folder:** `apps/web/components/multiverse`
- **Contracts used:** HistoryWeek, PastEvent, Universe, ResilienceReport, ISODate, Cents, Evidence.
- **Done when:** Existing playground and company charts offer horizontal/vertical scaling with reset; Inspect week slider is gone; crosshair remains pointer-only and selected-scenario-only; event clicks open an accessible dismissible popup with date/details/proof. `pnpm check`, build and browser review pass.
- **Notes:** design-spec §3; use existing shadcn Dialog/Sheet and semantic colors. Keep curve selection, particle caps, reduced motion, clipping, axis readability and narrow screen scroll intact. Do not calculate money or invent event explanations. Stay in this worktree; no main merge.
