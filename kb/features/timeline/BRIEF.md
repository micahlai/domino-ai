# Friend owns Timeline and Simulations

This is your full feature, not a small task from Jayden's queue. You steer your own agent, choose the internal design and break work into your own checklist. Stay compatible with the shared P0 base and public seam. Source: ../../spec/independent-feature-lanes.md. Long-lived work starts only after P0 readiness passes.

## What you are building

A financial decision workbench. Given a frozen, validated company snapshot, a user can understand the cash forecast, test an explicit hypothetical event and a costed response, reveal later results separately, and return to every saved simulation. It should be useful and coherent without opening the agent map.

The centerpiece is the existing readable financial timeline. Preserve it and make the entire surrounding workflow work. You own the frontend AND the timeline backend/persistence needed to finish it. Do not stop at a polished chart with fake saves or a standalone component demo.

## Complete journey

1. Open/import a valid TimelineSeedV1. Show company, source snapshot, cutoff, last balance date, target and gaps. Reject mismatched/corrupt/unsupported inputs visibly. Use public accepted 2U/development inputs for local demo; never evaluation labels.
2. Save a deterministic baseline with immutable inputs/method/provenance. Keep origin balance date distinct from cutoff. Engine owns cents, assumptions and all numeric predictions.
3. Inspect reported/nowcast/projected points, exact amounts, sources, uncertainty and model limitations. Make keyboard/touch/mobile work. Chart controls may evolve freely within your area.
4. Add a supported hypothetical Event and a costed Response. Existing quarterScenario is the starting engine. Show baseline/event/response, what caused each financial effect, cost/lag/feasibility/downside and hindsight labels. A response that worsens cash is a valid result.
5. Explicitly reveal permitted later reported information or import a validated normalized disclosure package through your owned backend. Keep it out of the seed and earlier forecast. Compare matching observed periods/metrics without rewriting a forecast. No fake weekly actuals.
6. Browse saved simulations with honest running/failed/partial/unknown states where applicable. Reload and reopen by stable links with the same numbers, evidence and parents; never dispatch a provider or recompute merely on read.
7. Return a valid TimelineResultRefV1 and safe OperationSummaryV1 records for the Field's eventual link/node. Your product works independently with the frozen input fixture; the final joined app is verified at the later merge.

## You own

- Timeline UI, historical chart/replay, Simulations list/detail routes and their UX/testing.
- Financial run/scenario/reveal persistence, request receipts, idempotence, finance operation evidence, catalog query and timeline schema fragment.
- S2 catalog and the timeline-owned parts of S4/U2 become your internal subprojects. Existing cards are useful constraints/history, not the old global launch sequence. You can implement your financial persistence independently of Jayden's L5 once P0 exposes the seed contract and schema ownership.
- Your branch roadmap, task decomposition, screenshots, test reports and feature handoff under this directory.

Read the ownership table in independent-feature-lanes.md for exact existing files. You may create additional files/functions in your namespace without asking the other lane. Keep shared historical view props and legacy historical APIs compatible. Do not edit Field, shared contracts/schema composition/global styles or core engine algorithms after the P0 freeze. Genuine boundary changes go in your boundary-requests.md for a deliberate shared checkpoint.

## Independent inputs and backend

Own local Convex/runtime/database. Import a validated snapshot rather than waiting for onboarding code. Peer fixtures stand in for the OTHER feature only; actual save/reveal/scenario/history behavior must use your real backend. Start from the existing audited historical functions and engine; do not build another simulation database or a second forecasting algorithm.

Sealed/withheld evaluation packages are outside this feature. No private account keys or live CREAO is required to finish deterministic timeline work. A future approved accuracy report can be displayed as a report, not recomputed from raw test labels. No money movement or automatic financial actions.

## Your checklist

- [ ] Confirm the exact P0 base, fixture hashes, schema ownership and current S2 checkpoint.
- [ ] Run existing timeline locally and document bugs/UX gaps before redesign.
- [ ] Implement the real baseline/import/saved-run flow.
- [ ] Complete supported Event -> Response calculations/persistence with immutable lineage/taint.
- [ ] Complete separate reveal and matching-period comparisons.
- [ ] Complete catalog, stable links and quiet reopen.
- [ ] Finish readable chart/impact/evidence interactions, mobile/keyboard/reduced motion.
- [ ] Pass your branch checks/build/browser and contract-fixture suite.
- [ ] Deliver one coherent demo and merge-ready branch summary.

You may reorder work and create smaller agent tasks as you discover issues. Keep the outcome and boundary stable. Do not request a cross-feature merge after each checkbox.

## Done means

Your whole journey runs against your real local backend with no fake persistence. Repeated/conflicting requests, wrong/corrupt parent/source/cutoff, missing input, failures and reload are exercised. UI has source/projection/hypothetical/reveal distinctions and exact cents from the engine. Branch checks/build pass; actual desktop/mobile/keyboard/reduced-motion walkthrough is recorded. The shared seed/result fixtures parse unchanged and old routes/consumers remain compatible. You can demonstrate it to Jayden while his branch is absent.

Report branch/commit, exact commands/results, screenshots, supported cases, remaining limits and any boundary proposals. This completes your feature slice, not the final proof that the two latest branches integrate or that forecast improvement is demonstrated.
