# T1: timeline comparison controls
> Superseded as the whole friend assignment by ../features/timeline/BRIEF.md. Optional internal subtask after accepted P0; old sole-UI/global-dispatch restrictions below describe the earlier bounded plan. Use ../spec/independent-feature-lanes.md for current ownership.
- **Goal:** users isolate available forecast/observed/alternative series and inspect exact points without changing saved financial data.
- **Owner:** friend; sole UI writer while active. Claude lead assigns after verifying any S2 session is safely checkpointed/stopped. S2 remains friend-owned, never duplicated.
- **Folder:** apps/web/components/historical only: HistoricalChart.tsx/test and HistoricalReplay.tsx/test; own Result. No types/live adapters, API/backend/schema/contracts, global styles, other frontend folders or dependencies.
- **Contracts used:** existing HistoricalView/CashPoint/AlternativeView; selectedId/onSelect. Keep old props/default behavior compatible with all existing consumers.
- **Done when:** labelled series toggles default to all supplied series visible; unavailable future series cannot be enabled; hiding a selected point clears or visibly reconciles selection; exact cents/proof, cutoff/nowcast, uncertainty and post-hoc labels remain. No new finance math or weekly actuals.
- **Verify:** baseline/observed/response and unavailable/error states in existing /playground#HistoricalReplay; focused tests/typecheck/lint. Keyboard/touch/mobile/reduced-motion screenshots and quiet reload. Codex owns combined check/build/actual browser gate.
- **Notes:** ../coordination/historical/parallel-feature-split.md and prompts/shared/T1-friend-timeline.md. Reuse shared chart, don't create another timeline or modify agent field. Fixture values remain labelled synthetic. Return backend requests rather than changing shared APIs.
## Result
- Prepared; not launched. Existing S2 checkpoint/slot must be verified by the lead before assignment.
