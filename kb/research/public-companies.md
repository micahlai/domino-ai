# Public companies we base Kestrel on

Verified from SEC company facts on 2026-10-24. These are larger B2B software peers; use ratios as context, not their dollar scale or an assertion of cash-spending behavior. Existing simulator parameters remain synthetic until a reviewed calibration change adopts this data.

| Company | Annual 10-K period | Revenue growth | Gross margin | S&M / rev | R&D / rev | G&A / rev | DSO days | Deferred / rev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [AMPL](https://data.sec.gov/api/xbrl/companyfacts/CIK0001866692.json) | 2025-01-01 to 2025-12-31 | 14.68% | 73.99% | 54.79% | 28.43% | 18.74% | 24.91 | Unknown |
| [PD](https://data.sec.gov/api/xbrl/companyfacts/CIK0001568100.json) | 2025-02-01 to 2026-01-31 | 5.36% | 84.95% | 37.37% | 25.77% | 20.62% | 80.35 | 50.54% |
| [SPT](https://data.sec.gov/api/xbrl/companyfacts/CIK0001517375.json) | 2025-01-01 to 2025-12-31 | 12.72% | 77.56% | 41.65% | 22.14% | 23.27% | 80.57 | 45.11% * |
| [FRSH](https://data.sec.gov/api/xbrl/companyfacts/CIK0001544522.json) | 2025-01-01 to 2025-12-31 | 16.43% | 84.96% | 47.06% | 19.46% | 16.82% | 65.63 | 46.31% * |
| [BOX](https://data.sec.gov/api/xbrl/companyfacts/CIK0001372612.json) | 2025-02-01 to 2026-01-31 | 7.99% | 79.22% | 34.32% | 25.02% | 12.82% | 100.81 | Unknown |

Five-company medians: growth 12.72%; gross margin 79.22%; S&M 41.65%; R&D 25.02%; G&A 18.74%; DSO 80.35 days. No complete five-company deferred-revenue median is claimed.

## Method and provenance

All amounts use us-gaap USD facts from the same accession. Annual durations match exactly, and balance facts match the annual end date. Prior revenue is the immediately preceding annual period from that accession. All selected current annual periods contain 365 days. Filings after 2026-10-24 were excluded.

Revenue uses RevenueFromContractWithCustomerExcludingAssessedTax. GrossProfit, SellingAndMarketingExpense, ResearchAndDevelopmentExpense and GeneralAndAdministrativeExpense are divided by annual revenue. Growth is current/prior revenue minus one. DSO is ending AccountsReceivableNetCurrent / annual revenue times 365, not average receivables DSO. These GAAP expense ratios include noncash costs and must not directly substitute for cash costs.

Deferred components are ContractWithCustomerLiabilityCurrent plus ContractWithCustomerLiabilityNoncurrent, checked against ContractWithCustomerLiability. Missing is unknown, not zero.

| Ticker | Filed | Accession |
| --- | --- | --- |
| AMPL | 2026-02-19 | 0001193125-26-057847 |
| PD | 2026-03-12 | 0001568100-26-000012 |
| SPT | 2026-02-27 | 0001517375-26-000015 |
| FRSH | 2026-02-26 | 0001544522-26-000036 |
| BOX | 2026-03-09 | 0001193125-26-098466 |

## Deferred revenue limitations

- AMPL has current $121,888,000, but no matching total/noncurrent tag. Current-only is 35.51%, not total.
- PD components $246,451,000 + $2,483,000 equal the $248,934,000 total.
- SPT components sum to $206,391,000 versus total tag $206,400,000. The starred table value is the component sum; precision differences need filing reconciliation.
- FRSH components sum to $388,420,000 versus total tag $388,467,000. The starred table value is the component sum; precision differences need filing reconciliation.
- BOX has current $647,893,000 and total $656,700,000, without a same-accession noncurrent tag. The total-tag ratio is 55.78%; the table leaves the component-sum measure unknown.

Exact selected public facts are preserved in [public-company-facts-2026-10-24.json](public-company-facts-2026-10-24.json). The lead reran the independent analysis. A reusable TypeScript calibration command and adoption into the simulator remain E1 work.
