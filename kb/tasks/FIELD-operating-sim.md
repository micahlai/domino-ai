# FIELD: Pure filing-backed operating ledger
- **Goal:** One deterministic reconciling ledger for2U and two inspired secondary demos, across four scenarios.
- **Folder:** packages/sim only; separate worker result note in kb/features/field/TAKEOVER-OPERATING-SIM.md.
- **Contracts used:** Existing Snapshot/WorldState/Constraint; exact new API in ../features/field/OPERATING-LEDGER-CONTRACT.md.
- **Done when:** Exact cash/revenue/AR and cash-flow reconciliations, deterministic scenario isolation, and existing source-shape round-trip checks pass; sim tsc/tests/lint pass.
- **Notes:** Only2U cutoff-facts and pre-cutoff Q3 HTML; no held-out/evaluation/assumptions.json. Research anchor JSON for Asana/GitLab is available in kb/features/field/research. No claimed real transactions or covenants.
## Result
- Done: Implemented all frozen pure API exports, three companies and four future-only scenarios. Exact integer-cent cash, revenue, receivables, accrual and expense bridges; all permitted monetary anchors retained with units, periods and citations. One canonical snapshot, private regenerated settlement timing, observable future plans and obligations, illustrative constraints, stable synthetic links and cohort labels.
- Verified: 94 simulator tests including 21 new operating tests; simulator TypeScript and Biome pass. Tests cover all 12 combinations, source conversion, all history unchanged across scenarios, paid-record bank links, no future observation leaks, 13-week engine forecast conservation and 91-day advancement consistency.
- Limits: Existing engine has three cash-flow sections and can group FX under other operating. Provenance retains the authoritative four filing-category totals. Source-shape connector round trips belong to integration/backend checks. No web suites, runtimes, provider calls or protected data accessed.
- Handoff: `kb/features/field/TAKEOVER-OPERATING-SIM.md`.
- Integration follow-up: Empty optional payout arrays omitted; GitLab derived quarter citations corrected to Q3 primary plus both filing URLs. Focused 22 operating tests and simulator TypeScript pass. Broader 2U anchor retention review continues separately.
