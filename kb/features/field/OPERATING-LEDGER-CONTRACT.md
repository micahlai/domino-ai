# Filing-backed operating demo contract, v1

The user approved this scope. Preserve existing historical replay at `/case/2u`; never import held-out results or `assumptions.json` into reconstruction. Main and protected runtimes stay untouched.

## Pure simulation API, packages/sim

- `OPERATING_COMPANY_IDS = ["2u", "asana-inspired", "gitlab-inspired"]`, `OperatingCompanyId`.
- `OPERATING_SCENARIO_IDS = ["baseline", "late-payments", "customer-loss", "unexpected-expense"]`, `OperatingScenarioId`.
- `OperatingSelection = { company: OperatingCompanyId; scenario: OperatingScenarioId }`.
- `OPERATING_DEMO_LABEL = "Based on 2U public filings, with reconstructed operating data."` (exact user wording, with a space after 2U).
- `operatingDemoCatalog`: `{id,name,referenceCompany,label,periodStart,periodEnd,reportedAt}[]`. Fictional secondary names clearly say inspired by Asana/GitLab.
- `operatingScenarioCatalog`: `{id,name,description}[]`; names Baseline, Late payments, Customer loss, Unexpected expense.
- `createOperatingDemo(selection, seed=1)` returns `{world: WorldState, provenance: OperatingProvenance, constraints: Constraint[]}`.
- `isOperatingWorld(world): boolean`, `operatingSelectionOf(world): OperatingSelection | null`, `advanceOperatingDays(world, days): WorldState`, `operatingProvenance(selection, seed=1): OperatingProvenance`.
- World ID is `operating/<company>/<scenario>`, profile remains `kestrel` for the legacy WorldState schema. No shared-contract/schema widening is needed for WorldState. World snapshot/companyId match; strict existing WorldState/Snapshot parsers pass.
- `OperatingProvenance` has `version:1`, `company`, `scenario`, `label`, `periodStart`, `periodEnd`, `reportedAt`, `reported: {id,label,cents,periodStart?,periodEnd,sourceUrl,basis:"reported"|"derived-from-reported"}[]`, `assumptions:string[]`, and `reconciliation` with `openingCashCents`, `operatingCashFlowCents`, `investingCashFlowCents`, `financingCashFlowCents`, `fxCashFlowCents`, `endingCashCents`, `restrictedCashCents`, `revenueCents`, `outstandingReceivablesCents`, `balanced:boolean`. Expose reconciliation terms, not only a boolean.
- Reconstructed records carry stable synthetic ID/description prefixes; historical revenue recognition is a separate schedule and must not be equated to receipts. Provenance includes `revenueRecognition` dated entries and an explicit accrual/working-capital bridge if needed. All reported anchors retained in `reported`.
- Historical ledger stays identical across scenarios. Scenario changes affect only future reconstructed operating assumptions/records, never reported anchors or historical postings. Quarter/YTD periods stay explicit. Scheduled payroll/bills/plans are expectations, not observed history. Do not emit invoice.collection or bill.agreedPayOn, unsupported by the Timeline seam.
- One canonical Snapshot feeds existing vendor-shaped mocks and connector ingestion. Validate deterministic safe integer cents, bank opening+postings=ending, cash flow category totals, unrestricted+restricted=combined, invoice/bill/payroll bank links, and exact reported revenue schedule totals.

## Convex adapter, apps/web/convex

- `companies.operatingDemo?: {company:OperatingCompanyId;scenario:OperatingScenarioId;version:1}`. This optional field in the Field schema is explicitly authorized; no root schema or Timeline-owned schema edits.
- `fieldOperating.ensure({company,scenario}) -> {companyId,name,created}` is idempotent and preserves old feeds. Create only a selected scenario, not all12 on startup.
- `fieldOperating.list({}) -> {companyId,company,scenario,name}[]` for reconstructed feeds only.
- `fieldOperating.context({companyId}) -> OperatingProvenance | null` (reported values and reconstruction assumptions from the same generator).
- Hook reconstructed worlds into fieldFeed weekly advance, daily clock dispatch, observable servedSnapshot, exportSeed, and any company/profile labeling. Use generated constraints, not Kestrel's fictional loan rules. Synthetic rules must say illustrative, never actual 2U covenant evidence.
- Report date and ledger period are distinct. 2U reconstruction anchors Sep30,2023 from reports published Nov9; forward simulation and forecasts are illustrative, not known later results.

## UI adapter, apps/web components/app/lib

- Primary default is2U baseline. Company menu has2U and two clearly inspired demos; scenario is a separate prominent selector with the four required options. The old four fake companies are legacy fixtures, not the main scenario UI.
- Existing selected-company hooks resolve the selected operating feed using fieldOperating list/ensure. Never fall back to Kestrel. Existing legacy callers may remain for judge/fixtures but user-facing2U worker/map/connect/clock/Timeline all work normally.
- Global exact2U label: "Based on 2U public filings, with reconstructed operating data." Reported anchor panel/history link, reconstructed record labels and illustrative forecasts visibly separate.
- Dashboard forecast, agents and Timeline use the same ingested canonical snapshot; do not build another frontend financial ledger or run money arithmetic in UI. Provenance display reads backend terms.
