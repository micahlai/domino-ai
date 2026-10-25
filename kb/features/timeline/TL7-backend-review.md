# TL7R independent backend review

Accepted backend commit `9e87c776ca3326d51a41c93e35916ba24b9f6802` for integration into TL7 only. No blocking finding in the bounded review. The source worktree was clean at review finish. This does not authorize any TL5/main merge or Field interface adoption.

Independent scratch tests: **10/10 passed** (`/tmp/TL7-audit/audit.test.ts`, output `test.log`). Checked-in focused tests independently rerun: **15/15 passed**. Author records full `pnpm check` (1,892 tests, five typechecks, lint) and Convex tsc; lead remains responsible for integrated runtime/browser acceptance.

Probes exercised real Convex functions and existing engine:
- Actual stress-engine index equality and frozen rule scope; response forecast equals risk plus response exactly once.
- Impossible cash rule remains breached and clearsAllRules stays false; positive nonbreaching risks have no fabricated failure cause.
- Idempotent launch/get/list/execute is quiet: no forecast, scan, stress or fetch rerun.
- Open invoice/deal/recurring/rule budgets reject before scan.
- Failed financial stage withholds index and publishes no unverified run reference.
- Response stage duplicate is exactly once; changed delivery rejects.
- Expired progress stays immutable under late save and completion.
- Retry company isolation and separate immutable attempts.
- Event ancestry remains rejected through later rule edits; selected run is unchanged.

Read review against build-spec sections 6.3/6.4/6.6 and the TL6–TL7 checkpoint interface. Uses existing engine scan/forecast/score/rank/stress implementations; no engine math, shared contracts, root schema, dashboard, Field, provider, secret or answer-key changes. Additive owned analysis table and composition count are authorized by the task card. Inputs/stages/persisted output use strict schemas; cents and date/effect budgets reuse existing boundary guards.

Intentional limits are explicit: baseline/rule-only starts; max three risks and two costed responses each; neutral-model fallback is a stated stress assumption; fees/negotiation consent are unmodeled; survival index excludes runway and is not a probability; no automatic retries after claim; no real action execution. These are accepted checkpoint scope, not defects.

Scratch only: reviewer made no source edits, commits, env/provider/service calls, or TL5 operations.
