# P3: Interactive multiverse timeline

- **Goal:** The playground shows the past and all futures, with selectable lines and animated fix comparisons.
- **Folder:** `apps/web/components`
- **Contracts used:** Cents, ISODate, Id, HistoryWeek, PastEvent, Universe, ResilienceReport, BreakingPoint.
- **Done when:** design-spec §3/§4 timeline and resilience bar work with fixtures; pnpm check/build pass; browser verifies selection, fix toggle, responsive layout and reduced motion.
- **Notes:** Implement in multiverse/ with compatibility exports at existing component paths. Update Playground with fixtures.resilience, resilienceWithFixes, history, pastEvents. Geometry is display-only; no financial calculations or contract/schema edits.

## Screenshot review

The three main fixes were to render geometry in the first HTML, keep all four cash ticks inside the plot, and give keyboard users a future selector plus recorded event controls. The revised black/brown, green, pink and orange theme is used throughout. Desktop and 390 px reviews pass; the narrow chart scrolls inside its panel.

Verification: `pnpm check` (61 tests) and `pnpm build` pass. Five chart regression tests cover stable comparison scales, risk-key matching, empty data, 30 futures, and reduced-motion first HTML. No measured 60 fps claim.
