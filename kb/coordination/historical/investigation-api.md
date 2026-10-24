# Investigation API packet (G2b)

Backend records for the canvas. Module `apps/web/convex/investigation.ts`; tables in `schema.ts`. An integration owner adapts these into the canvas-ui-packet view. This is not the presentation schema.

## Public calls

| Call | Args | Returns | Errors (ConvexError `data.code`) |
| --- | --- | --- | --- |
| `api.investigation.investigate` (mutation) | `{requestId, question}` | `{conversationId, operationIds[3]}` | `INVALID_REQUEST` (requestId not 8-64 `[A-Za-z0-9_-]`, question empty or over 1000 chars after trim), `CONFLICT` (key reused with another kind or question) |
| `api.investigation.getConversation` (query) | `{conversationId}` | see State | `NOT_FOUND` |
| `api.investigation.revealInvestigation` (mutation) | `{requestId, conversationId}` | `{conversationId, operationIds[1]}` | `CONFLICT`, `NOT_FOUND`, `BUSY` (a step is queued/running), `NOT_READY` (no saved forecast), `LIMIT` (already has a reveal) |
| `api.investigation.requestAlternative` (mutation) | `{requestId, conversationId}` | `{conversationId, operationIds[2]}` | same as reveal |

- Unknown args (caseId, predictions, instructions, status) are rejected by the validators. The case is always the curated 2U case `twou-2023-cash-v1`.
- Same requestId and same payload returns the first result and schedules nothing. A different payload or kind conflicts. Each accepted mutation saves its receipt, messages and queued operations, then schedules `runTurn` in the same transaction.
- Money and evidence come from the existing calls: `api.historical.getRun({caseId, runId})` for a forecast or alternative `outputRef.id` (`inputSnapshot` is the authority for its inputs), `api.historical.getReveal({runId})` for a reveal, and `api.historical.getCase({caseId, runId})` for the frozen post-reveal view. Specialist text never carries amounts.

## State (`getConversation`)

`{conversationId, caseId, createdAt, messages[], operations[], busy, canReveal, canAlternative}`. Lists are capped at 50; the fixed workflow makes at most 6 operations and about 10 messages.

- message: `{id, sequence, role: user|assistant|system, kind: question|receipt|assessment, text, operationId?, createdAt}`. `receipt` = fixed server text (a deterministic receipt, not a model). `assessment` = validated specialist output only. A button press gets a system receipt, not a user message.
- operation: `{operationId, sequence, kind, role?, title, status, dependsOn[], createdAt, startedAt?, finishedAt?, leaseUntil?, input?, profile?, providerMode?, provider?, model?, usage?, outputRef?, output?, error?}`. The specialist packet stays server-side and is never returned.
- `status`: `queued | running | succeeded | failed | unknown`. `unknown` means the call may have reached the provider (timeout, network, deadline) and was not retried. The canvas has no `unknown`: show it as `failed` with `error.message`, never as success.
- `canReveal` / `canAlternative`: not busy, forecast succeeded, and that action not yet used.

## Operations, in order

| kind | Node | input (frozen when it starts) | output |
| --- | --- | --- | --- |
| `source_load` | source | `{visibleThrough, knowledgeCutoff, sourceIds, factIds, assumptionIds, hash}` (cutoff view) | `{origin: "curated_archive", note, sources[{id,title,url,publishedAt,retrievedOn,contentHash}]}`. Bundled archived copy, not live retrieval. |
| `forecast` | tool | run inputs + `{visibleThrough, knowledgeCutoff, hash: run.inputHash}` | `outputRef {kind:"run", id}`: the baseline saved by the existing `saveBaseline` logic |
| `specialist` role `evidence_analyst` | agent | `{visibleThrough, knowledgeCutoff, sourceIds, factIds, assumptionIds, runIds, comparisonIds, historyTurns, hash}` | `{assessment, citations[{kind,id}], uncertainties[]}` + `provider`, `model`, `usage` |
| `reveal` | tool | `{runId}` | `{revealedThrough, comparisonIds}`, `outputRef {kind:"reveal", id: baselineRunId}` |
| `alternative` | tool | `{baselineRunId}` | `outputRef {kind:"run", id}`: the A1 alternative from existing `computeAlternative` logic |
| `specialist` role `scenario_reviewer` | agent | as analyst; `runIds = [alternative, baseline]`, `historyTurns <= 2` | as analyst |

- Dependencies: forecast on source; analyst on source + forecast; reveal on forecast; alternative on forecast; reviewer on alternative. Edges = `dependsOn`. The Domino node is the conversation itself: a fixed, disclosed workflow, not autonomous planning.
- Both specialists read only the saved run's frozen snapshot at the cutoff (`visibleThrough = knowledgeCutoff`, no comparisons, no excerpts). The analyst gets no history. The reviewer gets the user question and the analyst's cutoff assessment only, even after a reveal, so no S8 values or reveal messages reach it. Revealed-view specialist input is not built.
- `profile`: `{role, workingStyle, instructions, version, tools: [], knowledgeCutoff}`, stored when the operation is created. `instructions` is the exact app-authored system prompt of the accepted Claude specialist entry; `version` = `role@` + first 12 hex of its sha256. A later prompt change gives new operations a new version; stored ones keep theirs. Label it "Instructions and working style".

## Execution and failure

- `internal.investigation.runTurn` (action) loops up to 8 times over `step` (mutation). A tool operation runs and commits in one transaction. A specialist is claimed queued -> running with its packet and input hash frozen, then dispatched once, then `finishSpecialist` commits. Only a `running` operation accepts a result, so a late or duplicate result is dropped. Success needs output that passes `HistoricalSpecialistOutputSchema` and `checkHistoricalSpecialistOutput` against the stored packet.
- A step that throws rolls back; `abandon` fails the queued operations (`error.code` = the ConvexError code, then `dependency_failed`). Operations behind a failed or unknown step fail with `dependency_failed`. Existing tool outputs stay readable.
- Deadline: each turn schedules `expireTurn` at 180 s for its own operation ids. Queued becomes `failed/deadline`; running becomes `unknown/outcome_unknown`. Nothing is retried anywhere, and reload or reconnect never redispatches (claims happen once).
- Budget: at most 2 specialist calls per conversation (analyst + reviewer), one reveal, one alternative, one turn at a time. Follow-up questions are not supported.

## Provider seam (live versus unavailable)

`dispatchSpecialist` is the single provider point.
- Default (`DOMINO_SPECIALIST_PROVIDER` unset or anything except `claude-dev`): `providerMode: "creao"`, the agent operation fails `provider_unavailable` ("The CREAO coordinator is not connected yet. No model call was made."). No call, no fallback. CREAO adapter is G2c.
- `DOMINO_SPECIALIST_PROVIDER=claude-dev`: explicit development mode, calls the accepted `runHistoricalSpecialist` (needs `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` in the Convex deployment env). `provider: "claude"`, reported `model` and `usage` are stored. This is not CREAO.
- Error mapping: `ProviderError` `timeout`/`network` -> `unknown`; other categories -> `failed` with the sanitized ProviderError message; any other throw -> `unknown/internal`. No raw provider text, reasoning or keys are stored.

## Source wake (internal)

`internal.investigation.sourceWake({sourceId, contentHash})` returns `{status: "unchanged" | "unverified_version" | "unknown_source", queued: 0}` and writes nothing. No schedule calls it; there is no periodic job. It never loads a source and never queues work until a verified loader and eligibility check exist.
