# TL7X: timeline date and cash scales

- **Goal:** horizontal date ticks and vertical usable-cash ticks make saved timeline curves readable.
- **Folder:** apps/web/components/timeline/workspace/WorkspaceChart.tsx and focused scale helpers/tests in same folder ONLY; this Result.
- **Contracts used:** Forecast, HistoryWeek, ISODate, Cents (unchanged); current chart props/fixtures.
- **Done when:** actual date axis includes recorded/forecast weeks with year context, left cash axis labels currency/units with reasonable ticks and light horizontal guides; no label collision with forecast start/items/rules, other chart interactions intact; responsive internal scrolling and existing playground works; focused tests/fullcheck/build pass.
- **Notes:** user requests horizontal/vertical scale bars on merged TL5 smoke. Read ui-build/taste/design-spec3, existing date/money formatters and apps/web/AGENTS/installed Next guidance. Layout math only; financial labels derive from supplied safe cents, never interpolate cash for selected values. Use sensible domain/ticks, negative/equal cash ranges, no browser engine. No backend/contracts/globalstyles/dashboard/env/services/main/push. Work in supplied TL7-chart-scales checkpoint; lead reviews/browser verifies then integrates into TL5 under this user UI request. No delegation.

## Result
- Done:
- What changed:
- Watch out:
