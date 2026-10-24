# Historical contract packet v1

- State: **frozen candidate** (schema tests pass at the contracts SHA below), pending Codex audit. Not API-ready: no Convex endpoint exists yet.
- Contracts code SHA: `442d23be1a97aa44261f1cb1d73ff82739c49cec` on H2-historical-backend (local, not pushed). Repair 1 of `8bdea82`; closes the five Codex audit blockers below.
- Module: `packages/contracts/src/historical.ts`, exported from `@domino/contracts`. Fixture: `historicalFixtures` from `@domino/contracts/fixtures`.
- Fixture is a **synthetic validation fixture** (`provenance: "synthetic_fixture"`, fictional 2031-2032 dates, example.com URLs, repeated-character hashes). It is not evidence about 2U or any company. Real data comes from the H1 bundle.
- Additive only. Operational `Forecast` (13 weeks), `GradeContext`/`LearnContext` (bank windows) and `Evidence` are unchanged and are not quarterly contracts.

## Schemas (Zod, types inferred)

| Schema | Purpose and enforced rules |
| --- | --- |
| `TimestampSchema` | ISO instant with explicit offset (`2023-11-09T16:45:46-05:00`). Naive times rejected. |
| `PeriodSchema` | `{kind:"instant",date}` for balances, `{kind:"duration",start,end}` inclusive for flows. Real calendar dates, start <= end. |
| `HistoricalSourceSchema` | Stable ID, URL, optional accession, `publishedAt` (required: unknown availability fails closed), IANA `timezone`, optional reported `period`, `retrievedOn`, sha256 `contentHash`, optional `amends`. An amendment is a new source published after its original; it never replaces it. |
| `HistoricalFactSchema` | `reported` (sourceId, locator, `reportedScale` ones/thousands/millions) or `derived` (derivedFrom, plain derivation). Metric enum keeps `cash_and_equivalents`, `restricted_cash`, `cash_including_restricted` separate from revenue/net loss/adjusted EBITDA. Balance metrics need instants, flows need durations; balances are nonnegative; safe integer cents; ISO 4217 currency. |
| `HistoricalAssumptionSchema` | Label `synthetic` / `counterfactual` / `hindsight`; basis fact IDs; integer range in cents/days/basis points; `effectiveFrom`, optional `oneTimeCost` (unit `cents` only, nonnegative, low <= high) and `benefitLagDays`, `dependsOn`, `feasibleAtCutoff` yes/no/unknown, `selectedAfterReveal`. |
| `HistoricalCaseSchema` | One company bundle, single currency, `provenance` evidence or synthetic_fixture. Checks unique IDs, references, amendment order, reported `availableAt` = source `publishedAt`, derived `availableAt` = latest input `availableAt` (inputs listed earlier, so derivation is acyclic). Assumption `dependsOn` must name assumptions listed earlier, so dependencies are acyclic and self-reference fails. |
| `HistoricalPredictionSchema` | `nowcast` (stale origin balance to cutoff) or `forecast` (ends after cutoff); balance metrics need instants, flows need durations (same rule as facts); optional labelled range containing the point. Not a statistical interval. |
| `HistoricalRiskRuleSchema` | Metric, below/above, threshold cents, basis `disclosed_term` (needs input sources) or `analyst` (labelled). |
| `HistoricalRunSchema` | Immutable save: runtime `createdAt`, `knowledgeCutoff`, `originBalanceDate` (<= cutoff date, distinct from it), input source/fact/assumption IDs, `inputHash`, method id+version, predictions, risk rules, branch `baseline` or `alternative{baselineRunId, decisionAssumptionIds, postHoc}`. |
| `HistoricalRunContextSchema` | Save-time leakage boundary `{case, run, baseline?}`. Every input source/fact available by the cutoff; reported fact sources and derived inputs are also inputs; an input balance fact exists at the origin date; assumption basis is in the inputs unless the label is `hindsight` (`selectedAfterReveal` alone never authorizes post-cutoff basis facts); every input assumption's `dependsOn` is also an input, so hidden hindsight dependencies fail; hindsight or post-reveal choices force `postHoc` and are banned from baselines; alternatives must share the baseline cutoff, origin and nowcast predictions exactly. |
| `HistoricalComparisonSchema` | `scored` (observation fact, predicted, observed, `errorCents` = observed - predicted, `absErrorCents`, rule outcomes) or `unscored` (reason, no numbers). |
| `HistoricalComparisonContextSchema` | Reveal-time boundary `{case, run, revealedThrough, comparisons}`. `run.caseId` must equal `case.id`. Observation published after the cutoff and by `revealedThrough`; same metric, period and currency; values match run and fact; exact error; rule outcomes follow the threshold; one comparison per prediction. |
| `ActivityEventSchema` | Optional feed. Stable idempotent `id`, `sequence`, runtime `occurredAt` (never a historical date), `caseId`, optional `runId`, kind, status, entity ref, plain `label`, visible `evidenceIds`, optional `outputId`. `started` allowed only for `agent_task`/`tool_invoked`; instant operations emit only succeeded/failed. Agent/tool kinds exist for a future real product lifecycle; supporting them is not a claim that one runs. |

Timestamp ordering uses `Date.parse` on offset timestamps (deterministic). The cutoff calendar date is the local date as written in the cutoff timestamp.

## Proposed APIs (NOT implemented; H2c/H2d will publish actual names)

```ts
// proposed: query; returns only sources/facts/assumptions with availableAt <= run cutoff or revealedThrough
historical.cases.get({ caseId }): HistoricalCase /* filtered view */
// proposed: mutation; validates HistoricalRunContextSchema, idempotent on run id + inputHash
historical.runs.save({ caseId, run, baselineRunId? }): { runId }
// proposed: mutation; advances disclosure visibility only, never edits a run or sim/bank state
historical.reveal({ runId, revealedThrough }): { comparisons: HistoricalComparison[] }
// proposed: query
historical.comparisons.list({ runId }): HistoricalComparison[]
// proposed: action; engine (H2b) computes numbers, saved as an alternative run
historical.alternatives.compute({ baselineRunId, decisionAssumptionIds }): { runId }
// proposed: query; ordered by sequence, labels/refs pass the same reveal filter
historical.activity.list({ caseId, afterSequence? }): ActivityEvent[]
```

## UI states this contract supports

Case loaded (cutoff, latest balance date, sources, assumptions) -> run saved -> disclosure revealed with observed points beside the saved projected line -> scored/unscored comparison -> one alternative branch with cost, lag and feasibility -> proof per figure via source/fact IDs. Unscored and post-hoc states are explicit fields, not UI inference.

## Not enforced here (owners)

- Cash bridge math, YTD-to-quarter derivation values and FX/scope reconciliation: H2b engine. The contract checks derivation availability and currency, not the arithmetic.
- `inputHash` correctness, immutability across saves, reveal filtering of payloads and activity labels: H2c/H2d.
- Event sequence monotonicity and dedupe across a feed: H2d emission plus H4 UI.

## Repair 1 (audit blockers closed at `442d23b`)

1. Post-reveal selection no longer bypasses basis validation; only `label: "hindsight"` may use post-cutoff basis facts.
2. Assumption dependencies: listed earlier in the case (acyclic) and present among run inputs (closure validated).
3. Comparison context rejects a run from another case.
4. `oneTimeCost` is a nonnegative cents range; days, basis points and negatives fail.
5. Predictions enforce balance-instant / flow-duration like facts. Negative predicted balances are still allowed (a forecast may show a shortfall).

Shape change vs `8bdea82`: `oneTimeCost.unit` narrows to `"cents"`; case assumption order now matters for `dependsOn`. No consumer outside contracts uses either yet.

## H2c readiness (candidate, NOT API-ready)

- State: **candidate (repair2)**, pending independent acceptance (Codex audit, C0 full check and live probes). Code SHA `83893267fefece81a3a5fb858791d3bc37f1b696` on H2-historical-backend (local, not pushed). Repair1 was `8c16c4fb78f04279aacf27683169f8e9575138d6`. Closure: contracts 442d23b, engine a75406d + period-2u test 41d04e7, evidence a4e49e0 (`data/historical/2u/case.json`, `protocol.json`), Convex module, additive schema, generated bindings 0377a9b.
- Bindings: `_generated/` committed at 0377a9b. Repair1 and repair2 needed no regeneration (`api.d.ts` re-exports `typeof historical`; the data model derives from the schema). Tests use typed `api.historical.*`. Repair2 is not checked in a live runtime or browser.
- Module `apps/web/convex/historical.ts`. All inputs, method, decision and reveal time are server-owned. Clients send only IDs. `requestId` is 8-64 chars `[A-Za-z0-9_-]`. Errors are `ConvexError({code, message})`, codes `INVALID_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTEGRITY`, `CASE_CHANGED`, `INVALID_BRANCH`, `NOTHING_TO_REVEAL`.

| Function | Args | Result |
| --- | --- | --- |
| `historical:getCase` (query) | `{caseId, runId?}` | `{case, knowledgeCutoff, originBalanceDate, visibleThrough, revealed, disclosure, method, projectionAssumptions, riskRules: [], riskRulesNote}`. **The available/revealed evidence view, not a saved forecast's inputs.** With `runId`, `knowledgeCutoff`, `originBalanceDate` and `method` come from the saved run; without it, from today's protocol and engine. Before reveal, `case` is the current case filtered to the cutoff (a run's own `knowledgeCutoff` if `runId` is given). Later sources/facts and hindsight assumptions are absent. After reveal, `case` is the view **frozen at reveal**, not today's case. `runId` must belong to `caseId`. |
| `historical:getRun` (query) | `{caseId, runId}` | The stored summary exactly as `saveBaseline` / `computeAlternative` returned it, plus `inputSnapshot: {caseId, currency, method, roles, sources, facts, assumptions}`. `inputSnapshot` is the frozen, hashed snapshot behind `run.inputHash` (exact input objects, in case order). **It is the authoritative evidence for a saved forecast.** A baseline's snapshot holds only cutoff inputs. Read-only. `NOT_FOUND` if the run is missing or belongs to another case. |
| `historical:saveBaseline` (mutation) | `{requestId, caseId}` | `{runId, run, riskRulesNote}`. Computes `quarterBridge` on the cutoff view, assumptions + `AS-RESTRICTED`, `riskRules: []`. Validated by `HistoricalRunContextSchema`. Retry returns the frozen saved summary. |
| `historical:computeAlternative` (mutation) | `{requestId, baselineRunId}` | `{runId, run, costRelativeToBaseline: {low,point,high}, benefit: {start, daysInWindow, afterTarget: "unknown"}, postHoc: true, postHocReason, caveats: [A1-DOWNSIDE unmodeled note, point note]}`. Decision is `A1`, and the baseline must be a baseline run. It is not scored against disclosures. A **new** alternative fails `CASE_CHANGED` if the baseline's frozen inputs, method or cutoff no longer match the current case. A retry of a saved alternative still returns it. |
| `historical:reveal` (mutation) | `{requestId, runId}` | `{runId, revealedThrough, revealedAt, comparisons}`. Baseline runs only. `revealedThrough` = next publication after the run's cutoff (S8 publishedAt). `compareRun` on the stored predictions (the baseline is never recomputed); error = actual - forecast. Comparisons and evidence view are stored once per run. |
| `historical:getReveal` (query) | `{runId}` | Same as reveal, or `null` before reveal. |

- Persistence: `historicalRuns` is append-only. It stores `{runId, requestId, caseId, kind, baselineRunId?, run, snapshot, summary, rowHash}`. `historicalReveals` holds `{runId, requestId, revealedThrough, revealedAt, comparisons, view, revealHash}`, separate from runs. `view` is the `HistoricalCase` filtered to `revealedThrough` at reveal time. `historicalRevealReceipts` holds `{requestId, runId}`, one row per accepted reveal requestId.
- Integrity: `inputHash` = `hashInput(snapshot)` from `packages/agents/src/hash` (relative import, no new package). The snapshot holds caseId, currency, method, bridge roles (cutoff, origin), and the exact input source/fact/assumption objects. `rowHash` covers run+snapshot+summary. Each load checks the run **against its own snapshot, never the current case**: both hashes; row/run/snapshot caseId, kind, baselineRunId, method, cutoff, origin and input IDs agree; summary.run equals run; `HistoricalRunContextSchema` passes on the frozen inputs (with the baseline for alternatives). `revealHash` covers runId, revealedThrough, revealedAt, comparisons and view. A reveal also has to match its run's ID, case and prediction count. Any mismatch fails `INTEGRITY`. Reveal rows written before repair1 have no `view`/`revealHash` (the fields are optional only so old local rows still validate). They fail `INTEGRITY` on read, so reveal a new run.
- Idempotency: the same requestId with the same args returns the stored result. The same requestId with other args fails `CONFLICT`. A new requestId saves a new run with the same inputHash. Reveal: every accepted requestId, including repeats of an already revealed run, gets a receipt bound to its runId. Reusing it for another run fails `CONFLICT`. A run keeps one reveal record whatever the number of keys.
- Timestamps: `createdAt`/`revealedAt` are runtime time and are distinct from `knowledgeCutoff`/`revealedThrough`.
- Evidence semantics (repair2): show a saved forecast's inputs (values, titles, method, cutoff, origin) from `getRun().inputSnapshot`. Use `getCase` only for what is available at the cutoff or frozen at reveal. Do not overlay snapshot facts onto the `getCase` view or recompute observation formulas from them. If the case is edited after a save, the two can differ (e.g. F01 in the snapshot vs F01 in the view). That difference is expected and both are correct for their purpose. Predictions and comparisons are always the frozen ones. The post-reveal view stays frozen and hashed with the comparisons. `inputSnapshot` is unchanged by reveal.

## C0 acceptance: H2c, 2026-10-24 07:40 PDT

- **API-ready for the agreed curated historical journey.** Code8389326, complete dependency checkpoint4a75699. Includes accepted evidence, contracts, engine, schema, generated historical bindings and both persistence repairs. Independent Astra review approved all targeted boundaries. Lead full726tests/typechecks/lint passed; log /tmp/domino-H2c-r2-check.log.
- Isolated anonymous Convex runtime on127.0.0.1:3210/site3211 compiled successfully. Live probes verified concurrent baseline/reveal retries, distinct reveal-key reservation/conflicts, getRun reload, association rejection, exact values, cutoff filtering and unchanged snapshots after reveal. No browser integration claimed.
- **Consumer rule:** getRun.inputSnapshot is authoritative for saved forecast input sources/facts/assumptions. getCase.case is available or frozen revealed evidence. Do not replace original input objects with current values or merge old basis facts into new derived observation ancestry. getCase with runId returns saved method/origin/cutoff.
- Existing pre-repair local smoke reveal records lack frozen evidence and fail closed. Use fresh runs; do not reset data. This is a provisional local database only. No shared cloud deployment.
- H2d actual activity remains pending. API readiness here does not claim an activity feed, complete live UI, prospective accuracy or bankruptcy warning.

## H2d activity readiness (candidate, pending Codex review)

- State: **candidate**, not accepted. Code SHA `6498b752aa6f45549f21ffeca0a2020213ebb66a` on H2-historical-backend (local, not pushed), parent `66b2d2a`. Closure: everything in the H2c acceptance (code 8389326, checkpoint 4a75699: contracts 442d23b, engine a75406d + 41d04e7, evidence a4e49e0, bindings 0377a9b) plus this commit. No contract, engine, evidence or binding change; `_generated/` needed no regeneration (new function is in the existing `historical` module, the data model derives from the schema).
- Schema (additive): `historicalActivity {baselineRunId, sequence, event}` with index `by_feed [baselineRunId, sequence]`. One feed per baseline.

| Function | Args | Result |
| --- | --- | --- |
| `historical:getActivity` (query) | `{caseId, baselineRunId}` | `ActivityEvent[]`, ascending `sequence`, the latest 50 of this baseline's feed. Each row is re-parsed with `ActivityEventSchema` (contract fields only, no storage metadata). `NOT_FOUND` for an unknown case or run or a run of another case, `INVALID_BRANCH` for an alternative run ID, `INTEGRITY` if a stored event names another case or its sequence disagrees with its row. Read-only. No `afterSequence`; not implemented. |

- Emitted events (all `status: "succeeded"`; failures stay client errors and persist nothing):

| Operation | `id` | `kind` | `runId` | `entity` | `label` | `evidenceIds` | `outputId` | `occurredAt` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `saveBaseline`, new save | `evt-saved-<runId>` | `run_saved` | baseline | `{run, runId}` | Baseline forecast saved | run input sources (cutoff, `S7`) | runId | `run.createdAt` |
| `computeAlternative`, new run | `evt-alt-<altRunId>` | `alternative_computed` | alternative | `{run, altRunId}` | Alternative computed | alternative input sources (cutoff) | altRunId | `run.createdAt` |
| `reveal`, first reveal of the run | `evt-reveal-<runId>` | `disclosure_revealed` | baseline | `{comparison, runId}` | Next disclosure revealed | sources newly visible at `revealedThrough` (`S8`) | none | `revealedAt` |

- Atomicity and dedupe: each event is inserted in the same mutation as its outcome, only on the first-write path. Retries, repeat or secondary reveal keys and concurrent duplicates return before emission, so one outcome has one event. Sequence = feed's last indexed sequence + 1, starting at 1; that read makes concurrent writers to one feed conflict and retry under Convex OCC. Queries never write.
- Isolation: a feed holds only its baseline's save, its alternatives and its own reveal. Before that baseline reveals, its feed has only cutoff source IDs, even if another baseline revealed.
- Consumer note (H4): an alternative event's `runId` is the alternative run, not the baseline. The H4 `ingestActivity` scope `{caseId, runId: baselineRunId}` would drop it. Scope by `caseId` only for this feed (it is already scoped server-side), or include the alternative run IDs.
- Verification: focused Convex tests `apps/web/convex/tests` 73/73 (8 new in `activity.test.ts`), convex and web `tsc --noEmit`, `biome check apps/web/convex` clean. Not run: full `pnpm check`, build. Live probe on the existing local watcher (127.0.0.1:3210, fresh run): save + retry, alternative, reveal under two keys gave sequences 1, 2, 3 and one event per outcome. Concurrency tests run under convex-test, which serializes mutations; the true parallel conflict is Convex OCC, not separately probed live.
