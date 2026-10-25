# TL5 acceptance log

Status: in implementation, not accepted. Scope: TL1C through TL5, user-authorized parallel Codex workers (latest user direction replaces the earlier Claude-only implementation rule), combined branch TL5-checkpoint. Starting point: accepted TL1 0b06882. Dashboard and TL6–TL8 remain separate.

## Required evidence

| Case | Expected evidence | Status |
| --- | --- | --- |
| Existing baseline | Reopen TL1 seed/hash, history and 13 weekly values unchanged | Existing live row confirmed on resumed backend |
| Rule authoring | Add/edit/remove all supported types, explicit units/provenance, saved version; older outputs unchanged | Pending |
| Attribution | Same rules applied to parent/scenario, new breach vs existing breach; rule-only edit avoids action blame | Pending |
| Event | Form late invoice and one-time expense use validated Change[]; computed per-week comparison | Pending |
| Nested event | Follow-up applies ancestors once; baseline/history unchanged | Pending |
| Question | Selected-week cash movement cites saved records, explains assumptions; context isolation | Pending |
| Prompt proposal | Natural language event and rule interpreted separately, confirmed, same output as form | Pending |
| Clarification | Missing amount/date, ambiguous target, vague/unsupported rule do not calculate | Pending |
| Failure | Malformed/refused/truncated/timeout/provider unavailable saved as failure; no financial output | Pending |
| Retry | Same request/payload returns saved result, conflicting payload rejects; expired question recovers visibly | Pending |
| Storage | Bounded text/depth/row/money, company scope, parent/proposal linkage validated | Pending |
| Catalog and seam | Pagination, stable working link, strict WeeklyResultRefV1 and real OperationSummaryV1 | Pending |
| Quiet reopen | Same inputs/questions/rules/values after reload; no implicit engine/provider call | Pending |
| Browser | Complete journey at desktop and phone width; keyboard, chart/table, no page overflow | Pending |
| Checks | Focused tests, full pnpm check, Convex typecheck, production build, unchanged lane import inventory | Pending |

## Runtime

Resumed own anonymous Convex on 3240/3241 and Next on 3107. Existing saved baseline `timeline:baseline/6d468229c363b6896fe724402d98a43795953529` still returns company kestrel and 13 saved weeks. No peer ports or data reset. Worker branches TL2-events-backend, TL2-timeline-screen, TL3-questions, independent worktrees. No main/lane-main merge or push.
