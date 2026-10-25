# TL7C: add scenarios from the timeline

- **Goal:** choose a forecast week and add a scenario in the timeline context, replacing the separate bottom event panel.
- **Folder:** apps/web/components/timeline/workspace/WorkspaceView.tsx, EventForm.tsx, new composer/helper/tests in same folder ONLY; this Result. Do not edit WorkspaceChart.tsx or scale helpers (parallel TL7X owns them).
- **Contracts used:** existing Change/EventDraft, WorkspaceRun/Forecast; existing simulate action unchanged.
- **Done when:** compact selected-week + Add scenario control in chart section opens inline contextual editor immediately beneath chart, no separate bottom EventForm panel. New cash event date prefilled from selected chart week, while forecast firstWeek remains validation minimum. Review/confirm then save via existing engine path; new saved scenario appears through existing subscriptions. Keyboard/mobile/cancel/draft/error states work; existing playground and meaningful focused/full checks pass.
- **Notes:** user requests timeline-based creation rather than detached panel/header-position behavior. Preserve exact dates/queued changes and confirmation integrity; moving chart week must not silently overwrite an edited draft or queued changes, closing/hiding should retain draft unless explicitly discarded. Existing scheduled-item suggestion must still offer relevant event creation in context. Read ui-build/taste/design-spec3 + apps/web/AGENTS/installed guide. Reuse UI primitives, inline presentation should read as part of timeline rather than another distant card; no page jump. No chart/backend/contracts/globalstyles/dashboard/env/services/main/push. Work in supplied TL7-timeline-composer worktree. Parallel chart scales worker owns chart file. Lead reviews/browser tests/merges into TL5 per user request. No delegation.

## Result
- Done:
- What changed:
- Watch out:
