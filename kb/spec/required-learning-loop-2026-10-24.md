# Required completion gates: onboarding, reconciliation and learning

Latest user direction, October 24: automatic company onboarding, conflicting-source reconciliation, learning from feedback and proven forecast improvement are REQUIRED. They are not optional extensions after the historical demo. This supersedes deferrals in the product reset, prior stage plans and the planned-demo architecture diagram. Existing completed UI/backend work and manual Claude launch preference remain.

## Completion means observable behavior

| Gate | Required behavior | Acceptance evidence |
| --- | --- | --- |
| L1 Automatic company onboarding | Given authorized sources for a new company in documented supported formats, discover schema, propose and validate field mappings, normalize currencies/units/periods, record provenance, identify gaps, and build a usable company snapshot without hand-editing company-specific code | Run on at least one company/source package not used to develop its mappings. Show raw source -> mapping -> validation -> snapshot -> engine input on the real canvas. Unknown fields or unsupported access must produce a clear question, never invented values |
| L2 Conflicting-source reconciliation | Compare records for the same entity, metric, definition, currency and period; detect true disagreements and duplicates; preserve both sources; apply an explicit authority rule or ask for resolution | Exercise agreeing, duplicate, timing-only, definition-only and genuinely conflicting records. Block affected calculations when unresolved. A resolution must retain rationale, actor, source dates and version; totals and lineage must reconcile. Synthetic conflicts must be labelled as test data |
| L3 Learning from feedback | Persist an accepted correction or decision as a scoped, versioned mapping/rule; apply it to later eligible work; show what changed and why | Before/after run with the same relevant issue, a different unrelated company that must not inherit it, rejection/reversal and rollback checks. Distinguish raw feedback from validated learned rules. Historical runs cannot inherit feedback recorded after their cutoff |
| L4 Proven forecast improvement | Compare a frozen baseline model with a candidate informed only by development data and permitted feedback, then evaluate both on untouched periods at the data's real frequency | Freeze dataset hashes, time split, target, metrics, acceptance rule and candidate version BEFORE evaluation. Report both models' errors, sample size, periods, failures and uncertainty, not only wins. If improvement is absent, the improvement gate remains unmet even if the evaluator works |

Automatic onboarding is bounded by documented supported inputs and actual granted access. Do not claim arbitrary integrations or access to private systems. Select a small real supported boundary, make it work end to end, and state it clearly. The user has not authorized arbitrary paid providers, account changes or money movement.

## Evaluation rules

- Prefer chronological development/validation/test splits and rolling-origin evaluation appropriate to the available data. No random split that mixes future observations into earlier training.
- Choose a primary cash forecast error metric, a comparison baseline, eligible periods and minimum evidence before examining test results. Avoid percentage error when near-zero or negative cash makes it misleading.
- Code owns numeric predictions. Feedback changes a validated input rule or model parameter with provenance, not a generated narrative claiming better accuracy.
- A test period used to select a model is now development data. Do not repeatedly tune on it and continue calling it held out. If a new attempt needs evaluation, identify genuinely unused data or report the remaining limitation.
- The existing 2U case is retrospective and already known. It can demonstrate the UI and regression behavior, but cannot be the sole untouched proof of improvement. Preserve publication dates and separate availability from accounting-period dates.
- Distinguish improved mapping/data quality from improved forecast model performance. Measure each separately.
- A positive result supports only the tested companies/periods. Do not claim universal improvement, statistical confidence without support, advance bankruptcy prediction or bankruptcy prevention.

## Revised order

1. Preserve current worker ownership: friend S2 catalog; local S3 repair. Collect and audit their checkpoints, never duplicate or cancel finished useful work.
2. New lead inventories reusable legacy connectors, reconciliation, mapping and evaluation code READ-ONLY. Old code is a candidate for reuse, not automatically accepted for historical use.
3. Before new implementation, choose the supported source formats, second-company/evaluation data and exact L1-L4 contracts. Freeze the evaluation protocol before using the test data. Write bounded Claude task cards and disjoint ownership.
4. Implement L1 ingestion/provenance, then L2 reconciliation, then L3 scoped feedback rules. An evaluator and isolated untouched test corpus can be prepared in parallel with implementation, with leakage controls.
5. Complete S4 durable scenarios and U2 visible workflow against these contracts. Reuse current records/components and preserve prior saved runs. Do not build a parallel database.
6. Complete the real CREAO coordinator cycle and UI nodes for ingestion, reconciliation, feedback application, forecast and evaluation. Source/agent/tool nodes and statuses must correspond to real operations.
7. Run the frozen L4 comparison. Publish the result honestly. If it fails, report the gate as incomplete and plan a new legitimate development/evaluation cycle without reusing exposed test data as untouched.
8. Final visible acceptance: onboard -> reconcile -> investigate -> forecast -> reveal -> accept feedback -> apply learned rule to eligible new work -> evaluate improvement -> simulate a costed alternative -> reopen history.

## Ownership and constraints

Claude implements; Codex plans, audits and integrates. User launches Claude manually. At most three implementation workers including friend/children; one UI writer; serialize full suite/build/browser. Integration stays on preview/historical-overnight, never main. Keep source data, existing runtimes and unrelated work. Old app-scoped CREAO only, no account/developer wallet, no unbounded retries or billable Apify without a spending cap. No automatic financial actions.

## Handoff to the new lead chat

Read HANDOFF.md, this spec, team-checkpoint.md, active-run.md, product-workspace spec, the team-reset report, CREAO cycle spec and manual worker prompts. Inspect actual worker status and fetch before making claims. Update diagrams after the expanded architecture is decided. The existing planned diagram shows only the earlier smaller demo and is not the new completion boundary.

Call: make these four gates part of the same product, with explicit measurable acceptance. Counterargument: this is a significant scope increase; real evidence may not support the desired improvement. Reduce breadth of formats/companies, not truthfulness or the evaluation gate.
