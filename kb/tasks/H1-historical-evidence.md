# H1: Historical evidence bundle
- **Goal:** One defensible case, cutoff, target period and costed intervention, with later observations held separately.
- **Folder:** data/historical/; exceptions kb/research/historical-case-evidence.md and this Result. No feature code.
- **Contracts used:** Coordinate draft historical evidence schemas with H2; never coerce public statements into Snapshot/BankTxn/ForecastWeek.
- **Done when:** Primary URLs/publication dates/periods/units/locators and hashes are recorded; cash scopes reconcile; derived facts cite all inputs; baseline/held-out separation and one intervention's costs/lag/downside are checkable; checked bundle validates against H2 schemas.
- **Notes:** Read historical-case-study-plan.md and project-stages-2026-10-24.md. Default 2U; choose a documented alternative only on evidence fit, not favorable outcomes. No invented historical invoices/payroll, weekly actuals or EBITDA-as-cash. Unknown remains unknown.
- **Handoff:** Push H1-historical-evidence; report source choice, exact SHA, validated versus provisional fields and blockers to H0. Treat preliminary metric needs separately from frozen evidence.
## Result
- Status: provisional corrected bundle (repair 1), NOT frozen, no H2 contract validation. Branch H1-historical-evidence, commit SHA in `git log -1`. Not pushed.
- Fixed: F16 percent had cents 1,200,000, now null. F18 now has the 2025-01-01 revolver springing termination (>$50M of 2025 Notes). F11 relabelled non-current carrying value; added current portion 4,966, total debt carrying 883,090, principal components, scheduled maturities 907,650 (excludes revolver and other borrowings), derived 372,400 = warning's $372.4M.
- Recorded: F30 liquidity-may-not-suffice warning at accelerated maturity (in the 10-Q at cutoff); F31 noteholder refinancing talks; F32 management expectation ($145M over 12-24 months, verified) with the MD&A 12-month sufficiency sentence marked unretrieved. R1 relabelled illustrative policy. A1 hypothetical, feasibility unknown, bounded cash arithmetic and revenue-downside range added.
- Hashes (raw bytes, plain curl): S7 Q3 release c1c9486e9a337b4b28b4980a8db86f10ddf8617dc9cbbc90a7209e98daee7e4f; S8 Q4 release 7c8500056751dcc9b9c46c94f5813e1b8f3d899041a577600c8aa3b54a2f5d24. Q4 public 16:01:00 ET vs SEC 16:09:41 ET.
- Verified facts: all cash, restricted, AR and cash-flow figures re-found in S7/S8 bytes; 22 integer reconciliations pass.
- Gaps: no 10-Q hash (sec.gov 403; reader text is model-processed); MD&A not returned by the reader (ends in Note 10); covenant thresholds and Note 8 quotes unverified against bytes; S2-S6 unhashed; S5 and 10-K body unread; no H2 validation.
