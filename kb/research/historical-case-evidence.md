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

## Not verified / gaps

- No raw files or SHA-256 hashes: curl to sec.gov returned HTTP 403, and I did not try to disguise the client. WebFetch only returns model summaries, so figures are quoted from summaries of the page text and should be re-checked against the XBRL instance (`twou-20230930_htm.xml`) by Codex or with a declared SEC User-Agent.
- 10-Q MD&A and the tail of the debt note were not returned by the tool, so the "resources cover 12 months" statement in the candidate note, the covenant thresholds, and absence of a minimum-liquidity covenant are unverified.
- Term loan principal ($372.4M quoted) vs carrying 377,150 vs scheduled-principal total 907,650 not reconciled to components.
- Investing 36,576 vs capex 36,777 (PP&E 4,335 + intangibles 32,442): 201 other investing items unidentified.
- July 25, 2024 Chapter 11 announcement (S5): URL and date carried from the candidate note, not opened.
- 10-K body not read; audited FY numbers may differ from the Q4 release.
- EDGAR times assumed Eastern; convention not confirmed from an SEC page.
- No Q3-standalone operating cash flow; only 9M and TTM figures found.

## Evaluation protocol (predeclared here, before any run)

- Baseline B1: carry 9M operating (-5,840/qtr) and investing (-12,192/qtr) forward, zero financing and FX, from 53,851. Estimate 35,819 combined at 2023-12-31. Scoring against 73,399 is H2's job. Expect a large miss; that is a result to show.
- Metrics needed by the model: combined cash plus restricted cash at a period end (restricted shown separately), operating/investing/financing/FX flows per period, debt maturities, revolver capacity.
- Debt rule R1 (analyst, needs legal review): the 2025-01-30 springing date enters a 12-month look-forward for filings on or after 2024-01-30. Not in window at the cutoff.
- Intervention A1 (analyst ranges, predeclared): further cost cut of 3-6% headcount, anchor $55M/12% = about $4.6M annualized per point; one-time cash cost 10-26% of annualized savings (26% is the Q3 charge/savings ratio and includes non-cash items); first cash savings 1-2 quarters later; cash conversion 50-100%; revenue downside unquantified. Cost precedes savings, so the 2023-12-31 target is probably flat or worse, benefit lands in 2024.
- Hindsight X1: January 2024 factoring, up to $86.2M at 88%. Held out; label as hindsight only.

## For H2/Codex

Needs: a period (non-weekly) fact type with USD-thousands source units; availability timestamp on every fact; text-valued facts (F22, F23, F26 are text-only); derived facts with input IDs; separate held-out file loaded only at reveal. Contract validation is pending, not passed.
