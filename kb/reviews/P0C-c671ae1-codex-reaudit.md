# P0-C c671ae1 Codex re-audit (round 2)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170df-e221-77e3-884c-28919470cbcc. Lead ruling on 3-4: contract may be stricter than engine, never looser; keep calendar-quarter origins and shared-zero rejection, documented.

**REJECT** `c671ae1`. The base schemas close all eight prior gaps, but independent probes found four remaining issues.

1. **P1: Composed validation throws.** [feature-boundary.ts:157](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:157>) returns `z.NEVER` with nonfatal issues, allowing outer refinements to run on the sentinel. Forecast-ready and context `safeParse()` calls throw instead of returning validation failures. **10 reproductions.**

2. **P2: Invalid money throws before rejection.** [feature-boundary.ts:456](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:456>) converts invalid cents with `BigInt`. Fractional or infinite cash values throw from the base seed’s `safeParse()`. **18 reproductions.**

3. **P2: Origin-date rules diverge.** [feature-boundary.ts:357](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:357>) requires calendar-quarter ends. The engine accepts other month ends, including August 31 targeting November 30. **Eight mismatches.**

4. **P2: Assumption-selection rules diverge.** [feature-boundary.ts:394](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:394>) rejects one explicit zero assumption selected for both financing and FX; the engine accepts it. **One mismatch.**

The last two restrictions could be intentional, but fail your stated parity criterion.

Checks:

- Contracts: **410/410 tests**, nine files.
- Typechecks: **4/4**; Biome: **32 files clean**; whitespace check passed.
- New probes: **460/497 passed**, with 37 failures described above.
- Prior regression assertions: **97/97 passed**.
- Hash/data assertions: **40/40 passed**; all six fixture files byte-identical to `189fb0d`.
- All 18 identifier/array boundary probes passed. Engine method pins match; the equality-test deferral to P0-H remains acceptable.

[Full audit and line-by-line comparison](/tmp/domino-p0c-reaudit.ILSdW1/AUDIT.md) · [Probe evidence](/tmp/domino-p0c-reaudit.ILSdW1/results.json)

Repository unchanged. No network or protected-directory access.