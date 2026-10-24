# G3: live conversation and financial outputs on the canvas

- **Goal:** /investigate submits a real curated2U investigation and renders saved operations/messages, forecast, reveal and one costed alternative in the audited canvas.
- **Owner/files:** sole UI writer; apps/web/app/investigate/page.tsx and NEW apps/web/components/investigate/live/** only. Do not modify accepted workspace primitives, backend/contracts/styles/dependencies. Record Result here.
- **Dependencies:** accepted R1 0148df5 and G2b7801fb5 API packet; read kb/coordination/historical/investigation-api.md and canvas-ui-packet.md, existing HistoricalLive/live/HistoricalChart/Replay. Reuse existing parsers/chart, no duplicated money calculations.
- **Behavior:** one idle Domino initially; actual durable records map to source/tool/agent/output nodes and dependency edges. Distinguish queued from executing, unknown from success, archived sources from live retrieval, fixed workflow from autonomous coordination. No optimistic execution, timers, fake agents or prose-derived tool events.
- **Persistence:** saved conversation in URL, reload restores quiet history; stable request IDs for uncertain retries, preserve pending operation identity through reload; safe navigation/race guards. Read query errors and offline state honestly. Fixed one-question workflow must be explicit; offer a new investigation instead of silently treating follow-up as supported.
- **Details:** saved profiles/evidence/provider only, unknown model remains unknown. Render actual saved run chart from output node, observed disclosure comparison and costed alternative with costs/assumptions. IDs/method names hidden in details. Reuse backend authority for canReveal/canAlternative and owned-run mutations.
- **Acceptance:** focused tests for adapter truthfulness, stale query/mutation/navigation, duplicate/retry/reload, missing provider and output errors. No future facts before reveal. Accessible narrow desktop/mobile. Codex full check/build/browser gates after local commit; not complete merely from tests. Provider failure must preserve successful financial outputs.
- **Skills/budget:** /orchestrator, /ponytail full, skills/taste/SKILL.md, ui-ux-pro-max. One Sonnet/high process, nochildren, bounded45min checkpoint. No full suite/build/server/provider calls/secrets/cloud/push/merge. Other workers own backend; preserve their edits. No main.

## Result
- Pending.
