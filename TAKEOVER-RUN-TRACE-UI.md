# Field run trace UI handoff, Oct 25 2026

- Goal: exact saved Field and Timeline calculation explanations, led by data used, change, checks and result.
- Checkout: `domino-field-operating-ui`, branch `field/run-trace-ui`, base `ed66ed3`.
- Changed: Field trace route/view/story, Field layout guard bypass and AppShell recorded-run header, suggestion links, Timeline calculation route/view, URL helpers/tests, task result.
- Verified: Node 24.11.1; focused Vitest 5 passed; Biome check passed on changed UI files; `git diff --check` passed.
- Typecheck: blocked locally because `apps/web/lib/field-trace-contract.ts` belongs to B and is not in this checkout. The unresolved import also causes secondary implicit-any errors. Run web typecheck after integrating B's contract.
- Browser: not run in this isolated branch. Root integration should verify exact Field/Timeline links against the live backend, legacy/failed/running receipts, and a changed top-bar selection.
- Deferred: Timeline WorkspaceView/ScenarioSidebar/header links and new-scenario flow because friend owns those files until merged. Root can add `timelineCalculationHref(companyId, runId)` using the returned exact run ID.
- Next: integrate B contract/backend and friend UI, then add Timeline saved-scenario entry links, rerun typecheck and relevant tests, verify in browser. No live processes or credentials were changed.
