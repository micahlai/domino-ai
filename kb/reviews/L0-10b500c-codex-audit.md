# L0 audit of 10b500c by Codex CLI 0.159.2 (codex exec, read-only sandbox, independent of the implementer), 2026-10-24

**REJECT** for `10b500c`. Seven validation gaps reproduced.

1. **P1: An incomplete cohort can pass.** [learning-loop.ts:708](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:708) accepts `pass: true` for one winning row from one company. `wins*16 >= rows*9` scales the threshold instead of requiring nine wins across all sixteen planned pairs. Bind reports to the complete manifest and verify eight quarters per company.

2. **P1: Methods can use different observed outcomes.** [learning-loop.ts:674](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:674) checks each method’s arithmetic independently. A sixteen-row report passes with baseline prediction/observation `100/0` and candidate `100/100` throughout. Require identical observations for each paired comparison.

3. **P1: Responses can lose inherited event taint.** [historical-scenario.ts:452](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/historical-scenario.ts:452) omits `eventSelectedAfterReveal` from response taint. An envelope with that flag true, event post-hoc true, and response post-hoc false parses successfully. Responses must inherit parent event taint.

4. **P2: Seals accept blank and floating identity fields.** [learning-loop.ts:598](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:598) uses permissive `IdSchema` fields. A seal containing whitespace as its protocol ID, `candidate.methodId: "latest"`, and `ruleVersionIds: ["latest", "   "]` passes. Apply immutable, nonblank identity validation throughout seals.

5. **P2: USD normalization accepts unsupported currencies.** [learning-loop.ts:250](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:250) accepts an EUR observation using `usd_dollars_to_cents`. The supported boundary is consolidated USD; unsupported currency must block normalization.

6. **P2: Invalid task cutoffs fail open.** [learning-loop.ts:448](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:448) returns eligible for `cutoff: "invalid"` because comparisons against `NaN` are false. Validate task timestamps or explicitly reject nonfinite parsed dates.

7. **P2: Response extensions accept cyclic dependencies.** [historical-scenario.ts:494](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/historical-scenario.ts:494) checks membership only. A selected assumption depending on itself passes. Validate an acyclic dependency closure before accepting the extension.

The **S4 cross-row deferrals are acceptable for L0**: ownership, hash verification, cutoff checks, response-extension presence, and protocol-to-envelope consistency need combined persistence validation. Findings 3 and 7 are internal to individual objects and should be fixed here. The **E1 completeness deferral is unacceptable** while this schema certifies `pass`.

Other audit results:

- Strictly additive: existing historical/operational definitions, exports, fixtures, and `HistoricalRun.branch` remain unchanged. Stored scenarios reject as `HistoricalRun`.
- Exact money conversion and aggregate strings passed independent boundary checks. Signed errors, exact 5% comparison, company guards, and nine-win threshold work for a complete valid cohort.
- Company/signature scope, rejection, and valid cutoff checks pass. Revocation effects, active-version selection, conflicting rules, and rollback remain L3 responsibilities; these tests do not demonstrate them.

Checks run with Node **24.11.1**:

- `pnpm test`: **327 passed**, eight files. Initial sandbox failure resolved by allowing Vitest temporary/cache writes.
- `pnpm typecheck`: **passed**.
- Biome, five changed TypeScript files: **passed**.
- `git diff --check`: **passed**.
- TypeScript AST scan: **zero `any` keywords**.
- Independent synthetic probes reproduced all seven findings.

No files changed. `data/evaluation/` was not read.