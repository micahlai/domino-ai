# TL11 follow-up: manual event entry fallback

- **Goal:** Ask Domino is the main event entry point; the manual form is available under More details.
- **Folder:** apps/web/components/timeline/workspace; this task Result only.
- **Contracts used:** unchanged WorkspaceActions and ScenarioComposer props; no shared type changes.
- **Done when:** no Try an event header action; More details contains Enter an event manually; form stays mounted with review/save unchanged; focused checks pass.
- **Notes:** Explicit side-conversation request, 2026-10-25. Preserve all in-flight parent-thread edits and Git state; no commit, push, runtime restart or agent coordination.

## Result
- Done: manual event editor moved under More details; Ask Domino stays in the header. Form state, review/save and Build on semantics preserved.
- Verified: 74 focused workspace/composer/chat tests, web TypeScript, scoped Biome and whitespace checks pass.
- Publication: parent chat user explicitly requested pushing all remaining changes after this card was written.
