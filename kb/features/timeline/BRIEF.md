# Timeline (friend): dashboard, 13-week timeline, auto-analysis, simulations

Vision: ../../spec/weekly-product-vision-2026-10-24.md. Supersedes the SEC-quarterly Timeline brief (kept in git history). Lean: ship working features fast, real behavior over polish.

## Build

1. **Dashboard (home).** Cash now, 13-week low point and week, runway, AR/AP due, and a health rating (OK / watch / at risk) with the reason. Links to the worker page (Field) and the timeline.
2. **13-week timeline.** Start from the existing /c/[companyId] multiverse timeline. Add past events, scheduled future items (client payments, bills, payroll from the seed), and scenario branches that can split again and rejoin the main line when the company survives; a failing branch ends visibly with the cause (e.g. cash deficit week).
3. **Auto-analysis.** Background job generates plausible unexpected events, runs dominoes and stress tests (packages/engine forecast/dominoes/stress-test/score-fix), tests planned responses, scores resilience, and explains failures.
4. **Simulation catalog.** Every simulation saved and reopenable by stable link without recomputing.

## Seam

Import `WeeklySeedV1` JSON text (packages/contracts weekly-boundary.ts) and verify its hash; return `WeeklyResultRefV1` (with health) and OperationSummaryV1 records. Develop against the frozen weekly fixture until Field exports real seeds. Never import Field-private files (`node apps/web/scripts/lane-imports.mjs`).

## Owns

Tables: risks, branches, fixes, resilience, history, grades, explanations, plus historical*. Engine: forecast/dominoes/stress-test/score-fix/health (add rejoin and scheduled-item support in your own new modules or by joint checkpoint for shared math). UI: dashboard, /c/[companyId] timeline, simulations. Shared contracts/schema composition change only by a joint checkpoint.

## Done

Seed in -> dashboard health -> timeline with history, scheduled items and branches that rejoin or fail -> auto-analysis finds a risky scenario and explains it -> saved in the catalog and reopens identically. Real backend, tests pass.
