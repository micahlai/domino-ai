# H3 UI status

State: presentation checkpoint only. Live wiring is pending. Branch H3-historical-ui, worktree ../domino-H3.

## Dependencies adopted
- None. No backend packet read or adopted (H2 contract-v1.md was not frozen/available to this phase). No contracts, engine, Convex, API, env or dependency changes.
- Types come only from existing `@domino/contracts` `Cents` and `ISODate`.

## What exists (all props-only)
- `apps/web/components/historical/types.ts`: local view props (not shared schemas). Live adapter will map the frozen packet onto these.
- `HistoricalReplay.tsx`: journey steps, date facts (cutoff, last reported, projected through, disclosure published), chart, point evidence panel, sources sheet, saved-versus-reported table, one alternative card, loading/error/unavailable states.
- `HistoricalChart.tsx`: SVG on real report dates (d3 UTC scale). Reported = filled dot, projected = hollow diamond on a dashed path, alternative = clay. No line joins reported points, no weekly points, optional labelled assumption range (not a probability). Points are keyboard-focusable buttons. Motion only on mount, off under reduced motion.
- `preview.ts`: invented "Example Co" fixture. Every value is synthetic and never real 2U history.
- Playground: new `HistoricalReplay` section with a labelled preview-state switcher. It saves and reveals nothing.
- `ui/{badge,card,sheet,skeleton,table}.tsx`: one-line import change `@/lib/utils` -> relative so Vitest can render them (button.tsx already did this). No visual change.

## Verified vs not
- Verified: `tsc --noEmit` (apps/web), `biome check apps/web/components`, `vitest run` in apps/web (103 pass, 5 new in components/historical).
- NOT verified: any browser view (no server started per instructions), desktop/mobile layout, keyboard in a real browser, evidence sheet open state, reduced-motion in a browser, reload. Chart appearance is unseen. Full `pnpm check` and `pnpm build` not run (C0 schedules).
- Fixture-only: every state. Live: none.

## Repair after audit (P1/P2)
- Preview evidence filtered by stage; baseline sources contain nothing published after the cutoff.
- `HistoricalView.nowcast` (optional, backend-supplied cents): modeled estimate at the cutoff. Forecast and alternative both branch from it. Drawn as a dashed hollow circle, distinct from reported dots and projected diamonds.
- Ask for H0/C0: the packet must provide a cutoff nowcast, or alternatives stay unanchored in the chart.

## Pending for live wiring
1. Frozen H2 packet (exact types, historical endpoints, example payloads, SHAs); API-ready closure adopted before wiring.
2. Adapter from the packet to `HistoricalView`. Backend must supply signed `difference`, `outcome`, alternative cost/benefit/downside and range bounds as cents; the UI does no financial math.
3. Production pre-reveal payload must omit observed/comparison/alternative. The component draws whatever it is given, so a leak would show. Report it, do not hide it.
4. Reveal/save actions, progress and error states (the component has display states only, no actions).
5. Route and `CompanyScreen` placement. Old routes untouched.

## Questions for H0/C0
- Does the backend give `difference` as reported minus forecast? The table header assumes it.
- Is a forecast assumption range (low/high) in the packet? The chart draws it only if present.

## Handoff to H4
Release UI ownership at the checkpoint commit. Semantic tokens only (`primary`, `clay`, `destructive`, `muted`, `border`); no theme code added.
