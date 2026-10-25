# TL5 acceptance log

**Accepted locally, 2026-10-24.** Scope: TL1C–TL5 on `TL5-checkpoint`, building on accepted TL1 `0b06882`. User authorized parallel Codex implementation and integration. [Smoke walkthrough](SMOKE-TESTS.md), [roadmap](ROADMAP.md), [local runtime](LOCAL.md).

## Evidence

| Case | Verified result |
| --- | --- |
| Existing baseline | Original saved TL1 seed/hash, 26 history weeks and 13 forecast values retained. Baseline usable-cash low point $2,689,000, week of Nov 16, 2026. |
| Rules | Add/edit/remove all three supported types; fractional 4.5-month runway stored unchanged; original wording/version frozen; older runs unchanged. |
| Attribution | Same rules evaluate parent and child. New, pre-existing and resolved outcomes checked. Rule-only changes preserve cash. Outside-horizon bill deadline is not reported as passing. |
| Events | Validated late invoice and one-time cash events; exact per-week changes. Natural-language Acme 14-day delay matches equivalent form result. |
| Nested effects | Ancestor changes applied once, original history/baseline preserved. Reversals and cumulative date/money bounds checked. |
| Questions | Actual integrated answer cites rent/payroll for Nov 2; effective schedule is verified against saved forecast before answering. Delayed/lost invoices reflect effective cash timing rather than original schedule annotations. |
| Prompt proposal | Actual browser confirmed $80,000 Atlas Legal expense plus $2,650,000 minimum atomically. Result: $2,609,000 usable, $41,000 short on Nov 22. Pure-rule prompt saves and links a rule revision. |
| Clarification | Missing counterparty/date, daily floors, headcount/hiring budgets, negation, reversed bounds, mixed directions, cross-clause counts and malformed/partial amounts fail closed. No financial result. |
| Failures | Controlled tests cover absent/unavailable provider, timeout, refusal, malformed/truncated output, redirects, bounded UTF8 response, abandoned lease and retries. Raw provider packets/errors are not persisted. |
| Retry/storage | Same payload/request reuses saved receipt; conflicting payload and cross-operation reuse reject. Scoped company/record/parent/proposal validation, bounded input/row/depth and safe aggregate cents checked. |
| Catalog/seam | Live bounded pages and distinct next page; browser loads older rows and reopens nested result. Strict WeeklyResultRefV1 matches saved seed/run/route. Real operation receipts include status/method/output refs. |
| Quiet reopen | Integrated tests spy on engine.forecast, engine.dominoes and fetch: get/list/catalog/resultRef/successful ask retry make no calls. Actual browser reload retains inputs, answers, links and values. |
| Browser | Actual question → evidence → confirmed expense/rule → nested future delay → catalog/reopen. Separate future Dec 1 expense form also saved. Keyboard slider works. Rule-only confirmation and unsupported daily prompt checked. 1280×900 and 390×844: page width equals viewport, money stays whole; chart scroll is contained. Final loaded page console error list empty. |

## Checks and independent review

- Full combined `pnpm check`: **1,877 tests** (contracts496, engine344, sim5, agents298, web734), five package typechecks, lint359 files. Separate Convex typecheck and production build pass.
- New combined real-backend `coreAcceptance.test.ts`: 3/3. Workspace45/45, question111/111, UI57 focused cases including14 proposal cases; these are included in the full total.
- Independent reviewer accepted backend `62311ea` with19 additional scratch probes; accepted questions `6b64ccb` with14 independent meaning/evidence/provider probes and independently rerun111 checked-in tests. Integration-only question test schema composition repaired in `5fe8fc7`.
- Live API journey **31/31** checks. Three additional live checks verify fractional runway, outside-horizon deadline and resolved cash violation.
- One actual optional provider request succeeded: “Please identify the cash trough for this saved forecast.” Method receipt says wording read by Claude; code answered $2,689,000 in week Nov16 from saved output. No provider arithmetic or generated financial answer.
- Lane inventory unchanged:18 legacy cross-lane imports, zero harness crossings. No Timeline implementation changes to shared contracts, root schema composition, shared engine math/styles, Dashboard.tsx or Field-private files after the authorized shared-shell pickup.

Runtime logs and detailed scratch probes are under `/tmp/TL5-final-*`, `/tmp/tl5-final-review/`, `/tmp/tl5-live-results.json` and `/tmp/tl5-live-provider-result.json` (local diagnostics, not required to run the feature). Durable screenshots: [desktop](evidence/TL5-desktop.png), [new breach/proof](evidence/TL5-desktop-breach.png), [phone rules](evidence/TL5-phone-rules.png), [phone clarification](evidence/TL5-phone-clarification.png).

## Saved browser examples

- Root: `timeline:workspace/edf763202b5cd8f444578c86fd944038008bec15`.
- Expense + confirmed rule: `timeline:workspace/4d9835e8174efa96ff9c5974380cb755e199ad14`.
- Nested Acme delay: `timeline:workspace/4652fa087fda2846167ffddd3d46688ba511a582`.
- Rule-only revision: `timeline:workspace/40d492390724b2d25b65918009fc974fde4aae5e`.
- Future expense entered in browser: `timeline:workspace/09a7d3435d90bd7b6323a708a6d799021272593d`.

## Limits and remaining gates

Acceptance is for this lane's anonymous local backend and labelled synthetic peer fixture with reviewed neutral assumptions. It does not claim production authentication, live ingestion or real Field export integration. Queries are company-scoped, not a complete production authorization system.

Questions support bounded intents and conservative clarification, not arbitrary financial dialogue. Cash minima check Sunday close, not daily compliance. Runway receipts leave unavailable values/shortfalls unknown. Multi-action receipts describe the scenario as a group; they do not claim isolated per-action causation. Schedule annotations preserve original imported weeks. Ancestry display caps at100; question list caps at100 per run; writes have explicit size/depth limits.

TL6 health/risk/chart handoff, TL7 automatic analysis and TL8 financial-state rejoin remain follow-on scope. Field owns Dashboard.tsx. No real financial action executes. Main and timeline/main were not merged or pushed. Own app3107/backend3240/3241 remain running; peer services/data were preserved.
