# 2U historical evidence checkpoint (H1, provisional)

Run date 2026-10-24. Data: `data/historical/2u/` (sources, cutoff-facts, assumptions, held-out, validation JSON). Layout is provisional; not validated against the H2 contracts.

## Call

2U, cutoff end of 2023-11-10 (US Eastern), target 2023-12-31, first reveal the Q4 release accepted 2024-02-12 16:09:41. Chosen on evidence fit (separate cash and restricted cash, 9M cash-flow split, dated debt terms, quantified cost action all public before the cutoff), not on outcome. Appgate and WeWork were not re-audited; that is a limit of this run, not a finding.

Counterargument: the case is weak for the "analyst warning" story. The Q4 reveal shows cash UP, so the honest headline is a baseline miss plus a debt-maturity question, not a cash crisis.

## Verified (primary SEC pages, read via WebFetch)

| Item | Value | Source |
| --- | --- | --- |
| 10-Q accepted | 2023-11-09 16:45:46 | filing index 0001459417-23-000042 |
| Q3 8-K accepted | 2023-11-09 16:01:46 | index 0001459417-23-000039 |
| Q4 8-K accepted | 2024-02-12 16:09:41 | index 0001459417-24-000006 |
| 10-K accepted | 2024-03-06 16:25:17 | index 0001459417-24-000011 |
| 2023-09-30 cash / restricted / combined | 41,141 / 12,710 / 53,851 (USD thousands) | 10-Q balance sheet p.4, cash flow p.8 |
| 9M 2023 operating / investing / financing / FX | -17,520 / -36,576 / -73,513 / -1,118 = -128,727 | 10-Q cash flow p.8 |
| 2023-12-31 cash / restricted / combined (held out) | 60,689 / 12,710 / 73,399 | Q4 release |
| FY2023 operating / investing / financing / FX (held out) | -3,431 / -49,831 / -55,018 / -899 = -109,179 | Q4 release |

Derived Q4 2023 (FY minus 9M, available only from 2024-02-12): operating +14,089, investing -13,255, financing +18,495, FX +219, net +19,548. The net equals 73,399 - 53,851 exactly. Financing is about the size of the revolver going from $20M drawn (10-Q) to $40.0M drawn (Q4 release); that attribution is my inference, unverified.

Cutoff-eligible context: 12% Q3 headcount cut with expected $55M annualized savings and Q3 restructuring charge 14,085 (Q3 release); revolver $40M commitment/$20M drawn; $380M 2.25% converts due 2025-05-01; $147.0M 4.50% converts due 2030; term loan maturity 2026-12-28 with a springing maturity tied to >$40M of 2025 Notes outstanding on 2025-01-30; management expects about $145M cash from portfolio management over 12 to 24 months (issuer expectation).

## Repair 1 (2026-10-24, still provisional, not frozen)

- Unit fix: F16 (12% headcount cut) is a percent; its `cents` was wrongly 1,200,000, now null. Every remaining `cents` equals thousands x 100,000 (checked in code).
- Raw bytes archived and hashed (plain curl, HTTP 200, default User-Agent): S7 Q3 release `c1c9486e9a337b4b28b4980a8db86f10ddf8617dc9cbbc90a7209e98daee7e4f`, S8 Q4 release `7c8500056751dcc9b9c46c94f5813e1b8f3d899041a577600c8aa3b54a2f5d24` (`data/historical/2u/raw/`, Q4 under `held-out/`). Every cash, restricted cash, AR, 9M and FY flow figure in the bundle was re-found in these bytes. The 10-Q has no hash: sec.gov returns 403 to curl and the reader returns model-processed text.
- 10-Q Note 8 (Debt), read in full via the reader: revolver $40M commitment, $20M drawn, $20M available; revolver terminates 2026-06-28 or 2025-01-01 if more than $50M of 2025 Notes remain outstanding on 2025-01-01 (F18). Term loan matures 2026-12-28 or 2025-01-30 if more than $40M remain (F22).
- Debt amounts, three different numbers: balance-sheet long-term debt 878,124 is non-current and net of discount; total debt carrying 883,090 includes current portion 4,966; scheduled principal total 907,650 excludes the $20M revolver and 2,118 other borrowings. None is the 2025 wall (2025 Notes principal 380,000). The warning's $372.4M term loan equals 377,150 - 950 - 3,800 exactly (derived C01).
- Warning (F30, in the 10-Q at cutoff): company liquidity "may not be sufficient to pay off the balance on the accelerated maturity date". Short phrase is reader-extracted and matches a secondary source (On EdTech, 2023-11-30). The Note 8 text has no going-concern sentence; the first going-concern language is in the Q4 release (held out).
- Management expectation (F31, F32): in the Q3 release, about $145M portfolio-management cash over 12 to 24 months, and active talks with noteholders to refinance the converts. An explicit 12-month sufficiency sentence was not found because the reader never returned MD&A. That is a gap, not a finding either way.
- Q4 timing: issuer release public 2024-02-12 16:01:00 ET (PR Newswire metadata), SEC acceptance of the 8-K 16:09:41 ET. Availability is the earlier time; both are after the cutoff.
- R1 is an illustrative Domino policy. The company's own 10-Q already warned, so R1 is not a historical first warning. A1 is hypothetical with unknown feasibility; prior cuts are not treated as proof of savings. A1 in-window cash effect is -1,375 to -7,150 (thousands), savings 0 in window; revenue downside is an unquantified hypothetical (offset 0 to 50% of gross savings, or 0 to 1% of revenue guidance midpoint).

## Still not verified

- 10-Q Item 2 MD&A, Item 1A, covenant thresholds; Note 8 quotes are reader fragments, not byte-verified.
- SEC acceptance times (read from index pages via reader); timezone convention not confirmed from an SEC page.
- S2, S3, S4, S5, S6 have no hash. 10-K body and the 2024-07-25 announcement (S5) were not read.
- Investing 36,576 vs capex 36,777: 201 of other investing items unidentified.
- No Q3-standalone operating cash flow. No contract validation (H2 schemas under repair); layout is not normalized.

## Evaluation protocol (predeclared here, before any run)

- Baseline B1: carry 9M operating (-5,840/qtr) and investing (-12,192/qtr) forward, zero financing and FX, from 53,851. Estimate 35,819 combined at 2023-12-31. Scoring against 73,399 is H2's job. Expect a large miss; that is a result to show.
- Metrics needed by the model: combined cash plus restricted cash at a period end (restricted shown separately), operating/investing/financing/FX flows per period, debt maturities, revolver capacity.
- Debt rule R1 (illustrative policy, not a historical first warning): the 2025-01-30 springing date enters a 12-month look-forward for as-of dates on or after 2024-01-30. Not in window at the cutoff.
- Intervention A1 (analyst ranges, predeclared): further cost cut of 3-6% headcount, anchor $55M/12% = about $4.6M annualized per point; one-time cash cost 10-26% of annualized savings (26% is the Q3 charge/savings ratio and includes non-cash items); first cash savings 1-2 quarters later; cash conversion 50-100%; revenue downside unquantified. Cost precedes savings, so the 2023-12-31 target is probably flat or worse, benefit lands in 2024.
- Hindsight X1: January 2024 factoring, up to $86.2M at 88%. Held out; label as hindsight only.

## For H2/Codex

Needs: a period (non-weekly) fact type with USD-thousands source units; availability timestamp on every fact; text-valued facts (F22, F23, F26 are text-only); derived facts with input IDs; separate held-out file loaded only at reveal. Contract validation is pending, not passed.
