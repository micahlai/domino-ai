# TL1U: import and reopen baseline

- **Goal:** User loads the labelled weekly fixture, reviews assumptions, saves and reopens its forecast.
- **Folder:** `apps/web/components/timeline` only (existing TimelineSeamHarness is playground entry).
- **Contracts used:** WeeklySeedV1, CompanyModel, Constraint, Forecast, HistoryWeek, PastEvent; TL1B results.
- **Done when:** /playground/timeline-seam saves a real baseline and opens by stable runId URL parameter; reload preserves result; errors visible; render checks/check/build/browser pass.
- **Notes:** ../features/timeline/TL1-implementation.md; ui-build/taste; no shared UI or route modifications. Depends TL1B.

## Result
- Done:
- What changed (files):
- Watch out:
