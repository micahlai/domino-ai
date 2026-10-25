# L1 57a1581 Codex audit (round 1)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170c1-5d83-7d52-8576-3f3198559cd4.

REJECT commit `57a1581`.

1. **High: rejected restricted-cash rows become zero.** [source-normalization.ts:590](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L1/packages/engine/src/source-normalization.ts:590)  
   Coverage checks count validated observations, but summation uses the first unfiltered row with `?? 0`. A rejected `$0.001` current component preceding valid `$1.25`, plus `$0.75` noncurrent, incorrectly validates a `$0.75` total-minus-usable difference. Valid components actually total `$2.00`. Reversing rows changes validation. Sum the uniquely validated components and remove the zero fallback.

2. **High: fiscal-calendar evidence can be forged without changing source hashes.** [source-normalization.ts:634](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-L1/packages/engine/src/source-normalization.ts:634)  
   A package whose hashed submissions contain `0630` is initially rejected. Changing only the separate `fiscalYearEnd` property to `1231` produces a complete bridge-role snapshot and bridge. Although normal ingestion extracts the correct value, the public snapshot boundary does not authenticate it. Verify calendar metadata against the hashed submissions before constructing inputs.

Equal validated candidates blocking is acceptable for L1 while selection remains deferred to L2. Missing FX safely remains `missing_input`: requesting every role leaves completeness incomplete, while unrelated bridge roles remain usable with an explicit FX assumption.

Checks on Node **24.11.1**:

- Engine: **233/233 tests passed**, including **32 normalization tests**.
- Independent probes: **72 passed, 3 failed**, reproducing the two findings.
- Independently audited **15 Amplitude source rows** using Python decimal arithmetic; **12 snapshot-role assertions passed**.
- Engine typecheck passed; Biome passed on **32 files**.
- Other probes passed for exact cents, overflow, lexeme preservation, missing metadata, currency/scope rejection, acceptance cutoff, amendments, origin selection, and missing roles.

[Independent probes](/tmp/domino-l1-audit-57a1581.cjs) and [results](/tmp/domino-l1-audit-57a1581-results.txt). No network, sealed/withheld access, or tracked-file changes.