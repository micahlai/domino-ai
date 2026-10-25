# Field (Jayden): ingestion agent, audit, brain map, worker page

Vision: ../../spec/weekly-product-vision-2026-10-24.md. Supersedes the SEC-quarterly Field brief (kept in git history). Lean: ship working features fast, real behavior over polish.

## Build

1. **Mock data feed.** Revive the parked mock server (branch E2a-mock-sources 29de286; billing/CRM/cards/books/payroll) and the pure `advanceWeek` (E1b 9ab358a) on this branch. Add a "new entries arrive" control that advances the feed. Nessie bank via mock or recorded fixture if no key.
2. **Always-on ingestion agent.** Bounded Convex scheduled job polls the feed, maps and normalizes new entries into a new `snapshots` version (reuse L1 mapping-receipt pattern, L2 exact-cent reconciliation). Every ingest is a recorded operation in `log`. Never real money APIs, never moves money.
3. **Audit.** Detect duplicates, conflicts, unusual amounts/timing and missing expected items; store as findings/escalations.
4. **Brain map.** Reuse the agent-canvas shell (components/investigate) with a new weekly adapter: agents, sub-agents, tools, data sources from real backend records; animate only recorded exchanges and spawns; hover brief, click detail (instructions, tool calls, reasoning summary, connections, inputs/outputs). CREAO only through the verified app-scoped gate; otherwise show built-in agents honestly.
5. **Worker page.** Escalations to review and decide (writes `approvals`), launch an analysis, request a simulation (hands Timeline a WeeklySeedV1).

## Seam

Export `WeeklySeedV1` (packages/contracts weekly-boundary.ts) as JSON text: ingested snapshot + scheduled items + findings. Consume `WeeklyResultRefV1` to link results and show health. Test against the frozen fixtures; never import Timeline-private files (`node apps/web/scripts/lane-imports.mjs`).

## Owns

Tables: companies, sources, snapshots, models, constraints, approvals, log, plus investigation*. Engine/agents: ingestion, mapping, reconciliation, audit, learned rules. UI: worker page, brain map, connect/ingest views. Shared contracts/schema composition change only by a joint checkpoint.

## Done

New mock entries appear -> agent ingests -> audit flags an anomaly -> it shows on the map and in the worker page -> a decision is recorded -> a seed is exported and Timeline shows the 13-week effect. Real backend, reopen works, tests pass.
