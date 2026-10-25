# Asana-inspired fictional operating demo

## Public anchors

The demo company is fictional. Its financial scale is anchored to Asana, Inc.'s unaudited Form 10-Q for the quarter ended **October 31, 2023**, signed **December 5, 2023** ([SEC filing](https://www.sec.gov/Archives/edgar/data/1477720/000147772023000053/asan-20231031.htm), [Asana filing detail](https://investors.asana.com/sec-filings/sec-filing/10-q/0001477720-23-000053)). Amounts below are **USD thousands**, as presented, and are not fictional-company results.

| Asana reported item | Period or date | Source value | Filing location |
| --- | --- | ---: | --- |
| Revenue | Three months ended Oct 31, 2023 | 166,503 | Statements of operations, p. 2 |
| Cost of revenues | Same quarter | 16,053 | Statements of operations, p. 2 |
| Research and development | Same quarter | 81,028 | Statements of operations, p. 2 |
| Sales and marketing | Same quarter | 98,349 | Statements of operations, p. 2 |
| General and administrative | Same quarter | 34,494 | Statements of operations, p. 2 |
| Total operating expenses | Same quarter | 213,871 | Statements of operations, p. 2 |
| Loss from operations | Same quarter | (63,421) | Statements of operations, p. 2 |
| Net loss | Same quarter | (61,750) | Statements of operations, p. 2 |
| Cash and cash equivalents | Oct 31, 2023 | 268,314 | Balance sheets, p. 1 |
| Cash and cash equivalents, comparative fiscal opening | Jan 31, 2023 | 526,563 | Balance sheets, p. 1 |
| Cash and cash equivalents, prior quarter close | Jul 31, 2023 | 413,697 | [Prior 10-Q](https://www.sec.gov/Archives/edgar/data/1477720/000147772023000042/asan-20230731.htm), balance sheets, p. 1; signed Sep 5, 2023 |
| Marketable securities, separate from cash | Oct 31, 2023 | 261,726 | Balance sheets, p. 1 |

The October 10-Q's **nine-month** cash flow statement reports operating cash used `(2,594)`, investing cash used `(270,205)`, financing cash provided `16,418`, purchases of property and equipment `(7,221)`, and capitalized internal-use software `(4,325)`. These are for **February 1 through October 31, 2023**, not the October quarter. The same filing's free cash flow reconciliation separately gives **three-month** GAAP cash flow subtotals: operating `(8,233)`, investing `(140,738)`, financing `6,669`, property and equipment `(1,255)`, and capitalized software `(1,977)`. See the [cash flow statement, pp. 8-9](https://www.sec.gov/Archives/edgar/data/1477720/000147772023000053/asan-20231031.htm) and the free cash flow reconciliation in Item 2, p. 33. The filing does not provide every operating cash flow component for the standalone quarter. `anchors.json` labels quarter and year-to-date figures separately.

Cash and equivalents **exclude** the separate `261,726` marketable-securities balance. The filing also describes combined cash, equivalents, and marketable securities of about $530.0 million, which must not be substituted for bank cash. GAAP expenses include noncash items: quarter stock-based compensation expense was `52,866` (Note 10, p. 20). Expense totals are not vendor payments or payroll cash outflows. Revenue recognized in the quarter is not necessarily customer cash collected in that quarter.

## Synthetic operating allocation

Use a distinct fictional name, customers, vendors, and staff records. The `syntheticAssumptions` in `anchors.json` are **illustrative modeling choices**, not Asana disclosures. Three subscription customer archetypes receive 70%, 20%, and 10% of fictional recognized revenue. The model assumes annual upfront enterprise invoices due in 30 days, quarterly growth invoices due in 15 days, and monthly self-service card receipts two days after charge. Each expense line has fictional vendor/payroll mix weights, with semi-monthly payroll and net-30 vendor bills. These weights allocate *accounting expense categories* for a realistic scene, not exact cash flows. A deterministic program must convert the source strings to integer cents, allocate any rounded remainder explicitly, and reconcile generated cash events separately against chosen cash-flow anchors. It must not calculate money through an AI prompt or imply any generated invoice, employee, or bank transaction is real.
