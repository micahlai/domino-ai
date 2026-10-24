# G2c: existing CREAO app API for historical specialists

- Goal: use the user's existing consumer CREAO app API family for real historical specialist jobs. User explicitly rejected using the developer/account key. No v1 Account or v2 Developer endpoints, purchases or fallback.
- Ownership: packages/agents/src/**, this card Result and kb/coordination/historical/creao-historical-api.md. Do not change contracts, Convex, UI, evidence, dependencies, shared coordination docs or env files. Other reviewers/workers are active; preserve their work.
- Base: accepted G2a on preview/historical-overnight. G2b backend candidatec185500 is under independent audit; do not edit it. Existing historical input/output validation remains authoritative.
- Skills: /orchestrator and /ponytail full, actual installed skill files. One Claude process, no children. Codex audits and publishes. Target30minute checkpoint.

## Implementation

Add one narrow historical CREAO specialist entry using https://agent.creao.ai/api/v1/apps/{appId}/runs with inputs and polling. Reuse existing bounded HTTP, trusted artifact handling and strict extraction infrastructure. Refactor the common transport only where necessary; do not duplicate a large transport or alter the five existing job behaviors. Use accepted HistoricalSpecialistInputSchema, output schema and semantic/citation checks before/after the network. No fabricated weekly inputs or monetary prose.

Historical role configuration must be explicit, separate from legacy map/constraints/brief IDs so the screenshot's weeklyBrief instruction conflict cannot silently recur. Support a per-role app ID and app-scoped credential without reading env files. Document exact env names and setup/profile requirements. A legacy operational app must not be silently selected as historical researcher. Never use CREAO_ACCOUNT_API_KEY, developer endpoints, Claude fallback or retries.

Expose truthful metadata: provider creao; actual remote run ID/status and actual model/usage only if returned and validated, otherwise unknown/omitted. No inferred model, hidden tools or internal specialists. Provide an awaited onRunCreated callback before polling so the backend can persist the accepted ID. A callback persistence failure must stop without issuing another create. If progress hooks are useful they expose only observed remote statuses, never simulated steps. Keep response/body/error logs sanitized, no raw reasoning or memory summaries. Completed remote execution only counts as app success after output validation. Same run identity must hold across responses. Bound request/poll/time/bytes/artifacts; no automated repost after uncertain outcome.

Document a safe app-authored instruction/profile builder matching what is actually sent. Do not claim it is the agent's entire remote system prompt. Remote agent skills can override input format; dedicated historical agents need compatible instructions before live acceptance. Historical memory isolation and actual agent setup remain a live integration gate; do not claim a fresh run alone prevents agent memory leakage.

## Validation

Offline tests: missing/mismatched role configuration, invalid historical input before any fetch, correct app endpoint/inputs, create callback ordering/failure, queued/running/completed/failure/cancelled/unknown transitions, deadline/poll limit, changed run IDs, malformed/ambiguous/invalid-citation output, memory-summary excluded, trusted artifacts, sanitized diagnostics, zero fallback/retry. Positive real2U frozen packets for both roles. Preserve existing provider regression tests.

Worker runs focused tests/typecheck/scoped lint only. No full suite/build/server/network/provider calls, no secret files, no push/merge. Return exact Result/API packet and local commit. Codex owns independent audit and a bounded actual app call later. No new remote agent creation in this coding phase.

## Result
- Done:
- Checks:
- Setup/limits:
