# TL13: One Ask Domino sidebar toggle

- **Goal:** Ask Domino is the only chat-sidebar open/collapse button.
- **Folder:** apps/web/components/timeline/workspace; this Result section.
- **Contracts used:** unchanged WorkspaceRun, AssistantTab and props; no shared type changes.
- **Done when:** header Ask Domino opens and collapses chat on desktop/mobile; both duplicate icon buttons disappear; aria-expanded/controls and Escape focus return work; drafts remain mounted; existing playground and pnpm check pass.
- **Notes:** continue claude-timeline-chat fa11dbb; preserve Saved risks. Use panel open/close icon within the named Ask Domino button, always-visible text. Remove inner close icon; Escape restores focus to action-ask. Keep opening focus behavior. User authorized changes and push; root owns final checks/publication. Follow kb-sync/ui-build/taste.

## Result
- Header Ask Domino is now the sole sidebar open/collapse control, with open/close panel icon, always-visible text including phones, aria-expanded and aria-controls. Removed the separate header icon and inner close button; Ask Domino heading stays static.
- Opening retains composer focus behavior; Escape collapses and returns focus to action-ask. Collapse hides the mounted assistant, preserving drafts and conversation state.
- Validation: fresh web typecheck, focused workspace tests and touched-file Biome pass. Root owns browser/taste/full checks/publication. No backend, contract, runtime, commit or push changes by worker.
