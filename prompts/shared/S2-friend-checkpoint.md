# Friend: checkpoint S2 so the split can proceed

Copy to the friend's agent on the second computer.

```text
Checkpoint Domino S2 now; do not discard anything. In your S2-simulation-catalog checkout: show git status and the last commits. If S2 is complete per kb/tasks/S2-simulation-catalog.md, run focused investigationCatalog tests, typecheck and lint, commit and push ONLY S2-simulation-catalog. If it is incomplete, commit the current work as a WIP checkpoint (message starts "wip: S2 checkpoint"), push only that branch, and report what is missing. Never push main or preview, never force push, never reset/stash away work. Then stop the S2 writer and report: branch, pushed sha, files changed, checks run with counts, and whether the by_case_createdAt index on investigationConversations is in schema.ts. Codex will audit before it enters the shared base for the P0-S schema split. After that, your next task is the Timeline feature lead prompt (prompts/shared/friend-timeline-feature-owner.md), which starts only once the split is ready.
```
