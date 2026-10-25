# P0-C 66fe754 Codex exception audit (round 4)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170f4-3646-7dd3-823d-081aa31a8f2a. Jayden rule: any remaining correctness failure stops P0-C. STOPPED.

**REJECT `66fe754`.**

1. **P1: All seven schemas can still throw.** The catch block’s `instanceof` inspects an untrusted thrown value. A proxy trap throwing a revoked proxy escapes containment. New probes produced **126 exceptions** across `safeParse`, `safeParseAsync` and `spa`. [feature-boundary.ts:291](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:291>)

2. **P2: Contract acceptance remains looser than the engine.** An accepted, correctly hashed JSON seed containing an 8,000-link derived-fact chain crashes `quarterBridge` with stack overflow. Its JSON length is below the boundary limit. [feature-boundary.ts:515](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:515>)

3. **P2: The integer cap does not protect date arithmetic.** An accepted eligible A1 decision with `benefitLagDays = 2^49` crashes `quarterAlternative`. The bound is conservative for money, but days need a separate limit. [feature-boundary.ts:155](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:155>)

4. **P2: Snapshot admission misses stated restrictions.** Non-enumerable and symbol accessors are silently discarded instead of rejected. Memoized shared subtrees also let an object graph of depth 82 pass the depth-64 guard. [feature-boundary.ts:242](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:242>), [line 269](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-P0C/packages/contracts/src/feature-boundary.ts:269>)

The Zod patch preserves inference and `instanceof`. Composition loses the guard in **28/28 probes**. That limitation is documented and acceptable only within the approved JSON-text boundary. `parse` and `parseAsync` are unchanged delegates.

Checks:

- Contracts: **489/489 tests**. Required typechecks: **4/4**. Biome: **32 files clean**.
- Prior schema fuzz: **38,988 calls, zero throws**.
- New hostile schema probes: **2,583 calls, 126 exceptions**.
- JSON-text probes: **79,999 calls, zero throws**.
- Original differential: **2,140 cases, zero acceptance gaps**.
- New baseline differential: **423 cases, one acceptance gap**. All **420 numeric boundary cases** passed.
- Earlier probes: **497/497**, plus **100/100** regression/canonical assertions, under current rulings.
- Fixtures: **6/6 byte-identical to `189fb0d`**; hashes unchanged; **54/54 hash/data checks passed**.

[Full report and reproduction evidence](/tmp/domino-p0c-exception.Z9GZQb/AUDIT.md)

Repository unchanged. No network or sealed/withheld access. Full application checks and browser execution were outside this scoped audit.