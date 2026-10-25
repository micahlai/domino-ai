# TL9U2: chat beside the timeline

- **Goal:** user requests chat in a right sidebar on the existing timeline page, with chart, saved scenarios and existing controls available together.
- **Folder:** apps/web/components/timeline/chat/*, workspace/WorkspaceView.tsx and WorkspaceLive.tsx, timeline/chat route redirect and chat playground only; this Result.
- **Contracts used:** unchanged TL9 chat receipt/API, WorkspaceRun, existing Change/Constraint.
- **Done when:** desktop timeline and bounded right chat coexist; mobile stays usable without horizontal overflow; chat start/send/clarify/review/save/reload and recent history work in place. Existing deep chat links redirect to same timeline/context. Focused tests, typecheck/lint pass; lead combined check/build/browser gate.
- **Notes:** same TL9 isolation; no backend/shared contracts/engine/dashboard/Field/global styles/TL7/push edits. Avoid duplicate full source chart inside sidebar. Preserve source-pinned chats, exact retry and revision review guards. Include a props playground for integrated layout. Use existing UI worker worktree, merge lead checkpoint first. No delegation.

## Result
- Done:
- What changed:
- Watch out:
