# Canvas reuse inspection

October24, Codex read-only inspection plus explorer inspect_canvas_reuse. G1 is visual only. This is the design input for G2 after the early visual has been shown.

## Existing assets

- Historical mutations getCase/getRun/saveBaseline/reveal/computeAlternative and immutable snapshots already validate source/time/money boundaries. Keep engine math in engine.
- HistoricalLive memoized subscription maps and completion route guards are proven fixes, preserve them when adapting callers. HistoricalReplay/Chart, proof sheets, formatters and validation adapters can render inside a node detail.
- packages/agents createClaudeClient, boundedFetch, response extraction, errors and schemas contain actual provider calls. apps/web/convex/agents.ts is still not built; never present it as operational. Existing AgentJob requires weekly operational models; do not fabricate Branch/Snapshot from quarterly public evidence.
- No durable conversation/task graph exists. Existing historicalActivity is latest50 completed financial events, not an authoritative orchestration store.

## Missing pieces and acceptance constraints

- One narrow historical specialist input/output contract, bounded question/history, permitted frozen sources/facts/assumptions and saved engine output references. Validate every citation against allowed input and reject unsupported facts. No financial calculation by agent. Safe text rendering. No model chain-of-thought output.
- Server-owned conversation/messages and operation records with dependency IDs, role, actual provider, immutable input hash/snapshot, status, sanitized error, output ref and timestamps. No separate edge table needed. Do not add a general plugin/agent framework.
- Mutation persists submitted intent/idempotency key then schedules actual execution; commit started before calling tool/provider, terminal state after validated result. Real queued/running/success/failure transitions. Claims and leases prevent duplicate provider work. Unknown outcome is never false success. Bounded retry only explicit or safely idempotent. Freeze each operation's evidence visibility before dispatch.
- Source load reads curated archived disclosure, clearly labelled. No claim of live retrieval when using bundled evidence. A source node appears only after actual load. Financial computation is a tool node. Specialist nodes are real validated model calls. Default Domino node can coordinate a disclosed bounded workflow, not pretend autonomous planning.
- Minimum one real evidence specialist for initial investigation, and a separate real scenario specialist for the costed alternative. Reuse transport rather than a new SDK; max2 specialist calls per complete initial/alternative journey, explicit follow-up limits, no automatic provider fallback or unbounded retries. Store provider/model usage metadata in details, never secret keys/raw traces. If this cap conflicts with correct behavior, report before expanding.
- Reveal remains user-triggered. New tasks after reveal may see later evidence, old task inputs/outputs remain frozen. Initial agent does not receive S8, later actual values, or future-derived narrative through prompts, history, event metadata or task IDs. Source text is untrusted data, not instructions.
- Public quarterly history cannot establish a live/prospective bankruptcy warning. Keep costs, lag, unknown benefit/downside and retrospective authorship visible in financial detail.
- Persistent conversation survives reload; draft/request IDs must be recorded before dispatch. Initial graph restoration is quiet, new operations animate once; query failure is unavailable/stale, not empty. No artificial delays to make graph seem busy.

## G2 split

G2a owns narrow additive contracts + provider support with focused tests. G2b owns schema/actions/messages/tasks and generated API, depends on audited G2a. G3 owns canvas wiring and clean details, depends on reviewed G2b packet. Avoid simultaneous owners of generated files/manifests/lockfile. Codex runs full checks/build serially and real local execution after contracts pass.

Open implementation detail: the worker should propose the smallest provider extension that preserves existing five-job APIs. A separate historical entry point reusing shared transport may avoid broad AgentJob/router churn. Codex must audit this choice before dependent wiring.
