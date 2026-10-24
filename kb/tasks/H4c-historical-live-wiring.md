# H4c: One live historical journey using the existing four-style UI
- **Goal:** A readable /historical page that loads 2U cutoff evidence, saves a run, reveals actuals, shows the miss and computes one cost-only alternative, with reload; keep activity unavailable during this core phase.
- **Folder:** apps/web/app/, apps/web/components/, apps/web/lib/ only; exceptions this Result and ui-styles-result.md. No backend/contracts/evidence/manifests/env changes.
- **Contracts used:** Accepted H2c actual generated APIs; H2d is a separate later wiring checkpoint and HistoricalCase/Run/Comparison/ActivityEvent. Core phase dependency66b2d2a is accepted and integrated; do not invent or call H2d APIs until C0 supplies its tested SHA. Start from H4 ancestry436878e, never stale H3.
- **Done when:** Focused adapter/component tests and typechecks pass; no later data appears before successful reveal; mutation errors remain visible and retryable; saved run and reveal reload by IDs; four styles preserve financial state; activity remains explicitly unavailable in this phase, with a clean existing ActivityPanel seam for H2d. C0 owns full check/build/browser.
- **Notes:** Reuse HistoricalReplay/Chart, ActivityPanel, existing provider and Radix primitives. Keep synthetic playground separate and operational routes intact. Never import the case/protocol JSON into a client bundle. Missing backend has an honest unavailable state.
- **Evidence:** Use one consistent cash metric, exact backend cents and report dates. No reconstructed weekly actuals or new financial math. Show cutoff, origin, projection and publication dates, method/input hash, source links and reported/derived/assumption labels.
- **Honesty:** Replace inherited prospective claims such as "forecast saved before results published" with retrospective wording: saved before this reveal, authored with outcome known. No bankruptcy-warning or prevention claim. Risk is unknown, not safe. Post-hoc means outcome known during authorship, regardless of which button the viewer clicked first.
- **Alternative:** Backend cost-only sensitivity, explicit upfront range/midpoint caveat and 92-day lag. Benefits beyond target and feasibility are unknown. A1-DOWNSIDE is unmodeled, never display zero as its value. Minimally adapt local view props for unknown/ranges instead of inventing numbers. No scoring alternative against observed results.
- **Flow:** Mutations run from user actions only; stable request IDs for retries, no effect-driven duplicate saves. Use getRun.inputSnapshot for saved forecast input provenance and getCase for available/revealed evidence; do not substitute current input facts for the saved snapshot. Invalid IDs/network failure offer a clear recovery without silently replacing a saved forecast. Real activity is scoped to this baseline journey, not development workers.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
