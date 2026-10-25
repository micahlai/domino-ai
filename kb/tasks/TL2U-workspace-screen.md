# TL2U: interactive saved Timeline workspace

- **Goal:** user selects saved data, edits rules, adds explicit or prompt-proposed events, compares and reopens saved scenarios through TL4.
- **Folder:** apps/web (ONLY components/timeline/workspace/**, components/timeline/baseline/BaselineLive.tsx, app/c/[companyId]/timeline/** and components/timeline/seam/TimelineSeamHarness.tsx if needed; no backend files).
- **Contracts used:** Change, Constraint, Forecast, HistoryWeek, WeeklySeedV1, OperationSummaryV1, baseline SavedBaseline; validate wire with Zod.
- **Done when:** playground entry + working route, SVG history/13-week chart/selectable items, rule editor, event form, evidence/violation panels, question proposal/confirmation/clarification/failure, paginated catalog/ancestry/reopen. Tests verify boundary states, confirmation reset and stable retry. Typecheck/check pass; screenshot review is lead's integration gate.
- **Notes:** read skills/ui-build and design spec. Follow frozen local interface kb/features/timeline/TL2-TL5-interface.md. Backend/questions workers run concurrently; use typed name refs and local projection schemas, no backend runtime imports. Reuse baseline formatting and shared UI primitives. All financial values/deltas server-produced; no engine/math in UI. Skip components/timeline/dashboard/Dashboard.tsx. No shared styles/schema/contracts, no runtime/env/provider calls. User authorizes parallel implementation. Commit TL2/TL3/TL4 screen steps; no merge/push. Don't wait for backend: wire exact interface with test fixtures.

## Result
- Done:
- What changed (files):
- Watch out:
