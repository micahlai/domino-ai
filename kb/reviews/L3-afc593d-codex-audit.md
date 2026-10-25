# L3 afc593d Codex audit (round 1)

Reviewer: Codex CLI 0.159.2, read-only, session 01a17101-d3bb-72a3-ab29-2771d0d4372e.

**REJECT `afc593d`.** Candidate arithmetic passes. Source binding, first-record timing, and exception handling remain incomplete.

1. **High: Candidate C accepts history without binding it to the forecast’s company, definition, or receipt contents.** [period-candidate.ts:241](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L3/packages/engine/src/period-candidate.ts:241>)  
   Changing Amplitude’s preceding OCF from **235,300,000 cents to zero**, while retaining every L2 lineage ID, produces `predicted`: total **20,118,078,261 cents**, instead of **19,969,736,957**. Both flows can also identify another company, or use unrelated definitions, and pass. The wrapper accepts company A’s method rule with company B’s flow histories. Bind histories to the trusted L1/L2 snapshot and B’s exact roles. L2’s accepted internal-trust precedent is a counterargument, but nonempty lineage IDs do not establish those guarantees.

2. **High: the first decision can be backdated.** [learned-rules.ts:323](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L3/packages/engine/src/learned-rules.ts:323>)  
   With empty history, supplying feedback and decision timestamps of `2022-11-03T20:00:00Z` creates an accepted rule that selects C at cutoff `2022-11-03T20:08:14Z`. The checks enforce relative chronology, without establishing when the first feedback was actually recorded. Trusted ingestion timestamps are required before claiming “no backdating”; the engine can remain clock-free.

3. **Medium: validation can throw while handling a throwing getter.** [period-candidate.ts:120](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L3/packages/engine/src/period-candidate.ts:120>)  
   A getter that throws a revoked proxy causes `e instanceof NotPlainData` itself to throw. Reproduced through all seven main entry points. Return a fixed fallback error without inspecting or stringifying an arbitrary thrown value.

Worker-decision rulings:

| Decision | Ruling |
|---|---|
| **(1)** Resolve mapping overrides without changing L1 import | **Accept for this bounded card.** Authority and method changes satisfy its OR requirement. Mapping application remains incomplete. |
| **(2)** Global/company overlap and agreeing duplicates block | **Accept.** Conservative, deterministic, and consistent with equally applicable rules blocking. |
| **(3)** Reuse B financing/FX in Cq | **Accept with protocol-zero inputs.** Nonzero range tests verify the generalized arithmetic, not the frozen evaluation recipe. |
| **(4)** IDs use `ruleId/vN` | **Accept.** Deterministic version IDs; duplicate IDs and versions reject. |

Checks:

- **340/340 engine tests passed**, 15 files, including **34 new L3 tests**.
- Engine typecheck passed; Biome passed on **38 files**; diff whitespace check passed.
- Independent audit: **2,523/2,536 assertions passed**. The **13 failures** reproduce findings 1–3. [Probe script](/tmp/domino-L3-afc593d-audit.py), [results](/tmp/domino-L3-afc593d-probe-results.json).
- **83 monetary scenarios** checked with Python `Fraction`, including Q1–Q4 derivations, range endpoints, held-flat restricted cash, unchanged nowcast, and single rounding. No arithmetic mismatch.
- Independently verified later-work changes and receipts, earlier-work equality, immutable prior results, rule-scope isolation, rejection no-op, append-only revocation, rollback for new work, competing-rule blocking in both orders, revocation clearing conflicts, post-cutoff exclusion, and ordinary shared getter/proxy reads occurring once.
- Missing or blocked predecessors remain ineligible. No zero fallback was reproduced.

Amplitude’s **six source rows and two acceptance instants** independently match:

`24,810,000,000 + (−2,180,900,000 × 34/92) + (−6,399,200,000 × 58/92)`

Exact target: `459303950000/23`; rounded C total **19,969,736,957**, usable **19,884,536,957**, B total **22,629,100,000 cents**.

No network, sealed/withheld access or listing, or tracked-file changes. Broader application/runtime integration was not tested.