# Historical demo: recommendation for review

Status: proposed, implementation held. User scope: ../context/historical-case-study-2026-10-24.md. Company research: ../research/historical-case-candidates.md.

## Call and counterargument

Provisionally use 2U, one knowledge cutoff and one later quarterly outcome. Keep the existing financial chart and add a small, explicit historical-period model. Do not manufacture a transaction ledger to make public statements fit the 13-week engine. Freeze the method before loading held-out outcomes into the forecast path.

Counterargument: this makes the demo less immediately impressive than synthetic weekly dominoes, and 2U's financing, university contracts and cash seasonality complicate attribution. WeWork has a more familiar distress story; Appgate is closer to software. A source audit may favor either. The architecture and first task remain useful regardless of selection.

This is a retrospective case study with hindsight and case-selection bias. A publication filter prevents source leakage, but cannot erase a developer's or pretrained model's knowledge of bankruptcy. It is not a prospective test or proof of predictive accuracy across companies. Keep forecasting deterministic and agents limited to interpreting the permitted evidence. Record what contemporaneous management already warned about; do not claim rediscovery as an original warning.

## Smallest complete journey

1. Open one curated company case. Show knowledge cutoff, latest reported balance date, sources and assumptions. A reviewed local evidence bundle replaces general-purpose ingestion for the first demo.
2. Calculate and save an immutable forecast/risk assessment with input hashes, source IDs, model version, assumptions, target periods and baseline method. Separate liquidity and debt/refinancing risks. Unknown inputs stay unknown.
3. Reveal the next disclosure by publication date. Add observed quarter-end points and a period-matched comparison without changing the stored forecast. Show misses and financing surprises plainly.
4. Compare one alternative decision with the saved baseline using the same origin evidence. Show upfront cost, delayed benefit, feasibility, downside and a sensitivity range. Prefer to predeclare the alternative and its parameter range when saving the forecast. Any alternative selected or tuned after reveal is labelled post-hoc, even when its numeric inputs were available at the cutoff. Later disclosed actions are a separately labelled hindsight experiment.
5. Open proof for every major figure and assumption. End with what the model did and did not establish, not a bankruptcy-prevention claim.

For 2U, provisional knowledge cutoff is end-of-day 2023-11-10, targeting 2023-12-31, then revealing the 2024-02-12 release. The SEC record confirms the Q3 report was filed November 9, accepted at 16:45:46. H1 still verifies the full source manifest and timestamp conventions. The September 30 cash balance is stale at this cutoff. Keep balance date separate from knowledge cutoff and explicitly model the unobserved interval; never rename September cash as November cash. The September 30 to November 10 nowcast is identical in baseline and response branches. A decision made at the cutoff can affect only the later interval, after its implementation lag. The January factoring transaction disclosed in February is held-out information at the November cutoff.

## Evidence and computation boundary

Additive contracts to design before code, not implemented here:

- Source: stable ID, original URL/accession, title, publication/acceptance timestamp and timezone, financial period, section/table locator, retrieved date and content hash. Fail closed when availability is unknown. A later amended filing cannot silently replace the historical version.
- Fact: source ID, period start/end or balance date, metric, reported units/currency, normalized integer cents, fact/derived classification and derivation references. A derived fact inherits the latest publication timestamp of every input, including any later reconciliation or amendment; the financial period never overrides availability. Track restricted cash separately. Revenue, EBITDA and net loss are not cash collections or cash burn.
- Assumption: explicit synthetic or counterfactual label, basis available at cutoff, value/range, effective dates, costs, dependencies, and whether the decision was feasible then. Synthetic invoice/customer/payroll IDs never become reported evidence.
- Run: cutoff, origin balance date, target periods, frozen inputs/method/version, forecast, risk rules and thresholds, assumption IDs, baseline comparator and creation timestamp. Append-only new runs; no overwrite during reveal.
- Observation/comparison: publication date, observed period and same metric/currency as prediction. Report signed and absolute cash errors and any rule outcome with an evidenced threshold. Missing or incomparable observations remain unscored. No fabricated weekly actuals, arbitrary survival probabilities or accuracy claims from one case.

Start with a simple, documented quarterly cash bridge using operating, investing and financing cash flows separately, plus disclosed debt terms. Derive a quarter from comparable YTD statements only when scope and accounting basis reconcile. Do not annualize one exceptional quarter without disclosure. No statistical calibration claims or confidence intervals without evidence; use labelled assumption ranges.

The existing forecast contract requires exactly 13 weeks and operational records. The current grade/learn contract requires complete bank transactions. Neither is valid for public quarterly actuals. Add a small period forecast/comparison path; share checked money/date utilities and chart presentation. Optional weekly projections may later use operational assumptions, with no weekly grading against reconstructed data.

Counterfactual candidate: a bounded expense reduction with an implementation delay, one-time restructuring cash cost and potential revenue downside. Public expense data is not automatically cash savings. Model ranges unless cash conversion is evidenced. Financing requires explicit fees, interest, availability/consent and repayment obligations; never an unexplained add_cash rescue. Select the concrete decision after the cutoff evidence audit. One decision is enough.

## Existing UI and P5 dependencies

Inspected at 694ab2a. Preserve all completed UI and existing API entry points. Original P5 completion is deferred, not made functional by preserving signatures: companies.create still schedules the throwing connect.run action, and week.next schedules a placeholder. Keep those controls gated. Give historical loading and reveal distinct mode/entry points; do not silently repurpose operational APIs.

| Existing area | Verified state | Historical use |
| --- | --- | --- |
| P1-P4, I1/I3, MultiverseTimeline, selection and inspection | Integrated; computed event and fix preview flow previously browser verified | Retain layout, chart, accessible selection and progressive branch reveal. Adapt dates/series to irregular reported periods; distinguish observed points from projected lines. |
| ProofDrawer, RiskList, RuleCard, DominoChain, FixCard | Components exist | Retain presentation. Add provenance labels/publication dates; keep causal claims and tradeoffs evidenced. Existing Evidence lacks the full historical availability contract. |
| /connect and branch detail route | Both still PageStub | Use a curated case loader first. Reuse branch detail composition later. BranchChart itself is currently a table preview, not a finished chart. |
| companies.create, sources.list, connect.run | Public schema/query/mutation scaffolding exists; connect.run throws not built | Preserve P5 interfaces. Historical loader gets a separate path; use progress/checklist presentation for actual source validation. General mock/Nessie ingestion is not on the core path. |
| engine.recompute/addEvent, fixes.simulate | Computed actions implemented; current UI adds known risk changes | Reuse orchestration pattern and branch persistence where compatible. Historical hypothesis branches must not inject events into or rewrite observed history. |
| agents.proposeFixes / agents.explain | Convex action placeholders; provider package implemented and smoke tested | Keep provider adapters. Optional explanation consumes only allowed evidence and persisted engine output. Core journey must work without live AI. |
| week.next -> week.advance | Mutation schedules placeholder; UI capability false | Keep legacy path disabled. New reveal operation advances disclosure visibility only, never sim.advance or cash balances. |
| E7a grade/learn, HistoryWeek | Operational bank-window contracts | Preserve for synthetic mode. Implement period comparison separately, not fake bank transactions. |
| I4 retained generations card | Prepared, unlaunched | Reuse immutable forecast/input retention design, scope to one historical run and reveal. |
| Particles/crosshair | Completed UI retained | No new particle work. Historical mode must not imply unsupported scenario probabilities through scores or particle weights. Do not depict agent activity unless backed by real operations. |

## What leaves the critical path

Park E1b rolling-world simulation, E2a mock sources, E2b Nessie seeding, broad E5 connectors/tie-out, and E7 simulated-week orchestration. Preserve their code and task results. E3c forward operational plans are optional reuse and remain blocked by audit. Synthetic held-out companies, broad disaster scenarios, auto-generated tools, unlimited agents, and the agent canvas are deferred. Do not remove completed interfaces, tests, UI or dependencies.

## Next three tasks, proposed only

1. **H1 evidence bundle and evaluation protocol.** Claude, isolated worktree, research/data ownership. Select one company after comparing sources; record cutoff, period metrics, assumptions, later-outcome bundle and simple baseline. Verify primary-source publication times, unit conversions, cash reconciliation and the decision's feasible costs. Codex audits. Exit: defensible frozen input manifest and held-out outcomes with clear provenance. No forecast code until evidence fits.
2. **H2 historical run, period model and reveal.** Claude after H1, isolated worktree, explicit contracts/engine/Convex ownership. Add minimal period contracts, immutable run storage, deterministic cash bridge and publication-gated observations. Preserve old operational APIs. Tests cover late publications/amendments, unknown dates, stale balance dates, YTD derivation, restricted cash, costs, immutable reveal and metric matching. Codex independently audits money and leakage controls. Exit: one reproducible backend journey with one costed alternative.
3. **H3 historical UI journey.** Claude after contracts freeze, isolated worktree, UI ownership. Adapt current company screen and chart; case/date/source summary, save, reveal, error comparison, one response branch and proof. No canvas rewrite. Codex audits/browser checks. Exit: readable baseline -> observed event -> projected response with correct dates/labels, complete without live providers.

Do not launch these tasks during assessment. Contracts and UI dependencies are sequential; writing three independent feature branches now would create avoidable rework. Review this plan and the evidence choice before dispatch. Integrate only approved work into integration/historical-case-study, run combined checks/build/browser journey there, and present the result before any main merge.

## Open decisions

- Final company and cutoff, after publication verification and feasible intervention audit.
- Specific measurable warning and threshold. A liquidity covenant needs actual terms; an analyst threshold must be labelled as such.
- One alternative's cash costs, lag, constraints and downside range.
- Whether a live explanation adds demo value. Default to deterministic stored explanation and evidence first.

Agent page is a later independent surface: pan/zoom graph, persistent conversation, source/output/status details, actual tool-run events. It cannot delay H1-H3.
