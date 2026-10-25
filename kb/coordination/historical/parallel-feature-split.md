# Proposed parallel split: timeline and knowledge backend

**SUPERSEDED as the feature split.** Jayden requested two complete independently steerable full-stack features, not T1 chores. Current plan: [independent feature lanes](../../spec/independent-feature-lanes.md), [shared setup prompt](../../../prompts/shared/prepare-independent-features.md), [Field brief](../../features/field/BRIEF.md), [Timeline brief](../../features/timeline/BRIEF.md). P0 must pass before the long fork; it is not implemented. The remainder records the earlier bounded proposal and existing playground setup only. T1 can become an internal Timeline task. After P0, both lanes own UI/backend and their own agents, with one writer per domain and three implementation processes total. S2 remains friend-owned.

Prepared for Jayden's request. No worker/session/server launched by this proposal. Claude lead owns actual assignment; Codex audits/integrates. Main and monitor unchanged. Source checkpoint efde049 includes accepted S3/L0/E0 and the combined 1,251-test/typecheck/lint result (some cached).

## Readiness call

The existing curated 2U backend supports useful parallel development now: durable conversations/operations/messages, frozen baseline forecasts, separate reveal, costed A1 alternative, read-only saved-run reload and evidence projection. The complete new backend is NOT done. Automatic onboarding/reconciliation/feedback, durable hypothetical Event/Response, generic company knowledge persistence and verified CREAO coordination remain unfinished.

Call: friend owns timeline frontend while Jayden's Claude works on pure engine/knowledge backend and the real operation records that will later feed the existing agent map. Keep one UI writer initially. Counterargument: two isolated UI owners could move faster, but shared HistoricalReplay consumers, navigation and unfinished APIs create avoidable integration risk. Two UI writers require a separately agreed file/contract boundary, not a casual overlap.

## Owners

| Owner | Feature | Exclusive write scope | Stable boundary |
| --- | --- | --- | --- |
| Friend | T1 timeline inspection/series controls | HistoricalChart.tsx/test and HistoricalReplay.tsx/test in apps/web/components/historical | Existing HistoricalView props and selectedId/onSelect behavior; no money calculations or API changes |
| Friend, retained separate task | S2 saved catalog | Existing S2 card only, including ONE conversation index | investigationCatalog.list API described in S2 card; stop/checkpoint one task before switching to the other |
| Jayden's Claude workers | L1 -> L2 -> L3 -> L5 | Existing engine cards first, backend persistence after shared gates | Accepted L0 schemas and E0 DEVELOPMENT inputs; no friend timeline files |
| Claude lead | Queue, ownership and shared API/schema decisions | ROADMAP/HANDOFF and task dispatch | Verify actual processes and branches before launch; cap 3 including friend/children |
| Codex | Independent audit and preview integration | Review reports and integration checkout | Serialize full checks/build/browser; preserve main/data/runtimes |

Friend first inspects any existing S2 session/worktree. If active, commit a safe checkpoint and stop that writer before changing tasks. Do not discard, duplicate or transfer S2 without recording it. T1 and S2 are not two concurrent processes owned by the same friend. T1 gets the sole UI slot when started; our side can prepare backend operation contracts and records but must not concurrently edit the agent map/frontend.

Both sides may own backend FEATURES through separate modules/cards. Keep ONE shared database/model and frozen interfaces. schema.ts, contracts, generated bindings, migrations, global styles and shared environment configuration need an explicit integration owner and serialized edits. Worktrees isolate Git files, not shared databases or service accounts. Friend uses their own local runtime; never points experiments at Jayden's preserved 3214/3210 or resets shared data.

## Stable timeline inputs now

- Frontend contract: apps/web/components/historical/types.ts HistoricalView, CashPoint, AlternativeView. Values are supplied cents; UI formats/positions only.
- Existing live adapter: apps/web/components/historical/live.ts buildView, BaselineDataSchema/AlternativeDataSchema/RevealDataSchema. Friend reads but does not edit it in T1.
- Existing API: historical.getCase, getRun, getReveal, getActivity; saveBaseline/reveal/computeAlternative remain current user actions. investigation.getConversation supplies real operations, but T1 does not edit its projection or graph.
- Existing consumers: /historical, simulation detail and agent-map FinancialOutput share HistoricalReplay. Check all three consumers through tests; do not fork a second chart.
- No promise of new scenario persistence/getConversationV2 yet. Add hypothetical Event/Response live wiring only after S4. Future U2 integration must preserve T1's reviewed presentation changes.

## Friend can play now

On Jayden's computer, existing preview routes were checked read-only: /playground and /case/2u returned HTTP 200. Open http://127.0.0.1:3102/playground#HistoricalReplay for synthetic layout states. This localhost URL is NOT accessible from a second computer.

On the friend's machine, fetch/checkout current preview in a separate clean task worktree, using Node 24 and the pinned pnpm. Preserve any prior S2 edits. For frontend-only development from repo root:

```sh
pnpm install --frozen-lockfile
NEXT_PUBLIC_CONVEX_URL= pnpm --filter @domino/web dev:web --port 3103
```

Then open http://127.0.0.1:3103/playground#HistoricalReplay. The blank variable applies to that command only; do not edit/copy env files or credentials. Playground synthetic states require no live backend. For actual saved 2U operations, configure their own local Convex using the existing web README commands; no shared database changes, paid providers or live CREAO needed for T1.

Test/play checklist: switch baseline/observed/response and loading/error/unavailable; select points by mouse/keyboard/touch; inspect exact source/provenance; compare the saved forecast with the revealed miss; verify response cost/post-hoc caveats; check narrow mobile and reduced motion. Synthetic preview is not financial proof. New toggles must not reveal evidence absent from supplied props or recompute any forecast.

## Exit

Friend returns branch/commit, changed files, exact focused check results, screenshots and any backend requests. Jayden's backend worker returns a separate commit under its own card. Codex audits before merging preview and runs the combined checks/browser. UI slot can transfer back to agent-map work after T1 checkpoint. No automatic main merge or provider runs.
