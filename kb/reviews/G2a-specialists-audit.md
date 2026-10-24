# G2a independent audit: blocked at973dac3

October24 12:46 PDT, Codex Astra. Full candidate check863tests/typechecks/lint passes; independent111focused tests and6offline probes show the following defects. No live provider calls. G2b must wait.

1. P1 Run input closure/hindsight: unknown sources/facts/assumptions and rule-source IDs pass. Baseline can reference selectedAfterReveal/hindsight assumptions. These packets reach provider. Reuse existing historical run/case context invariants, not just caseId checks.
2. P1 Comparison integrity: nonexistent prediction/rule, invented predicted/observed values/error, mismatched period and observation already available at cutoff pass to provider. Reuse existing comparison context invariants before engine citations are allowed.
3. P1 Alternative baseline relation: one alternative can point to itself as baseline, omit cost decision assumption, and pass. Require real distinct baseline-kind run with matching cutoff/origin/nowcast and closed decision inputs.
4. P2 Negated caveats: current regex rejects 'There is no guarantee of a positive outcome' and 'This analysis does not show that bankruptcy could have been prevented.' Accept these ordinary cautious statements; retain clearly affirmative overclaim rejection, document pattern checks aren't semantic proof.
5. Minor: checkHistoricalSpecialistOutput embeds unknown citation ID in error text. Return fixed diagnostic strings before server reuse.

Reproduction /tmp/g2a-independent-audit.test.ts, config/tmp/g2a-audit.config.mjs. Probe expectations intentionally document broken behavior; repaired regressions must assert rejection/no outbound provider call. Transport extraction had no regression in63Claude tests.

Smallest repair: reuse HistoricalCaseSchema, HistoricalRunContextSchema, HistoricalComparisonContextSchema or shared validators, instead of parallel hand-written financial checks. Input contract is not deployed and has no app consumers, so it may be reshaped to accept the REAL canonical visible case if that avoids duplication. Never invent URLs/source fields to satisfy schemas. Keep source excerpts bounded and untrusted; source/fact availability still gated by task visibleThrough, and history is server-selected in futureG2b. Tests must include real normalized2U packet acceptance plus valid synthetic boundaries. Consistent structures alone never establish external provenance.

## Repair1 accepted9d7d6e6

Codex Astra re-review: no remaining blocker.162focused tests and8independent probes pass, including actual quarterBridge/quarterAlternative/compareRun output packets for both roles before/after reveal. Canonical context validation closes prior gaps, negated caveats accepted, fixed diagnostics. Full914tests/typechecks/lint pass at/tmp/domino-G2a-repair-check.log. Approval is scoped to reusable specialist boundary, not CREAO integration or live execution. G2b must construct authoritative visibility/history/snapshots and never parse financial numbers from prose.
