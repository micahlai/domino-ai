# L2 5ec495d Codex final re-audit (round 3)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170e4-969d-77d3-95dd-4cb0e66e40c8. Third failure: L2 stopped pending Jayden.

**REJECT `5ec495d`.** One regression reopens the earlier read-once finding.

1. **Medium: shared references are read repeatedly.** [source-reconciliation.ts:102](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L2/packages/engine/src/source-reconciliation.ts:102>) tracks active ancestors but does not memoize completed copies. An acyclic object referenced twice has its getters read twice. Independently reproduced:
   - `reconcileSources`: one shared record becomes conflicting **100,000 / 100,100-cent** candidates.
   - `quarterFlow({ ignored: prior, ...ytd }, prior)`: returns **−78,600,001**, expected **−313,900,000 cents**.
   - `cashIdentity`: falsely reports a tie despite a **one-cent difference**.

   Memoize copies by object identity while retaining ancestor tracking for cycle rejection. All three reproductions pass against `b032d3e`. Ordinary JSON inputs pass, but accepted accessor inputs violate the explicit read-once guarantee.

Checks:

- **300/300 engine tests passed**, 13 files, including **57 L2 tests**.
- Engine typecheck passed; Biome passed on **34 files**; diff whitespace passed.
- **376 independent probes: 373 passed, 3 failed**, all reproducing finding 1.
- **272 rejection probes** passed across all three entry points. Exact cents, rounding rejection, eligibility, dated scoped decisions, ordinary-input permutations, and unrelated-key isolation passed.
- **11/11 L1 composition checks passed** using Amplitude’s real development package: **435 records, 373 observations, 196 reconciled keys**. Package, mapping, snapshot, and arithmetic composition passed. The submissions `Uint8Array` remains in L1’s wrapper, outside L2’s package argument.
- Independent Decimal audit passed: **14 monetary rows**, **2 acceptance instants**, Q3 OCF **−313,900,000 cents**. Missing FX correctly blocks the complete real cash identity.

Rejecting non-enumerable properties and array holes is acceptable for this boundary. Legitimate L1 outputs contained neither; rejecting them prevents silently discarded state.

Engine scope only. No network, sealed/withheld access or listing, or tracked changes.