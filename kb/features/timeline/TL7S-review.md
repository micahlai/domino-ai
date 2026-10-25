# TL7S independent source audit

Source repair accepted at stable `34053b7`, reviewed against `53ea673`. Initial `53ea673` acceptance was withdrawn after lead browser found a connected-render blocker: comparisonQueries changed identity every render. The repair memoizes on companyId and the three bounded primitive comparison IDs, retaining subscription identity when selected IDs are unchanged. Existing Convex useQueriesHelper/useSubscription source confirms why this removes the render-phase loop. Final actual connected browser acceptance remains with lead. Earlier structural/source checks remain valid; they did not initially cover subscription rerenders.

Scope: workspace UI only plus author task Result. No backend/schema/contracts/engine/provider/env/services/TL5/main/push changes. Uses existing workspace:get/graph and strict existing readRun parser. Comparison reader additionally pins baseline, imported seed hash, exact 13 forecast week dates. Money values come from saved forecasts and metadata; new arithmetic is drawing geometry, selection bounds and tree indentation only.

Selected IDs deduplicate current and one another and cap at3. All noncurrent forecast reads, including parent, now use that one selected-only query set. Parent/current curves cannot be drawn twice. Only ready validated curves draw and appear in legend. Current saved record is added independently when absent from capped/unavailable graph. Sidebar scopes entries to company and baseline, caps nesting/missing/cycles, warns on100 graph cap, offers all-company catalog, distinguishes open navigation from read-only compare controls, exposes loading/failure notices and clear action. Saved rule-version differences are disclosed. Strong current curve draws above quiet dashed comparison paths; paths and matching legend links open saved runs with accessible names. Sidebar labels clamp and wrap unbroken text; duplicate names show saved timestamps.

Two review repairs completed before acceptance:
1. Added arbitrary-word wrapping/current-label clamp and full title to avoid long-name overflow.
2. Removed unconditional parent read that could create4 loaded comparison forecasts when3 siblings were selected.

Independent verification at stable commit:
- Checked-in focused tests:49 passed (6 new comparison tests and43 existing workspace tests).
- Scratch tests `/tmp/TL7S-review/sidebar-audit.test.tsx`:4 passed. Covered rejected shortened/different calendars, wrong identity/seed, unsafe/fractional cents, accepted fractional runway units; error propagation; current node fallback for loading/error/missing/unusable graph; unrelated-family filtering; cap/removal controls; no hidden legacy parent curve and matching drawn-parent legend.
- `git diff --check 3f20f41..53ea673` passes.
- Author reports complete `pnpm check`:1948 tests, five package typechecks, lint385 files. Lead should record its own integrated full check.

Nonblocking browser taste point: duplicate sidebar names include saved timestamp, while compact legend repeats the original labels. Check each link opens the intended saved node. No independent browser/session/service actions performed.

## Connected render regression audit

Independently reproduced the loop with installed Convex useQueriesHelper and a deliberate one-time React render-phase state update in scratch SSR. Unmemoized query object throws Too many re-renders; memoized query object renders. Scratch suite now5 tests, passing including expected pre-fix failure. Correct repair must stabilize queries on company and primitive selected-ID dependencies; the selectedComparisons array itself is recreated each render and is not a stable memo dependency. Stable repair `34053b7` inspected and source accepted. Re-ran49 checked-in focused tests and5 scratch tests: all pass; full diff check3f20f41..34053b7 passes; author worktree clean. Author reports full pnpm check1948 tests/typechecks/lint385 passed after repair. This scratch regression tests installed Convex behavior, not actual RunReady connected mounting; lead live browser rerun remains required.
