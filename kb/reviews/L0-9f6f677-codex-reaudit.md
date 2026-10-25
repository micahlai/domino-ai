# L0 re-audit of 9f6f677 by Codex CLI 0.159.2 (codex exec, read-only, independent), 2026-10-24

**REJECT** `9f6f677`, reviewing `16a3a56..HEAD`. Five original findings are fixed; cohort completeness and dependency acyclicity remain incomplete.

1. **P1: Repeated quarters can satisfy the full-cohort gate.** [learning-loop.ts:712](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:712) counts pairs per company, without requiring distinct target quarters. My synthetic report repeated one quarter eight times per company under unique pair IDs and parsed with `pass: true`. Require unique `(cik, targetQuarter)` identities and the complete planned quarter set.

2. **P2: Duplicate assumption IDs bypass cycle validation.** [historical-scenario.ts:482](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/historical-scenario.ts:482) collapses IDs into sets without rejecting duplicates. Both `[A(), A(dependsOn=A)]` and `[A(), B(dependsOn=A), A(dependsOn=B)]` parse successfully. Reject duplicate assumption IDs before checking dependencies. The original acyclicity finding remains open.

3. **P2: Report manifest and seal can identify different protocols.** [learning-loop.ts:692](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/learning-loop.ts:692) never compares their protocol identities. Changing the manifest’s protocol ID, version and content hash still permits a passing report. Require those fields to match. This is internal consistency, separate from deferred hash-versus-bytes verification.

4. **P3: Dependency ordering adds an undocumented restriction.** [historical-scenario.ts:495](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L0/packages/contracts/src/historical-scenario.ts:495) rejects the acyclic closure `[A(dependsOn=B), B()]`. The extension spec does not require array order. Counterargument: `HistoricalCase` already requires dependencies first, so consumers can sort. Document that requirement or validate cycles independently.

Independent probes confirmed the other five original fixes:

- Both methods share one observation; per-method observations are rejected.
- Responses inherit `eventSelectedAfterReveal` taint.
- Seal identities reject blanks, whitespace and case variants of `latest`.
- Both USD transforms reject non-USD observations and mapping receipts.
- Invalid cutoff, `recordedAt` and `effectiveFrom` timestamps fail closed.

Compatibility and money checks passed: existing statements/exports, fixtures and `HistoricalRun.branch` are unchanged; scope remains additive. AST scan found **zero `any` keywords**. Exact decimal conversion, beyond-safe-range errors, aggregate sums and the 5% threshold passed BigInt probes. No new floating-point money arithmetic was found.

Checks run with **Node 24.11.1**:

- `packages/contracts`: `pnpm test` **335 passed**, eight files.
- `packages/contracts`: `pnpm typecheck` **passed**.
- Biome on five changed TypeScript files: **passed**.
- `git diff --check`: **passed**.
- Independent synthetic checks: **149 assertions passed**, plus adversarial reproductions above.

Initial Vitest sandbox write failures were resolved by allowing temporary/cache writes. No source files changed. `data/evaluation/` was not read.