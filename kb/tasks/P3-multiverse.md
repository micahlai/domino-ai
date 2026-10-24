# P3: Interactive multiverse timeline

- **Goal:** The playground shows the past and all futures, with selectable lines and animated fix comparisons.
- **Folder:** `apps/web/components`
- **Contracts used:** Cents, ISODate, Id, HistoryWeek, PastEvent, Universe, ResilienceReport, BreakingPoint.
- **Done when:** design-spec §3/§4 timeline and resilience bar work with fixtures; pnpm check/build pass; browser verifies selection, fix toggle, responsive layout and reduced motion.
- **Notes:** Implement in multiverse/ with compatibility exports at existing component paths. Update Playground with fixtures.resilience, resilienceWithFixes, history, pastEvents. Geometry is display-only; no financial calculations or contract/schema edits.
