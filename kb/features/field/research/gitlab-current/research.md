# Current GitLab anchors for CodeHarbor

**Use:** CodeHarbor is fictional and GitLab-inspired. These public figures constrain a reconstructed May 1 to July 31, 2026 operating demo. The filings disclose consolidated financial statements, not GitLab's invoices, payroll, vendors, bank entries, or weekly cash path. Generated operating records must remain labeled synthetic.

## Latest eligible quarter and source dates

- The latest verified GitLab quarterly result available by the **October 25, 2026** cutoff is fiscal **2027 Q2**, ended **July 31, 2026**. GitLab published its [Q2 earnings release](https://ir.gitlab.com/news/news-details/2026/GitLab-Reports-Second-Quarter-Fiscal-Year-2027-Financial-Results/default.aspx) on **September 1, 2026**. The [Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm) was accepted **September 1 at 18:13:00 ET** and filed **September 2**, per its [SEC accession header](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/0001628280-26-059943-index-headers.html).
- The prior [FY2027 Q1 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1653482/000162828026039793/gtlb-20260430.htm), ended **April 30, 2026**, was accepted and filed **June 2 at 16:11:09 ET**, per its [SEC accession header](https://www.sec.gov/Archives/edgar/data/1653482/000162828026039793/0001628280-26-039793-index-headers.html). Its April 30 balance sheet supplies the quarter's opening cash and working-capital anchors. The [SEC company filing listing](https://www.sec.gov/edgar/browse/?CIK=1653482) and GitLab release identify Q2 as the latest public quarterly result at this cutoff. The next fiscal quarter ends October 31, after the cutoff. The Q2 release's Q3 amounts are guidance, not actual results.

All values below are **USD thousands**, unaudited. Parentheses retain filing signs. The exact original monetary strings and their statement locations are in [anchors.json](anchors.json).

## Balance-sheet endpoints

| Reported line | April 30 Q1 opening | July 31 Q2 closing | Source |
| --- | ---: | ---: | --- |
| Cash and cash equivalents | 335,395 | 226,491 | Each Form 10-Q balance sheet |
| Short-term investments, outside cash | 1,022,117 | 1,030,495 | Each Form 10-Q balance sheet |
| Accounts receivable, net | 200,302 | 257,343 | Each Form 10-Q balance sheet |
| Accounts payable | 8,847 | 9,955 | Each Form 10-Q balance sheet |
| Accrued expenses and other current liabilities | 72,680 | 51,580 | Each Form 10-Q balance sheet |
| Accrued compensation and benefits | 28,538 | 46,932 | Each Form 10-Q balance sheet |
| Deferred revenue, current | 532,983 | See next row | Each Form 10-Q balance sheet |
| Deferred revenue and customer advances, current | See preceding row | 553,844 | Each Form 10-Q balance sheet |
| Deferred revenue, noncurrent | 23,991 | 20,829 | Each Form 10-Q balance sheet |

The Q2 current-liability label adds customer advances, so the two current deferred-liability lines must not be represented as identical scopes. GitLab's [Q2 revenue note](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm) explains that Flex customer advances are included in the July current line. The Q2 balance sheet reports January 31, 2026 cash and equivalents of **229,576**, a fiscal-opening comparative rather than this demo quarter's opening balance.

The Q1 and Q2 statements do not separately report or reconcile restricted cash. There is no verified restricted-cash zero in these sources. If the fictional ledger needs a zero, label it as a reconstruction assumption. Keep short-term investments separate from cash and equivalents.

## Quarter income and noncash expense

The Q2 [statement of operations](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm) directly reports the three months ended July 31: subscription revenue **258,311**, license revenue **27,943**, total revenue **286,254**; subscription cost **38,258**, license cost **7,380**, total cost **45,638**; sales and marketing **134,363**, research and development **94,980**, general and administrative **68,208**, total operating expenses **297,551**; operating loss **(56,935)**, income-tax provision **(3,195)**, and consolidated net loss **(36,132)**. The tax line is a benefit. Net loss attributable to GitLab, **(36,844)**, is a distinct line and should not replace the consolidated anchor.

The Q2 [stock-compensation note](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm) directly reports three-month total stock-based compensation expense **75,006**. It is noncash. Recognized revenue is not the same as receipts; expense and tax provisions are not bank payments.

## Comparable cash-flow inputs

The cash-flow statements are fiscal-year-to-date: [Q2 reports six months](https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm) from February 1 through July 31, while [Q1 reports three months](https://www.sec.gov/Archives/edgar/data/1653482/000162828026039793/gtlb-20260430.htm) from February 1 through April 30. Do not present either as the May through July quarter. Derive quarter totals in deterministic integer-cent code and reconcile the reported April and July cash endpoints.

| Reported line | Six months through July | Three months through April |
| --- | ---: | ---: |
| Operating cash flow | 146,105 | 149,197 |
| Investing cash flow | (5,378) | 4,157 |
| Financing cash flow | (143,346) | (47,835) |
| Foreign-exchange impact on cash | (466) | 300 |
| Net change in cash and equivalents | (3,085) | 105,819 |
| Purchases of short-term investments | (421,817) | (222,196) |
| Maturities of short-term investments | 358,647 | 218,824 |
| Sales of short-term investments | 60,398 | 9,922 |
| Additions to property and equipment | (2,606) | (2,393) |
| Stock-option exercise proceeds, net | 5,361 | 2,373 |
| Employee stock purchase plan proceeds | 6,886 | Not presented in Q1 |
| Common stock repurchases | (154,685) | (50,048) |
| Tax payments for net share settlement | (908) | (160) |

The [earnings release](https://ir.gitlab.com/news/news-details/2026/GitLab-Reports-Second-Quarter-Fiscal-Year-2027-Financial-Results/default.aspx) provides exact quarter crosschecks in its cash-flow-to-adjusted-free-cash-flow reconciliation: operating cash flow **(3,092)** and capex **(213)**, USD thousands. Adjusted free cash flow is a non-GAAP measure, not a bank inflow. The [IR overview](https://ir.gitlab.com/OVERVIEW/DEFAULT.ASPX) independently labels FY2027 Q2 as the latest quarter. Preserve source component totals and use a named residual for any undisclosed investing or financing subcomponent; generated bank dates remain synthetic.

Cash-tax supplemental lines have different scopes: Q2 reports **8,820** cash paid, including amounts related to final settlement of JiHu formation; Q1 separately reports **(77)** BAPA-related tax refunds and **139** other cash taxes paid. Do not mechanically subtract these into a purported exact quarter cash-tax amount. The Q2 accounting tax benefit is likewise not a cash receipt.
