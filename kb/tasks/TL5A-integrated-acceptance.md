# TL5A: combined Timeline acceptance

- **Goal:** verify the complete saved data → question → confirmed rules/event → nested future event → catalog/reopen journey against the actual integrated backend and screen.
- **Folder:** apps/web/convex/timeline/coreAcceptance.test.ts (integration tests only); kb/features/timeline acceptance/roadmap/handoff/smoke/local docs and this Result. Browser/API scratch artifacts under /tmp.
- **Contracts used:** Change, Constraint, WeeklySeedV1, Forecast, OperationSummaryV1, WeeklyResultRefV1; read-only pure engine for expected output.
- **Done when:** real workspace+questions integration tests and live API/browser journey pass; full pnpm check, separate Convex typecheck, production build, lane import inventory; desktop+390px phone screenshots. Saved reopen makes no engine/provider calls.
- **Notes:** Lead integrates reviewed worker branches on TL5-checkpoint only; latest user directs all Timeline work through Codex. No dashboard/Field/shared contracts/root schema/engine edits. Label fixtures and optional provider limitations; do not claim production auth. Record exact evidence and outstanding limits before marking TL5 accepted.

## Result
- Done: TL5 locally accepted; 3 real integrated journey tests, 31 live API checks plus 3 rule checks, actual optional provider intent, complete desktop/phone browser journey. Full 1,877 tests/typechecks/lint, Convex typecheck/build and lane inventory pass.
- What changed: coreAcceptance.test.ts; CLI-generated API bindings; feature-local ROADMAP/HANDOFF/LOCAL/SMOKE-TESTS/CONSTRAINTS/TL5-acceptance; four durable browser screenshots.
- Watch out: labelled fixture/local anonymous deployment only; bounded questions and Sunday cash checks. TL6–TL8 and real Field/production authorization remain separate. No dashboard/shared/main changes. Own services remain running.
