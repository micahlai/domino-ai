# Two independently owned Domino features

Latest user direction: both people need complete features they can build, test and continuously steer through their own agents, with a substantial merge later. This supersedes the narrow T1 task handoff and single-UI-writer/single-global-dispatcher model AFTER the split-readiness gate below. No new implementation is launched by this design.

## Product ownership

| Owner | Product area | Complete user journey |
| --- | --- | --- |
| Jayden + his agent lead | Company Knowledge and Agent Workspace | Add supported company sources -> discover/validate mappings -> resolve genuine conflicts -> inspect a durable knowledge snapshot -> ask Domino -> see actual source/tool/specialist work grow on the map -> inspect evidence/errors -> accept/reject a correction -> apply a scoped rule to later eligible work -> export a frozen forecast-ready snapshot |
| Friend + his agent lead | Timeline and Simulations | Open/import a frozen company snapshot -> save an engine forecast -> inspect assumptions/points/evidence -> create a hypothetical Event and costed Response -> compare cash/impact/uncertainty -> separately reveal permitted later actuals -> compare the saved forecast -> browse/reopen saved simulations without rerunning work |

Each owner controls their area's product decisions, UI, backend modules, persistence fragment, tests and demo. They can repeatedly prompt their own agent to improve it without asking the other lane to implement ordinary missing pieces. Scope is a product outcome, not a four-file chore. Existing accepted code is the starting point; neither lane rebuilds the whole app.

The overall L1-L4 and real CREAO gates remain required. Jayden's lane owns onboarding/reconciliation/feedback and the protected forecast-evaluation work. Friend renders an approved evaluation report if supplied; he never opens sealed test labels. Forecast improvement is empirical, so no one promises a passing result before testing.

## Honest independence

Each feature must run with its own real backend and local data. A validated fixture stands in ONLY for the other feature's handoff in independent demos/tests. That fixture is labelled and obeys the same public contract. It is not a fake implementation of that lane's own unfinished backend, and no screenshot of it proves final integration.

Friend does not wait for Jayden's ingestion to import a valid public 2U/development snapshot and complete the timeline backend. Jayden does not wait for friend's new chart to complete company onboarding, knowledge persistence and agent execution. His existing curated forecast tool can remain usable; future timeline launch/result exchange is tested through the frozen boundary. After merging, real export -> import -> saved run/result link must pass once as a complete product. Feature-local completion does not by itself prove that final joined flow.

## Fixed seam, implemented BEFORE the long fork

This section proposes a new boundary. Names below are planned exports, not claims that those APIs exist now. P0 contracts must define/validate them and both feature leads must use the same committed version.

1. **TimelineSeedV1** is a self-contained immutable snapshot export. It embeds the accepted CompanyKnowledgeSnapshot, its domain ID/content hash and the exact quarter-bridge roles/origin/cutoff plus explicitly selected model assumptions and protocol/version pins. Reuse existing historical/learning-loop schemas; do not use Convex document IDs as cross-feature identity. A blocked required role cannot produce a forecast-ready seed. There are no revealed outcomes or provider secrets in it.
2. **TimelineResultRefV1** identifies the source snapshot/hash, company identity, baseline/scenario domain IDs, target/metric/method, saved status, post-hoc status and a typed route descriptor. Field displays a link or read-only result reference; it does not rewrite timeline results. Timeline must reject seeds whose content, role closure, cutoff or company linkage fails validation.
3. **OperationSummaryV1** is the safe, bounded display record: stable ID, owner domain, status, title, dependencies, permitted evidence/output refs and timestamps. Agent-execution jobs belong to Field; financial calculation/scenario receipts belong to Timeline. They are distinct real operations, not two copies of one job. Cross-domain correlation uses domain IDs. Never pass raw provider packets, remote credentials or hidden reasoning through the seam.
4. Existing HistoricalView/HistoricalReplay props and old historical public APIs stay backward compatible. Timeline may add its own richer screen/queries, but Field's existing FinancialOutput consumer must continue to compile/render against the frozen legacy interface. New Field work does not import Timeline's private files; new Timeline work does not import Field's private files.
5. Route descriptors and the small app-shell integration are frozen at P0. Existing /case/2u, /case/2u/company, /case/2u/simulations, /historical and /investigate links stay valid. Each lane owns the wrappers listed below. New UI builds inside its namespace rather than rewriting shared navigation.

P0 supplies versioned public fixtures: a valid pre-cutoff 2U seed, an incomplete/blocked seed, a malformed/mismatched seed, a saved result reference and a separate post-reveal timeline fixture. Use already exposed data only. Do not mix the post-reveal fixture into the input seed or consume the Tenable/Varonis evaluation corpus. Both lanes' contract tests run against the same fixture hashes and schema version.

Validate the entire embedded seed, including unused sources, facts, assumptions and their dependency closure, against its cutoff. Missing roles block only methods that require those roles; an unused missing FX observation must not block a method with an explicit permitted FX assumption. Never turn missing values into zero. Schema checks prove shape/consistency, not that hashes match bytes: backend and harness verification must recompute the specified canonical hashes and reject tampered content. Reuse the existing hash convention at the consumer boundary without introducing a contracts-to-agents dependency.

Additive extension fields can live inside a lane's private types. A breaking change to this small shared seam requires a versioned proposal and a coordinated checkpoint. That is the tradeoff for delaying merges. Do not solve every disagreement by expanding the global contract.

## Backend ownership, one database model

P0 extracts the existing defineSchema table definitions into composed fragments, preserving table names, indexes, validators, data and old readers. No migration/reset/new deployment. Root schema.ts becomes a frozen composition point with both lanes registered.

Planned fragment files are apps/web/convex/schema/field.ts, timeline.ts and legacy.ts. Inspect Convex's supported module layout before choosing final paths; record those exact paths in the accepted P0 checkpoint. Check the friend's actual S2 index work before extraction. Incorporate its reviewed by_case_createdAt index on investigationConversations into the shared base, or record a separate bounded owner/review for that prerequisite. Do not silently redo S2 or leave Timeline needing to edit Field's fragment later.

- **Timeline fragment:** existing historicalRuns, historicalReveals, historicalRevealReceipts, historicalActivity and Timeline's distinct finance request/receipt needs. Keep one canonical store for saved financial runs, never a second simulation database.
- **Field fragment:** investigation conversations/messages/requests/operations and new knowledge/source/mapping/reconciliation/feedback entities. Preserve old records and ownership rules.
- **Legacy fragment:** old operational tables not owned by either new feature remain frozen in the common base. A lane adds genuinely new domain entities in its own fragment rather than repurposing old fields silently.

Timeline owns financial persistence and deterministic finance request execution. Field owns agent dispatch and agent-job state. Existing fixed-investigation calls into historical helpers remain compatible. New cross-domain integration uses the frozen seed/result/operation seam; neither lane has to modify the other runner to implement its own feature. S4's previous requirement to extend the single investigation runner is superseded by this domain ownership: preserve durable requests, idempotence, lineage, taint and real operation evidence, without two competing owners of investigation.ts.

Both features use the existing pure engine. Baseline money/date/period/scenario modules are frozen common code. Field owns new normalization/reconciliation/learned-rule/candidate-method modules. Timeline owns composition and its supported scenario presentation/storage; any new financial calculation must be a separately tested pure engine module in an explicitly owned namespace. No UI or LLM money calculations, duplicate forecast algorithms or silent edits to the evaluation baseline.

## Source ownership after P0

| Area | Jayden / Field | Friend / Timeline |
| --- | --- | --- |
| UI components | apps/web/components/investigate/**; components/case-workspace/CompanyView.tsx; new components/field/** | apps/web/components/historical/**; components/case-workspace/{SimulationList.tsx,SimulationDetail.tsx,Saved.tsx,summary.ts}; new components/timeline/** |
| Page wrappers | app/investigate/**; app/case/2u/page.tsx and company/**; playground/agent-canvas/** | app/historical/**; app/case/2u/simulations/**; a dedicated timeline playground wrapper registered by P0 |
| Backend | investigation.ts/tests and new field/** functions; knowledge schema fragment | historical.ts/tests, investigationCatalog.ts/tests and new timeline/** functions; timeline schema fragment |
| Engine | New source-normalization, reconciliation, learned-rules and period-candidate modules/tests | Existing quarterBridge/quarterScenario consumers; no common-math edits without a versioned request |
| Agent integration | packages/agents provider/coordinator modules/tests, preserving existing public exports | Frozen safe operation DTO consumer; no private agent-module edits |
| Evaluation | packages/sim/eval/** and protected evaluation stewardship | Approved report DTO/read view only; never sealed/withheld payloads |
| Feature planning | kb/features/field/** | kb/features/timeline/** |

Existing case-workspace.test.tsx is assigned to Timeline; Field adds its own separate tests instead of editing it. P0 must inventory any additional shared imports and record the boundary before branching. Global CSS/tokens, app layout/navigation, package/lock files, shared contracts, root schema composition and common math are FROZEN common infrastructure. Both lanes may write their own frontend files concurrently; the old one-UI-writer rule is replaced by one writer per owned UI domain. No shared shell/style writer in either lane during the fork.

Generated Convex bindings are regenerated locally from each branch's schema, not hand-edited. They are reconciled/regenerated at final integration. Each lane may run its own local backend, scoped tests, full checks and browser on its machine. Nobody deploys a branch to Jayden's preserved backends on ports 3214/3210 or shares a mutable development database. Accounts/provider budgets are still shared external resources, so calls remain bounded and explicitly configured.

## Split-readiness gate

- P0-C: implement the smallest versioned seam in packages/contracts with closure/date/hash/taint validation and synthetic/exposed public fixtures. No feature implementation.
- P0-S: compose schema fragments without changing stored data/old APIs; prove existing backend tests and saved-shape reads remain valid. Resolve the missing generated Convex guide through the installed/official equivalent before edits.
- P0-H: provide provider-free local harnesses for both feature routes, using the existing real local backend plus frozen peer fixtures. Preserve existing routes/consumers, verify the legacy HistoricalReplay interface, and assign route/style ownership. These are boundary smoke tests, not implementation of the future features. Publish exact isolated backend/setup commands. This is one shared setup checkpoint, not two new apps.
- Codex independently audits P0 and runs existing checks/build/browser as appropriate. Then tag/record ONE exact shared-base commit and fixture hashes. Do not launch long-lived feature work against an unfinished P0 promise.

The core is good enough to perform this setup, but the seam/composed schema/harnesses are not implemented by these documents. A branch created today can experiment, but cannot claim long-term independent integration readiness until P0 passes.

Setup cards: [P0-C](../tasks/P0-C-feature-boundary.md), [P0-S](../tasks/P0-S-schema-ownership.md), [P0-H](../tasks/P0-H-independent-harnesses.md). [Shared setup prompt](../../prompts/shared/prepare-independent-features.md) belongs to the current Claude lead. The two feature-owner prompts take over after accepted P0; they do not authorize competing shared setup writers.

## Long-lived branch workflow

Create/reuse one integration branch per feature from the exact accepted P0 base, with separate worktrees and local databases. Suggested names: feature/knowledge-field and feature/timeline-workbench. Do not create/reset them in this planning turn. Preserve prepared L1/S2 work; checkpoint and incorporate accepted existing work without discarding it.

Each person steers their own feature lead and may use bounded helpers inside their area. At most THREE simultaneous implementation processes across both people, counting children and any implementing lead, not three per person. One writer per file/domain. Feature leads merge reviewed subtask results into THEIR feature branch, not preview after every small task. Keep progress and handoffs in the feature-owned kb/features directory; root ROADMAP links both lanes and is reconciled by the integration owner.

No routine cross-merges or forced rebases during the agreed independent stretch. Check common contract fixtures locally and collect shared-boundary requests in each feature's boundary-requests.md. Critical compatibility fixes can be coordinated as a deliberate shared checkpoint. Otherwise each lane can evolve internal UX/backend structure freely within ownership and the frozen seam.

At the later merge, bring one reviewed feature branch into an integration worktree, run checks, bring the second, reconcile schema composition/generated bindings/shell adapters, then test actual Field export -> Timeline import -> scenario/reopen -> linked map result. Merge order and rollback are planned from real branch state. Main stays untouched until a separate explicit decision.

## Meaning of complete

Friend's feature is complete when its real backend and UI pass the Timeline brief's whole journey using valid frozen inputs, with reload/failure/lineage/cost/date correctness. Jayden's feature is complete when its real backend and UI pass the Field brief's onboarding/conflict/feedback/actual-operation journey and produce valid exports, with permitted peer fixtures only at the seam. Required live CREAO and honest L4 evidence remain explicit owned gates, never replaced by fixture demos. Final whole-product acceptance occurs only after the two real features are joined and checked.
