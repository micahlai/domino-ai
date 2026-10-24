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

- State: **candidate** pending Codex audit. Code SHA `0e33f738ddb2d3ca98ec4c35e006801b69b1265e` on H2-historical-backend (local, not pushed). Closure: contracts 442d23b, engine a75406d + period-2u test 41d04e7, evidence a4e49e0 (`data/historical/2u/case.json`, `protocol.json`), Convex module, additive schema.
- Gate: `_generated/api.d.ts` is **not regenerated**. `convex codegen` refuses without `CONVEX_DEPLOYMENT`. Runtime `api.js` is `anyApi`, so tests run; typed `api.historical.*` needs C0 to run `npx convex codegen --typecheck disable` from `apps/web` against an isolated anonymous local deployment, then commit `_generated/`. Not checked in a deployed runtime or browser.
- Module `apps/web/convex/historical.ts`. All inputs, method, decision and reveal time are server-owned. Clients send only IDs. `requestId` is 8-64 chars `[A-Za-z0-9_-]`. Errors are `ConvexError({code, message})`.

| Function | Args | Result |
| --- | --- | --- |
| `historical:getCase` (query) | `{caseId, runId?}` | `{case, knowledgeCutoff, originBalanceDate, visibleThrough, revealed, disclosure, method, projectionAssumptions, riskRules: [], riskRulesNote}`. `case` is filtered to `visibleThrough` (the cutoff, or the run's reveal). Later sources/facts and hindsight assumptions are absent. |
| `historical:saveBaseline` (mutation) | `{requestId, caseId}` | `{runId, run, riskRulesNote}`. Computes `quarterBridge` on the cutoff view, assumptions + `AS-RESTRICTED`, `riskRules: []`. Validated by `HistoricalRunContextSchema`. |
| `historical:computeAlternative` (mutation) | `{requestId, baselineRunId}` | `{runId, run, costRelativeToBaseline: {low,point,high}, benefit: {start, daysInWindow, afterTarget: "unknown"}, postHoc: true, postHocReason, caveats: [A1-DOWNSIDE unmodeled note, point note]}`. Decision is `A1`, and the baseline must be a baseline run. It is not scored against disclosures. |
| `historical:reveal` (mutation) | `{requestId, runId}` | `{runId, revealedThrough, revealedAt, comparisons}`. Baseline runs only. `revealedThrough` = next publication after the cutoff (S8 publishedAt). `compareRun` on the stored run; error = actual - forecast. Stored once per run. |
| `historical:getReveal` (query) | `{runId}` | Same as reveal, or `null` before reveal. |

- Persistence: `historicalRuns` is append-only. It stores `{runId, requestId, caseId, kind, baselineRunId?, run, snapshot, summary, rowHash}`. `historicalReveals` holds `{runId, requestId, revealedThrough, revealedAt, comparisons}`, separate from runs.
- `inputHash` = `hashInput(snapshot)` from `packages/agents/src/hash` (relative import, no new package). The snapshot holds caseId, currency, method, bridge roles, cutoff, origin, and the exact input source/fact/assumption objects. `rowHash` covers run+snapshot+summary. Each load re-checks both hashes and that the current case still matches the snapshot (`INTEGRITY` / `CASE_CHANGED`).
- Idempotency: the same requestId with the same args returns the stored result. The same requestId with other args fails `CONFLICT`. A new requestId saves a new run with the same inputHash. A second reveal of a run returns the first one.
- Timestamps: `createdAt`/`revealedAt` are runtime time and are distinct from `knowledgeCutoff`/`revealedThrough`.
