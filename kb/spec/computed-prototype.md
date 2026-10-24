# First computed prototype: I2

User priority: integrate Micah's ready UI and show the existing real engine through live Convex queries, while continuing backend completion. This is a bounded fixed-snapshot prototype, not the final connected/learning backend.

## Implementation boundary
- Keep exact internal references engine.recompute, engine.addEvent and engine.simulateFix. Public events.add and fixes.simulate signatures remain unchanged. Existing agents/connect/week actions are separate work.
- The brain adds @domino/engine workspace dependency before dispatch. Do not edit package manifests or lockfile. No shared type/schema/UI changes. Generate API with installed CLI offline codegen if possible; never hand-edit generated API. If unavailable, use typed makeFunctionReference for new internal helpers and report it.
- Prefer a single internal mutation that loads, calculates with the pure engine, validates and writes in one transaction; action wrappers call it. This keeps database input and output coherent without a multi-call stale-write window. Do not use network or agents inside the mutation. If splitting calculations outside, compare full loaded inputs again atomically before writes.
- Use latest parsed snapshot/model and all parsed constraints for one company. Reject missing inputs and unresolved legacy C1 links, rather than inventing linkage. Existing demo/approvals must remain untouched by the separate seed.

## Computation and persistence
- recompute calls real forecast, scanRisks, dominoes with complete model/change context, history, pastEvents and stressTest both without/with selected useful proposals. No fixture forecast, branch, history or resilience values are numerical inputs.
- Persist base plus one event branch for every distinct nonempty risk set in the no-fix report, including combinations. All event branches parent the base and contain the set's complete changes exactly once; riskIds are cumulative. Use deterministic IDs scoped to the Convex company ID, asOf and canonical risk set. Universe IDs remain opaque.
- Source candidate proposals must have explicit compatible targetRiskIds. Respect [] global/OR matching; deduplicate candidate IDs before stressTest and preserve order. Score through scoreFix/rankFixes, store real gains and simulated fix branches with status proposed until a person decides. Do not claim proposal generation by AI in this slice.
- Upsert deterministic records, do not append duplicates on retries. Publish risks, both resilience reports, history, branch graph, useful candidates and one appropriate audit log transactionally. Validate outputs with contract schemas. Do not mutate other companies.
- Preserve approved/rejected branch status and payload, referenced candidates and ancestors. If changed financial inputs would overwrite a decided graph, reject clearly in this fixed-snapshot slice. Never quietly revoke a decision or reinterpret an approved action. Tests must exercise this guard. Full multi-snapshot generation handling is later work before week.advance.
- Rerunning recompute after an approval must neither duplicate nor erase approvals or change that branch back to proposed. A failed run leaves all previous visible results unchanged.
- addEvent currently receives label+changes but no probability. Match a unique existing risk by exact ordered changes (and label where needed), preserving its actual risk ID and supplied probability; reject missing/ambiguous identity. Do not invent a probability for arbitrary user input. It can ensure the corresponding event branch exists and recompute consistently. Full custom-event input is a later contract decision.
- simulateFix requires candidate plus parent branch from the same company. Load root-to-parent ancestry, reject cycles/missing/cross-company ancestors, pass each change once with FixScoreContext. Save idempotently, preserve any decided branch, never execute changes on external systems.

## Separate demo seed
- Add dev/seedComputed internal mutation to create one separate 'Kestrel Data (computed prototype)' company once, identified by its own log marker. Do not call/delete/update the existing fixture seed/company.
- Seed only C1 fixtures.snapshot/model/constraints as explicitly synthetic inputs. Their shared IDs can stay canonical inside payloads; relationships use the new Convex company ID. Never copy illustrative output arrays.
- For useful visible previews, seed explicitly labeled demo proposals from fixture change instructions only, scoped to this company. Map the early-payment proposal to the actual scanned risk for its specific invoice using explicit identity, not labels. The hiring-delay demo proposal may be explicitly global. Derive no gains/forecasts from fixtures. Log these as demo proposals, not AI output; source lastPull stays null and tieOut pending.
- Run the same calculation/persistence helper as normal recompute. Return companyId and created flag, idempotently. Tests verify separate existing fixture approval records remain unchanged.
- Read/seed only local test databases during implementation. Codex owns real local deployment, browser verification and UI readiness flags after review.

## Acceptance
- Real computed output differs from illustrative fixtures and equals independently called engine results for the seeded inputs.
- fixes.forBranch must preserve engine rule-clearance-first ranking for computed branches, not re-sort only by gain; retain existing fixture compatibility.
- Recompute twice: same branch/candidate identities, one history/report per active key, no duplicate risks or decision loss.
- Exact risk-set branches resolve combinations; candidate target IDs exist; proposal gains are recomputed; both reports parse.
- Event identity matching and fix ancestry/overrides; cross-company, missing/cyclic references and changed-decided-payload guards.
- All preexisting tests remain. If a placeholder test assumed the three functions throw, replace it with substantive behavior tests while keeping other placeholders honestly unbuilt.
- Full pnpm check and production build. Record limits, timings and generation convention in Result. No feature expansion to cover all E7 in this card.
