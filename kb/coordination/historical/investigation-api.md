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
- Ownership (repair1): runs an investigation creates carry `owner = conversationId` and an internal key `inv:<operationId>`, which the public requestId shape cannot express. Public `historical.saveBaseline`/`reveal`/`computeAlternative` never claim, prepopulate, reveal or branch an owned run: `reveal` and `computeAlternative` on an owned run fail `OWNED`. Reads (`getRun`, `getReveal`, `getCase`, `getActivity`) are unchanged. Legacy public runs behave as before.
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
| `forecast` | tool | run inputs + `{visibleThrough, knowledgeCutoff, hash: run.inputHash}` | `outputRef {kind:"run", id}`: the baseline saved by the existing `saveBaseline` logic. Before saving, the current cutoff case must hash to the `source_load` input hash (full sources incl. title/contentHash, facts, assumptions); any drift fails `CASE_CHANGED` with no run saved. |
| `specialist` role `evidence_analyst` | agent | `{visibleThrough, knowledgeCutoff, sourceIds, factIds, assumptionIds, runIds, comparisonIds, historyTurns, hash}` | `{assessment, citations[{kind,id}], uncertainties[]}` + `provider`, `model`, `usage` |
| `reveal` | tool | `{runId}` | `{revealedThrough, comparisonIds}`, `outputRef {kind:"reveal", id: baselineRunId}` |
| `alternative` | tool | `{baselineRunId}` | `outputRef {kind:"run", id}`: the A1 alternative from existing `computeAlternative` logic |
| `specialist` role `scenario_reviewer` | agent | as analyst; `runIds = [alternative, baseline]`, `historyTurns <= 2` | as analyst |

- Dependencies: forecast on source; analyst on source + forecast; reveal on forecast; alternative on forecast; reviewer on alternative. Edges = `dependsOn`. The Domino node is the conversation itself: a fixed, disclosed workflow, not autonomous planning.
- Both specialists read only the saved run's frozen snapshot at the cutoff (`visibleThrough = knowledgeCutoff`, no comparisons, no excerpts). The analyst gets no history. The reviewer gets the user question and the analyst's cutoff assessment only, even after a reveal, so no S8 values or reveal messages reach it. Revealed-view specialist input is not built.
- `profile`: `{role, workingStyle, instructions, version, tools: [], knowledgeCutoff}`, stored when the operation is created, for its frozen provider mode (CREAO adds fields; see Provider seam). For claude-dev, `instructions` is the exact app-authored system prompt of the accepted Claude specialist entry; `version` = `role@` + first 12 hex of its sha256. A later prompt change gives new operations a new version; stored ones keep theirs, and a stored profile whose role, instructions or version differs from what dispatch would send fails `profile_mismatch` with no call. Label it "Instructions and working style".

## Execution and failure

- `internal.investigation.runTurn` (action) loops up to 8 times over `step` (mutation). A tool operation runs and commits in one transaction. A specialist is claimed queued -> running with its packet and input hash frozen, then dispatched once, then `finishSpecialist` commits. Only a `running` operation accepts a result, so a late or duplicate result is dropped. Success needs output that passes `HistoricalSpecialistOutputSchema` and `checkHistoricalSpecialistOutput` against the stored packet.
- A step that throws rolls back; `abandon` fails the queued operations (`error.code` = the ConvexError code, then `dependency_failed`). Operations behind a failed or unknown step fail with `dependency_failed`. Existing tool outputs stay readable.
- Deadline: each operation's `leaseUntil` is creation + 180 s, and each turn schedules `expireTurn` then for its own operation ids. Queued becomes `failed/deadline`; running becomes `unknown/outcome_unknown`. The lease is also enforced without cleanup: `step` fails an expired queued operation instead of claiming it, `runTurn` sends nothing for a claim whose lease ran out, and `finishSpecialist` turns any result for an expired running operation into `unknown/outcome_unknown` (a missing lease counts as expired). Nothing is retried anywhere, and reload or reconnect never redispatches (claims happen once).
- Budget: at most 2 specialist calls per conversation (analyst + reviewer), one reveal, one alternative, one turn at a time. Follow-up questions are not supported.

## Provider seam (G2d)

`dispatchSpecialist` is the single provider point, called once per claim. No fallback between modes.
- Mode freezes when the specialist operation is created (`providerMode` = `claude-dev` if `DOMINO_SPECIALIST_PROVIDER=claude-dev`, else `creao`), with a profile for that mode. If `runTurn`'s mode differs at claim: `failed/provider_changed`, no call.
- Default `creao`: the G2c app-scoped adapter `runCreaoHistoricalSpecialist` with the role's own app id and app key (see creao-historical-api.md). No account or developer key. Order, all zero-call failures first:
  1. Stored profile must equal the current one and its `instructions` must equal the rules plus output format parsed from the exact prompt being sent: else `failed/profile_mismatch`.
  2. Gate (default off): `DOMINO_CREAO_VERIFIED_PROFILES`, a comma list of CREAO profile versions Codex verified against the dedicated remote apps' instructions and memory. Version not listed: `failed/provider_unverified`. A rules edit gives a new version, so verification must be redone.
  3. Budget: run deadline = min(150 s, `leaseUntil` - now - 10 s). Under 30 s: `failed/deadline`, nothing created.
  4. Missing or shared app config: adapter `failed/config`.
  5. One create. `onRunCreated` calls `internal.investigation.recordRemoteRun({operationId, claimedAt, runId, status})`, which writes `provider: "creao"`, `remoteRunId`, `remoteStatus` only for a running CREAO operation with the same claim (`startedAt`), no recorded run yet and an unexpired lease. Otherwise it returns false, the adapter fails `run_record_failed` and never polls.
  6. Success needs validated output and `runId` equal to the recorded `remoteRunId` (else `unknown/run_unrecorded`). `model` and `usage` are not stored (CREAO reports neither).
- CREAO profile: `instructions` = the per-run rules and output format Domino sends; `version` = `role@creao-` + 12 hex; `provider: "creao"`; `instructionsScope` says the remote app's own instructions, skills and memory also apply and are not visible to Domino.
- `remoteRunId` and `remoteStatus` are server-only: `getConversation` omits them. The UI sees coarse `status` and `provider`.
- `DOMINO_SPECIALIST_PROVIDER=claude-dev`: unchanged. Explicit development mode, calls `runHistoricalSpecialist` (needs `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`). `provider: "claude"`, reported `model` and `usage` stored. This is not CREAO.
- Error mapping: Claude `timeout`/`network` -> `unknown`, other categories -> `failed`. CREAO: `config`, `invalid_input`, `input_too_large`, `run_failed`, `run_cancelled`, `no_result`, `invalid_output`, `ambiguous_result`, `too_many_artifacts`, `untrusted_artifact` -> `failed`; everything else (timeout, network, deadline, poll_limit, run_record_failed, http_status, malformed_response, unknown_status, ...) -> `unknown` because a remote run may exist and bill. Any other throw -> `unknown/internal`. Messages are the sanitized ProviderError text only. Nothing is retried.

## Source wake (internal)

`internal.investigation.sourceWake({sourceId, contentHash})` returns `{status: "unchanged" | "unverified_version" | "unknown_source", queued: 0}` and writes nothing. No schedule calls it; there is no periodic job. It never loads a source and never queues work until a verified loader and eligibility check exist.
