# TL11: Page-filling timeline workspace

- **Goal:** timeline fills the workspace; left scenarios collapse/widen and use per-scenario dropdowns, right chat collapses, financial panels collapse in a bottom tray.
- **Folder:** apps/web (UI only, including AppShell and playground); this Result section only.
- **Contracts used:** unchanged Forecast, HistoryWeek, Change, Constraint, WeeklyResultRefV1; existing WorkspaceRun/CatalogEntry.
- **Done when:** chart and time/cash scrollers dominate the viewport; both rails toggle; scenario names can wrap fully in a wider rail; per-scenario details start closed; Lowest point, lender's minimum, Chosen week and cash flows are in initially closed bottom disclosures; desktop/mobile/keyboard remain usable; chat drafts and comparison/branch controls survive toggles. pnpm check and browser verification pass.
- **Notes:** Continue claude-timeline-chat in this worktree at 4af53a1. Read kb/features/timeline/TL10-claude-chat-handoff.md, skills/ui-build, taste, local apps/web/AGENTS.md, relevant Next bundled docs, existing contracts. Preserve current visual system, data, chart pan/zoom/proposal flashes, all actions, saved risk links. No backend/schema/contracts/engine/global styles, no runtime restart/data copying, no delegation or push. Existing playground should expose the integrated layout. Codex owns docs/commit/review/browser. Latest user request supersedes old dashboard arrangement.

## Result
- Done:
- What changed (files):
- Watch out:
