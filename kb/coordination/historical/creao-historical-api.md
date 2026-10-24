# CREAO historical specialist API (G2c)

Status: offline-tested worker candidate, 2026-10-24. Not live-accepted. Codex audits and runs the first bounded app call.

## Entry

`runCreaoHistoricalSpecialist(env, input, options?)` in `packages/agents/src/historical.ts`, exported from `@domino/agents`.

- Endpoint family: the consumer app API only. `POST https://agent.creao.ai/api/v1/apps/{appId}/runs` with body `{"inputs":{"prompt": <string>}}`, then `GET .../runs/{runId}` polls. The base URL is a constant; no env override, no `/v2`, no developer or account endpoints.
- Transport: the same `runCreaoApp` the five jobs use (`creao.ts`). Bounded request timeout, run deadline, poll interval, poll limit, prompt/response/artifact byte caps, artifact count, manual redirects, trusted artifact download rules, strict chat-text and artifact extraction. The five jobs' behavior is unchanged (all 99 existing CREAO tests pass).
- One create per call. No retry, no repost, no Claude or other fallback. The caller records every outcome.

## Configuration (read from the `env` object passed in; nothing reads env files)

| Role | App id | App API key |
| --- | --- | --- |
| `evidence_analyst` | `CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID` | `CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY` |
| `scenario_reviewer` | `CREAO_HISTORICAL_SCENARIO_REVIEWER_APP_ID` | `CREAO_HISTORICAL_SCENARIO_REVIEWER_API_KEY` |

`config` failure, with zero requests, when the requested role's id or key is missing or blank, or its app id equals any legacy job id (`CREAO_AGENT_ID_MAPSOURCE`, `CREAO_AGENT_ID_MAP`, `CREAO_AGENT_ID_CONSTRAINTS`, `CREAO_AGENT_ID_BRIEF`) or the other role's app id. There is no fallback to `CREAO_API_KEY`, and `CREAO_ACCOUNT_API_KEY` is never read. Unknown: whether CREAO app keys are per app or per user. If one consumer key covers several apps, set the same value in both role key variables.

## Order of operations

1. Parse input with `HistoricalSpecialistInputSchema` (semantic checks included). Failure: `invalid_input`, zero requests.
2. Resolve role config. Failure: `config`, zero requests.
3. Build the prompt; over `maxPromptBytes`: `input_too_large`, zero requests.
4. One POST. The created status must be a known pending state or `completed`; `failed`, `cancelled`/`canceled` and unknown states fail before the callback.
5. `await options.onRunCreated({ runId, status })` (status is the observed remote status, lowercased). If it throws or rejects: `run_record_failed`, no poll and no second create. The callback is bounded by the remaining whole-run deadline; if it has not settled by then the run also fails `run_record_failed`, and a late settle never resumes polling.
6. Polls. Every poll must return the same `id` (missing or changed id: `malformed_response`). `failed` → `run_failed`, `cancelled` → `run_cancelled`, unknown → `unknown_status`, too many → `poll_limit`, out of time → `deadline`.
7. Extract from `result.chatText` and trusted JSON/Markdown/text artifacts. `result.text` (the memory summary) is never read.
8. Each JSON candidate must pass `HistoricalSpecialistOutputSchema` and `checkHistoricalSpecialistOutput` (citations, money prose, outcome promises). Exactly one distinct valid answer wins. No candidates: `no_result`. Candidates but none valid: `invalid_output`. Two different valid answers: `ambiguous_result`.

A remote `completed` status alone is never success; only step 8 makes it one.

## Result

```ts
{ role, output: HistoricalSpecialistOutput, provider: "creao", runId: string, status: "completed" }
```

No `model` and no `usage`: CREAO run responses have no documented, validated field for either, so neither is reported or inferred. Add them only once the live response shows a stable field.

Errors are `ProviderError { provider: "creao", job: "historicalSpecialist", category, httpStatus? }`. Messages hold only those fields. `options.diagnostics` gets one counts-only report per call (`job: "historicalSpecialist"`), never text, ids, URLs or keys. No progress hook: the backend gets the run id from `onRunCreated` and the final outcome from the promise.

## What Domino sends (instruction/profile builder)

`buildHistoricalCreaoPrompt(input)` returns the exact `inputs.prompt` string: one JSON document with `task: "historicalSpecialist"`, `role`, `rules` (the same rules as the Claude system prompt, with "in the data field" as the data location), `outputFormat`, `outputSchema` (citation ids enumerated from the input) and `data` (the validated input, `<`/`>` escaped so it cannot forge the result delimiters).

This is what Domino sends per run. It is not the app's whole remote system prompt: the app's own instructions, skills and memory also apply, and they can override the input format.

## Live integration gates (not done here)

- Create one dedicated CREAO app per role. Do not reuse the map, constraints or weekly brief apps; the weekly brief app's instructions conflict with this format.
- Each app's own instructions must be compatible: read `inputs.prompt` as JSON, follow its `rules`, and reply with exactly one `<<<DOMINO_RESULT>>>` ... `<<<END_DOMINO_RESULT>>>` block holding the bare `{assessment, citations, uncertainties}` object. A legacy `{"result": ...}` envelope is rejected.
- Memory isolation is unverified. A fresh run does not prove the agent's memory is free of earlier sessions or post-cutoff facts. Disable or clear app memory where CREAO allows it, and check the first live outputs for hindsight.
- Strict run identity assumes every poll response carries `id`. If the live API omits it, every run fails with `malformed_response`; fix it then, not by guessing.
