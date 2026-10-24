# G1: initial agent canvas visual checkpoint

- **Goal:** /investigate opens one Domino node, pan/zoom/drag canvas, persistent conversation area and node details; show early design before full execution wiring.
- **Ownership:** apps/web/app/investigate/**, apps/web/components/investigate/**, minimal AppShell.tsx route layout, /playground entry, apps/web/package.json and pnpm-lock.yaml only if adding @xyflow/react; this card Result. No other files.
- **Contracts:** presentation props only in this phase; preserve HistoricalLive/Replay/Chart and backend unchanged.
- **Done when:** browser-checkable clean desktop/mobile workspace, keyboard-selectable node/details, usable pan/zoom controls, no metadata clutter or fake work; focused tests and typecheck/lint pass. Lead runs full check/build/browser.
- **Notes:** kb/spec/agent-canvas-2026-10-24.md. Read /orchestrator and /ponytail full, delegate one bounded Sonnet builder if useful. One writer per file. Existing primitives first. One legitimate graph dependency allowed; official docs https://reactflow.dev/learn. Node initially idle, prompt editable with honest execution-not-connected state. No timers, fake specialist results or extra themes. Composer draft may persist locally; do not claim stored conversations before G2. Keep existing dashboard usable. No full flow, API/engine edits, env changes, provider calls, servers, push or merge. Commit locally, then stop.

## Result
- Done:
- Files/checks:
- Limits:
