# GitLab-inspired secondary Field demo

**Use:** A fictional developer-platform company with public GitLab financial anchors. GitLab's reported results are evidence for the scale and shape of the demo, not claims about the fictional company's customers, invoices, vendors, employees, or bank activity. No actual operational records are available in these filings.

## Primary sources and scope

- [GitLab FY2024 Q3 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1653482/000162828023040671/gtlb-20231031.htm), period ended October 31, 2023. The [SEC filing index](https://www.sec.gov/Archives/edgar/data/1653482/0001628280-23-040671-index.htm) lists filing date December 5, 2023 and acceptance December 4, 2023 at 19:13:35. Balance sheet is as of October 31; income statement covers the three months ended October 31; cash-flow statement covers **nine months**, not the quarter. All table values below are USD **thousands**, unaudited.
- [GitLab FY2024 Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1653482/000162828023031433/gtlb-20230731.htm), period ended July 31, 2023. Its [SEC filing index](https://www.sec.gov/Archives/edgar/data/1653482/0001628280-23-031433-index.htm) lists filing date September 6, 2023 and acceptance September 5, 2023 at 19:16:30. The July balance sheet supplies the opening cash balance for an August 1 to October 31 demo. Its cash-flow statement covers **six months**, not the quarter.

## Reported anchors

| Metric | Period or date | Reported USD thousands | Filing location |
| --- | --- | ---: | --- |
| Cash and cash equivalents, opening | July 31, 2023 | 273,225 | Q2 balance sheet |
| Cash and cash equivalents, closing | October 31, 2023 | 285,309 | Q3 balance sheet |
| Short-term investments, separate from cash | October 31, 2023 | 704,325 | Q3 balance sheet |
| Total revenue | Three months ended October 31, 2023 | 149,668 | Q3 statement of operations |
| Cost of revenue | Same three months | 15,084 | Q3 statement of operations |
| Sales and marketing | Same three months | 86,978 | Q3 statement of operations |
| Research and development | Same three months | 49,058 | Q3 statement of operations |
| General and administrative | Same three months | 38,815 | Q3 statement of operations |
| Total operating expenses | Same three months | 174,851 | Q3 statement of operations |
| Operating loss | Same three months | (40,267) | Q3 statement of operations |
| Income-tax provision | Same three months | 256,788 | Q3 statement of operations |
| Net loss | Same three months | (286,355) | Q3 statement of operations |
| Stock-based compensation expense | Same three months | 41,334 | Q3 Note 10, Equity |

The Q3 filing reports nine-month operating cash flow **10,187**, investing cash flow **(50,466)**, financing cash flow **30,243**, foreign-exchange effect **(2,557)**, and net cash decrease **(12,593)**. The Q2 filing reports the corresponding six-month values **16,148**, **(65,045)**, **25,528**, **(1,308)**, and **(24,677)**. These are inputs for a possible deterministic quarter difference; neither filing directly reports three-month cash-flow totals. The quarter-end cash balances are directly reported and should be the cash tie-out. Both filings' cash-flow reconciliations show zero restricted cash at their July and October 2023 endpoints. The Q3 filing's January 31 comparative cash and equivalents are **295,402**; its cash-flow opening **297,902** includes restricted cash and covers nine months, so it is not the August 1 opening balance.

The unusually large Q3 tax provision and net loss are accounting results, not evidence of a matching quarter cash tax payment. The Q3 filing's cash taxes paid **6,015** cover nine months; Q2's **4,187** cover six months. GitLab describes Q3 tax expense as primarily linked to unrecognized tax benefits and foreign and domestic operations (Q3 Note 13). Likewise stock-based compensation is noncash. Do not turn any of these income-statement lines into literal bank transactions. Revenue is recognized revenue, not cash collected.

## Synthetic operating allocation for the fictional demo

All items here are **assumptions**, not GitLab disclosures. They define plausible timing and counterparties only. A deterministic generator must choose exact invoice and payment cents, balance residuals, and reconcile to the selected reported cash anchors before the demo claims any tie-out.

- Customer archetypes: large regulated software teams with annual platform contracts, midmarket engineering teams with quarterly contracts, and small self-serve teams with monthly subscriptions. Allocate a synthetic billed-revenue pool across these groups with integer weights **55:30:15**. These are not reported segment shares or customer counts.
- Billing and receipts: annual contracts invoice at renewal, quarterly contracts invoice at quarter start, and self-serve subscriptions bill monthly. Model enterprise receipts around net 45, midmarket around net 30, and self-serve card receipts after 2 to 4 days; include a small assumed late-payment tail. Do not equate billed revenue, recognized revenue, and cash receipts.
- Vendor archetypes: cloud hosting and observability, payment processing, developer tooling, sales programs, and general overhead. Model hosting invoices monthly on net 30, software subscriptions monthly or annually, and sales-program spend around campaign dates. Names and invoices must be invented, never copied from GitLab vendors.
- Payroll: synthetic employee groups in engineering, sales, customer support, and operations, paid on the 15th and last day of each month, with employer taxes and benefits following payroll. No real individuals, wages, or headcounts. Stock compensation remains a noncash line.
- Investing and financing: keep purchases and maturities of short-term investments, equity-related financing, and FX as separate flows when building a full cash bridge. These are not customer or vendor operations. Model any quarter allocations only after subtracting the reported six-month YTD cash-flow values from the nine-month YTD values in code.

## Integration caveat

An operational ledger matching both reported cash endpoints is necessarily invented. The exact split between cash receipts, payroll, vendor payments, taxes, investment transfers, financing, and FX is not disclosed quarterly at transaction level. Display the fictional company's generated records as synthetic, and label the public figures as GitLab-inspired anchors. Do not present a generated weekly path as GitLab history or forecast accuracy evidence.
