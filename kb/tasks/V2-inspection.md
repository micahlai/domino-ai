# V2: Inspect weekly cash on the timeline

- **Goal:** Move over the chart to see dotted crosshairs, the exact week and cash value; offer the same inspection by keyboard and touch.
- **Folder:** `apps/web/components`
- **Contracts used:** HistoryWeek, Universe, ResilienceReport, ISODate, Cents.
- **Done when:** Company and existing playground timelines inspect recorded and forecast weeks, show guides only with the pointer inside the plot, use only the selected scenario, retain click selection/fix comparison, and pass `pnpm check`, build and browser review.
- **Notes:** Follow design-spec §3.5. Snap to supplied weekly points; never interpolate money. Use the selected forecast, otherwise base. Hovering another curve must not change the inspected scenario. Keep particles and path selection responsive.
