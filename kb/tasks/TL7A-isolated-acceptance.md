# TL7A: verify isolated TL6/TL7 checkpoint

- **Goal:** prove saved financial output and bounded analysis journey without changing TL5.
- **Folder:** apps/web/convex/timeline/analysisAcceptance.test.ts (integration tests only), kb/features/timeline and this Result; scratch /tmp/TL7-*.
- **Contracts used:** saved TL6 output/AnalysisReceipt, Forecast, Change, Constraint, OperationSummaryV1, WeeklyResultRefV1; existing engine read-only expected values.
- **Done when:** actual scheduled launch → risk/response saved → health/chart export → quiet reopen; invalid/company/retry/failure/budget checks; full check/build/Convex typecheck/lane imports; hidden/separate browser preview; TL5 still597fcc0/runtime preserved.
- **Notes:** user explicitly forbids merging into TL5. Integrate only TL7-checkpoint, own3250/3251/3108 data/services. No shared contracts/engine/root schema/dashboard/Field edits. Scoped worker results independently audited before integration; proposed Field envelope adoption remains separate.

## Result
- Done: Accepted locally: full1,942 tests, five typechecks, lint381, separate Convex typecheck and production build; actual API22 checks, browser start/response/export/history and390px screenshot review pass.
- What changed: Added real backend-to-UI/output integration test, generated bindings and feature-local acceptance/runtime/smoke evidence.
- Watch out: TL5 remains597fcc0 on3107/3240; no merge or data/env copying. Field adoption is separate. See kb/features/timeline/TL7-acceptance.md.
