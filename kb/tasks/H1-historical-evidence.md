# H1: Historical evidence bundle
- **Goal:** One defensible case, cutoff, target period and costed intervention, with later observations held separately.
- **Folder:** data/historical/; exceptions kb/research/historical-case-evidence.md and this Result. No feature code.
- **Contracts used:** Coordinate draft historical evidence schemas with H2; never coerce public statements into Snapshot/BankTxn/ForecastWeek.
- **Done when:** Primary URLs/publication dates/periods/units/locators and hashes are recorded; cash scopes reconcile; derived facts cite all inputs; baseline/held-out separation and one intervention's costs/lag/downside are checkable; checked bundle validates against H2 schemas.
- **Notes:** Read historical-case-study-plan.md and project-stages-2026-10-24.md. Default 2U; choose a documented alternative only on evidence fit, not favorable outcomes. No invented historical invoices/payroll, weekly actuals or EBITDA-as-cash. Unknown remains unknown.
- **Handoff:** Push H1-historical-evidence; report source choice, exact SHA, validated versus provisional fields and blockers to H0. Treat preliminary metric needs separately from frozen evidence.
## Result
- Done: Provisional 2U bundle. Cutoff 2023-11-10 ET, target 2023-12-31, reveal 2024-02-12. Four filing acceptance times checked on SEC index pages; 9M cash flows and balances read from the 10-Q; Q4 cash flows derived (net +19,548, reconciles). Baseline B1, debt rule R1 and one intervention A1 (analyst ranges) predeclared; factoring is held-out hindsight X1.
- Files and commit: data/historical/2u/{sources,cutoff-facts,assumptions,held-out,validation}.json, kb/research/historical-case-evidence.md. Commit SHA: see `git log -1` on H1-historical-evidence (local, not pushed).
- Verification: Python asserts passed on cash reconciliations. NOT done: raw-file hashes (sec.gov 403 to curl; WebFetch gives summaries only), contract validation against H2 (schema not frozen), MD&A/covenant/liquidity text, S5 (2024-07-25 announcement) not opened, 10-K body not read.
- Watch out / next: Figures come from WebFetch summaries, re-check against the XBRL instance with a declared SEC User-Agent before freezing. Q4 cash rose, so the demo headline is a baseline miss and a 2025 maturity question, not a cash crisis. A1 is analyst assumption, not evidence. Normalization list is in validation.json.
