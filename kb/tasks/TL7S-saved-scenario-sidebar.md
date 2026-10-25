# TL7S: saved scenarios beside and on the timeline

- **Goal:** user browses saved scenarios in a sidebar and sees a few real saved scenario curves on the cash timeline without clutter.
- **Folder:** apps/web/components/timeline/workspace ONLY, plus this Result.
- **Contracts used:** Forecast, HistoryWeek, WeeklyResultRefV1, existing WorkspaceRun/CatalogEntry and workspace:get/graph; no schema/backend changes.
- **Done when:** desktop sidebar lists saved baseline family with current item, search/clear labels, parent nesting; compact mobile disclosure; timeline draws at most3 other saved curves with selected scenario emphasized, toggle/remove comparisons and accessible click/open links; real saved forecasts only; focused tests + pnpm check; existing WorkspacePlayground demonstrates it.
- **Notes:** read ui-build/taste, design-spec §3/build-spec §2. Codex authorized by user. Work in supplied separate worktree/branch. TL5 remains597fcc0 on3107/3240 untouched. No Dashboard/nav/styles/contracts/engine/backend/env/services edits or push. Existing graph has metadata only: load at most3 comparison forecasts via existing query, validate with readRun/company/baseline and preserve quiet reads. Do not invent curves from low points or graph ancestry dates. Reuse props-only chart + existing UI primitives; disclose100-row graph cap and all-company catalog link. Avoid unrelated forms refactor. Lead handles independent review/browser/integration on3108.

## Result
- Done:
- What changed:
- Watch out:
