# S1: quarterly scenario contracts
- **Goal:** validated additive input/result shapes for one aggregate cash-outflow event and one costed response.
- **Ownership:** packages/contracts/src/historical-scenario.ts, historical-scenario.test.ts, index.ts export only; this Result. No historical.ts, schema, engine, fixtures, UI or dependency changes.
- **Read:** kb/spec/product-workspace-2026-10-24.md, existing historical.ts, checks.ts and quarterBridge/quarterAlternative types read-only.
- **Shape:** HistoricalScenarioInput contains baselineRunId, knowledgeCutoff, targetDate, currency, hypothetical event (id, description, total additional outflow nonnegative cents low/high, effectiveFrom/through, uncertainty text), optional responseAssumptionId and selectedAfterReveal. Result has baseline/event/optional response predictions, unchanged nowcast, explicit effects/cost/timing/feasibility and typed impact nodes/edges. Reuse HistoricalPrediction/Assumption/Period schemas rather than duplicate them.
- **Validation:** real dates; interval strictly after cutoff local date and within target; safe integer cents/ranges; no observed facts as event inputs; unique graph IDs/references, no cycles; edge basis deterministic/assumption/rule/hypothesis with nonempty explanation and typed refs. No default threshold, no implicit insolvency. Referential facts/basis/currency context belongs in engine validation, do not pretend schemas alone establish it.
- **Compatibility:** separate schemas/types only; no widening existing branch unions or breaking exports. Exact field names recorded in Result for S3/S4. Do not design a generic disaster language.
- **Done:** focused schema tests including malformed dates/ranges/graph refs/cycles and existing contracts regression, typecheck/lint. Parent full suite. Commit then stop for independent audit, no push/main/provider.
## Result
- Pending.
