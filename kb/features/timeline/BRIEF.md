# Timeline (friend): dashboard, 13-week timeline, auto-analysis, simulations

Vision: ../../spec/weekly-product-vision-2026-10-24.md. Supersedes the SEC-quarterly Timeline brief (kept in git history). Lean: ship working features fast, real behavior over polish.

## User clarification and delivery priority (2026-10-24)

The primary feature is an interactive timeline of existing company data. A person asks questions about it, enters hypothetical events and future events, and sees calculated possible effects. Implement that saved question/event/comparison loop first. The implementation order and acceptance criteria live in [ROADMAP.md](ROADMAP.md).

Questions use the selected timeline context and cite records/assumptions. Structured event entry and natural-language proposals share one validated engine path; missing event details require clarification. Historical what-ifs preserve observed history. Future events are labelled planned or hypothetical. Every simulation and its conversation can be reopened without rerunning work.

Users can also define constraints in the prompt or add/change them later. Show the interpreted rule for confirmation; each simulation reports which action violates which rule, when and why, with the computed value against the limit. Rule edits create new versions and never alter old saved results. This is core scope; see [CONSTRAINTS.md](CONSTRAINTS.md).

Automatic analysis and branch rejoin remain follow-on milestones after the core loop works. Latest ownership: Jayden's Field lane owns the dashboard and `components/timeline/dashboard/Dashboard.tsx`; Timeline supplies the financial outputs through the agreed seam at integration.

## Build

1. **Financial output for Field's dashboard.** Compute health rating, risk scenarios and 13-week chart data. Return the supported `WeeklyResultRefV1` fields at the seam; coordinate a versioned chart/scenario data handoff if needed. Field owns dashboard layout and content.
2. **13-week timeline.** Start from the existing /c/[companyId] multiverse timeline. Add past events, scheduled future items (client payments, bills, payroll from the seed), and scenario branches that can split again and rejoin the main line when the company survives; a failing branch ends visibly with the cause (e.g. cash deficit week).
3. **Auto-analysis.** Background job generates plausible unexpected events, runs dominoes and stress tests (packages/engine forecast/dominoes/stress-test/score-fix), tests planned responses, scores resilience, and explains failures.
4. **Simulation catalog.** Every simulation saved and reopenable by stable link without recomputing.

## Seam

Import `WeeklySeedV1` JSON text (packages/contracts weekly-boundary.ts) and verify its hash; return `WeeklyResultRefV1` (with health) and OperationSummaryV1 records. Develop against the frozen weekly fixture until Field exports real seeds. Never import Field-private files (`node apps/web/scripts/lane-imports.mjs`).

## Owns

Tables: risks, branches, fixes, resilience, history, grades, explanations, plus historical*. Engine: forecast/dominoes/stress-test/score-fix/health (add rejoin and scheduled-item support in your own new modules or by joint checkpoint for shared math). UI: /c/[companyId] timeline and simulations. Field owns the dashboard, including `components/timeline/dashboard/Dashboard.tsx` despite that path. Shared contracts/schema composition change only by a joint checkpoint.

## Done

Core: seed in -> timeline with history/scheduled items -> ask and receive an evidence-backed answer -> add an event and inspect engine-computed effect -> add a future/follow-up event -> compare -> save/reopen identically. Real backend, tests/build/browser pass.

Extended: dashboard health, automatic risky-scenario/response analysis and branch rejoin/failure behavior meet their separate roadmap acceptance criteria. Core completion does not claim these extensions are complete.
