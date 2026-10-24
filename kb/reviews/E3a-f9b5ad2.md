# E3a review: f9b5ad2
Date: 2026-10-24. Implementation: Claude Code. Independent reviewer: GPT-6 Astra, xhigh. Integration owner: Codex brain.
Decision: hold merge for two correctness defects. Fix on the existing E3a-forecast branch with kb/tasks/E3a-r1-money-dates.md.

## Verification
- Branch f9b5ad2 is based on planning commit 82540a6 and changes only six files in packages/engine/src.
- Lead reran TURBO_FORCE=true pnpm check using Node 24.11.1 and pnpm 9.12.0. Four package typechecks, 26 engine tests, 13 contract tests and lint passed without cached test results.
- Independent reviewer ran the schema-valid repros below through engine.forecast on Node 24.11.1. No feature files were changed.

## Blocking findings
1. P1, packages/engine/src/changes.ts:87-90: historical hiring savings create new forecast cash. With asOf 2026-10-30, monthlyCost 300000 cents, fromDate 2026-10-01 and toDate 2026-10-02, the result credits 9677 cents in week 0. Expected future savings are zero: opening cash already covers that historical period. Exclude historical days, preserving future days between asOf and the first Monday.
2. P2, packages/engine/src/changes.ts:67 and 90-96: intermediate floating-point arithmetic changes cent rounding. With asOf 2027-01-29, monthlyCost 100018 cents and hire interval [2027-02-01, 2027-02-08), actual savings are 25004 cents; exact 100018 * 7 / 28 = 25004.5 must round to 25005. A 125-cent invoice discounted 64.4% similarly produces 44 cents instead of 45. Use exact arithmetic until the final rounding and cover both cases.

## Accepted scope and integration limits
- The original Kestrel fixture rejection is the brain's temporary guard for the missing deal/invoice link. Fix the shared contract separately; do not remove the guard or delete the deal merely to make the demo run.
- No dominoes, stress test, risk scan or learning are implemented. Full E3 is still open.
- Engine inputs currently rely on callers supplying validated canonical records. Connectors and agent boundaries must enforce that guarantee before integration.
- Recurring anchor and savings-as-inflow remain documented provisional conventions. This review does not establish production financial validity.
- The worker Result is currently recorded in main's tracked task card, outside f9b5ad2. The repair card explicitly instructs the worker to keep its new Result in its own worktree.
