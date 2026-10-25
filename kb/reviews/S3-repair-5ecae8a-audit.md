# S3 repair 5ecae8a independent audit

What this change does: the quarterly scenario engine now accepts the saved baseline's explicit restricted-cash method assumption when its value, timing and reported basis match the engine's held-flat method. It preserves the saved input manifest and still rejects decisions or unsupported extra assumptions. The repair changes two engine files and its task Result only.

Looks good. Ship the scoped engine repair after the integration owner schedules preview integration. This review does not merge it or activate scenarios. No blocking finding remains in the reviewed repair.

## Independently checked

- Clean S3-quarterly-event-engine checkout at 5ecae8a, parent 38297d4. Read diff, quarterScenario/checkBaseline/responseFor callers, quarterBridge input closure, actual 2U assumption definition and HistoricalRunContext validation. Engine stays pure; existing money/date helpers and integer arithmetic retained. No contracts/backend/data/provider/UI edits in repair.
- Node 24.11.1 focused period/period-2u/period-scenario: 54/54 pass, uncached. Engine typecheck and changed-file lint pass.
- `/tmp/domino-s3-repair-audit.ts`: 14 independent probes pass. Actual 2U source bundle is filtered like backend visibleCase, then reduced to the baseline's frozen sources/facts/assumptions. Event-only works without A1 or revealed data; a separate cutoff-safe A1 extension works with explicit post-hoc signal. Baseline JSON and nowcast stay identical. Fixed hand-computed event/response results match.
- Probes reject one-time cost, benefit lag, dependency, late effective date, wrong unit, missing/wrong basis, tuned value, omitted required bridge assumption and changed prediction. Reordered identical assumption IDs are accepted without rewriting the baseline. Existing tests also cover wrong method, duplicates, hindsight/post-reveal assumptions, pre-cutoff events and missing sources.
- Full `pnpm check` on S3 passes: five uncached typechecks ; 1,208 uncached tests (contracts 295, engine 201, agents 298, sim 5, web 409); fresh lint 263 files. No cache replay claimed as a new execution.
- Diff whitespace check passes. No implementation process launched by this audit, no provider calls, no runtime/database mutation.

## Integration limits

- Probes use real source data and backend-shaped/frozen manifests assembled in memory, not a read/write round trip against preserved databases. Stored inputHash/rowHash integrity remains the backend/S4 responsibility; this pure engine audit is not a persistence acceptance.
- A1's retrospective protocol post-hoc flag is outside the engine case. S4 must freeze/propagate it and a deliberate response evidence extension. Do not persist a falsely predeclared response because the caller omitted the protocol signal.
- Not checked: new production build, browser, durable scenario API, local database round trips or CREAO. Those do not exist in this repair's scope. No preview merge/main change performed.

Verdict: Ship the scoped engine repair. Claude lead owns queue; Codex is audit/integration support on request. Review complete; next owner decides the preview integration checkpoint.
