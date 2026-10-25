# L2 75d34b5 Codex audit (round 1)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170d8-f481-7683-9738-310f83f79139. Lead decision on finding 1: remove caller rounding disclosures; exact cents or dated accepted decision.

**REJECT `75d34b5`.**

1. **High: forged rounding silently resolves conflicts.** [source-reconciliation.ts:197](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L2/packages/engine/src/source-reconciliation.ts:197>) accepts any nonblank locator, then discards it. A fake disclosure changes conflicting $1,000/$1,001 observations into a deterministic selection of **100,100 cents**, with historical source eligibility. Authenticate and retain precision evidence, or require a dated accepted decision.

2. **Medium: arithmetic helpers accept backdated eligibility.** [source-reconciliation.ts:712](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L2/packages/engine/src/source-reconciliation.ts:712>) checks timestamp syntax without requiring `eligibleAt >= availableAt`. Both YTD subtraction and cash identity return eligibility in **2020** for inputs available in **2022**.

3. **Medium: validated caller values are read again.** [source-reconciliation.ts:721](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L2/packages/engine/src/source-reconciliation.ts:721>) rereads `cents` after validation. An accessor changing between reads produces **−235,299,877 cents** instead of **−313,900,000**, with `ok: true`. Nested rounding inputs also remain mutable through package validation. Ordinary plain inputs pass; the claimed private snapshot boundary does not.

Worker-decision rulings:

| Decision | Ruling |
|---|---|
| **(1)** Eligible candidates in receipts; late entries in `excluded` | **Accept.** Preserves cutoff safety and late-source lineage. |
| **(2)** One accession equals one evidence origin | **Accept.** Repeated packages do not add votes; disagreements still block. |
| **(3)** Caller rounding disclosure with locator | **Reject.** Forgery silently accepts a conflict and loses its locator. |
| **(4)** Multiple applicable decisions block; L3 selects versions | **Accept.** Also verified tied amendment instants: disagreement blocks, agreement selects both. |
| **(5)** Trusted packages without hash re-verification | **Accept only as an internal L1 consumer.** L2 provides no authentication guarantee. Tampered values retaining the original hash are accepted; downstream integration must preserve authenticated intake and L1’s calendar gate. |

Checks:

- **276/276 engine tests passed**, across **13 files**, including **33 L2 tests**.
- Engine typecheck, Biome on **34 files**, and diff whitespace passed.
- **65 independent probes: 59 passed, 6 failed**, reproducing the three findings.
- Verified stale resolution IDs, permutations, repeated accessions, unrelated-key isolation, and absence of majority, averaging, or latest-retrieval selection.
- Independently verified **14 Amplitude rows** and **2 acceptance instants** using Decimal arithmetic. Q3 OCF is **−313,900,000 cents**.
- **68,876,469 cents is the synthetic identity**, not an Amplitude observation. Missing FX correctly blocks Amplitude’s complete identity.
- No network, protected-data access/listing, or tracked changes.

[Full audit](/tmp/domino-L2-75d34b5-audit.md) · [Independent probes](/tmp/domino-l2-audit-75d34b5.cjs) · [Probe results](/tmp/domino-l2-audit-75d34b5-results.txt) · [Independent money audit](/tmp/domino-l2-money-audit-75d34b5.py)