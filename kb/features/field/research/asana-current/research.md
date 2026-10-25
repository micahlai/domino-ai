# Current Asana filing anchors for fictional Taskline

## Eligible quarter and sources

As of **October 25, 2026**, the latest eligible Asana quarterly filing is its FY2027 Q2 [Form 10-Q](https://www.sec.gov/Archives/edgar/data/1477720/000147772026000060/asan-20260731.htm), for the quarter ended **July 31, 2026**. [SEC filing detail](https://www.sec.gov/Archives/edgar/data/1477720/000147772026000060/0001477720-26-000060-index.htm) records accession `0001477720-26-000060`, filed and accepted **September 3, 2026 at 16:18:39 Eastern**. The [SEC company filing list](https://www.sec.gov/edgar/browse/?CIK=0001477720) and [Asana quarterly-results list](https://investors.asana.com/financials/quarterly-results) both identify this as the newest 10-Q available by the as-of date. The next fiscal quarter does not end until October 31, 2026. Asana's [Q2 earnings release](https://investors.asana.com/news-releases/news-release-details/asana-announces-second-quarter-fiscal-2027-results) was published September 3, 2026.

The comparable [FY2027 Q1 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1477720/000147772026000039/asan-20260430.htm) covers the quarter ended **April 30, 2026**. [SEC filing detail](https://www.sec.gov/Archives/edgar/data/1477720/000147772026000039/0001477720-26-000039-index.htm) records accession `0001477720-26-000039`, filed and accepted **May 28, 2026 at 16:17:38 Eastern**.

All monetary source strings in [anchors.json](anchors.json) are **USD thousands**. Parentheses are negative numbers. The intended Taskline modeled period is **May 1 through July 31, 2026**; the report was published later, on September 3. These are Asana figures that constrain a fictional reconstruction, not Taskline transactions.

## Reported endpoints and operations

| Reported item | April 30, 2026 | July 31, 2026 | Source |
| --- | ---: | ---: | --- |
| Cash and cash equivalents | 193,656 | 219,562 | Q1 and Q2 10-Q balance sheets, p. 1 |
| Restricted cash | 696 | 844 | Same |
| Marketable securities | 230,984 | 120,289 | Same; separate from cash |
| Accounts receivable, net | 73,483 | 78,645 | Same |
| Accounts payable | 25,155 | 15,438 | Same |
| Accrued expenses and other current liabilities | 105,559 | 119,875 | Same |
| Deferred revenue, current | 322,931 | 350,337 | Same |
| Deferred revenue, noncurrent | 187 | 379 | Same |

The Q2 10-Q statements of operations, p. 2, report three-month revenue `216,429`, cost of revenues `30,325`, R&D `81,728`, sales and marketing `104,384`, G&A `41,211`, total operating expenses `227,323`, operating loss `(41,219)`, and net loss `(39,189)`. Note 12, p. 25, reports `56,326` of stock-based compensation *expense* in the income statement for the quarter. Do not substitute the stockholders-equity rollforward amount, which includes capitalized compensation.

## Cash-flow derivation and check

The Q2 10-Q cash-flow statement, p. 8, is **six months ended July 31**. The Q1 10-Q cash-flow statement, p. 6, is **three months ended April 30**. `anchors.json` retains both original strings and a derivation recipe for each comparable line: parse USD thousands as integers, then subtract first-quarter from six-month amounts in code. Asana's Q2 earnings release independently prints three-month cash flows, so its original strings serve as direct crosschecks.

| Cash-flow subtotal | Six months, Q2 10-Q | First quarter, Q1 10-Q | Q2 direct release check |
| --- | ---: | ---: | ---: |
| Operating | 86,290 | 40,244 | 46,046 |
| Investing | 29,330 | (3,422) | 32,752 |
| Financing | (94,062) | (41,925) | (52,137) |
| FX effect on combined cash | (1,405) | (798) | (607) |

The release separately reports Q2 acquisition cash `(71,616)`, securities purchases `(31,707)`, securities sales `133,603`, securities maturities `8,506`, property and equipment `(1,494)`, capitalized software `(4,540)`, term-loan repayment `(1,250)`, and common-stock repurchases `(51,541)`. Preserve those category components in the reconstructed ledger. The Q1 10-Q prints no acquisition-cash or security-sales line; this artifact does **not** label either as a reported zero. The release supplies the quarter figures directly.

The cash-flow statements reconcile **combined cash and restricted cash**: first-quarter ending `194,352` and six-month ending `220,406`. Those endpoints align with the balance-sheet cash and restricted-cash components. Use the actual FX category, not a cash residual. Securities are not bank cash. Reported receivables and deferred-revenue endpoints can constrain a synthetic billing and collection bridge, but their simple changes are not reported gross billings or receipts, especially because the quarter included an acquisition. GAAP expenses and stock compensation are not cash payroll or vendor payments. Dates, counterparties, invoices, and future scenarios remain labeled reconstructions.
