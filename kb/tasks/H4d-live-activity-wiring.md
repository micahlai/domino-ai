# H4d: Wire real activity into the accepted historical journey
- **Goal:** Show actual successful saves, reveals and alternative computations in the existing ActivityPanel, with truthful motion.
- **Folder:** apps/web/app/, apps/web/components/, apps/web/lib/ only; exceptions this Result and ui-styles-result.md. No backend/contracts/evidence/manifests/env edits.
- **Contracts used:** Accepted backend4795d51: api.historical.getActivity({caseId, baselineRunId}) returns latest50 ActivityEvent objects oldest first. C0 merges this dependency after the core UI reaches an accepted clean checkpoint.
- **Done when:** Validated live events appear only for the current baseline journey; alternatives remain visible; reload/reconnect do not duplicate or replay history; theme changes preserve state; failed/loading/disconnected queries do not claim live success; focused tests/typechecks pass. C0 owns full check/build/browser.
- **Notes:** Reuse ActivityPanel and ingestActivity. Reset/key state by baselineRunId, filter by caseId because alternatives carry their own runId. Cap50. Memoize query maps. Do not mount a live empty history before its first result then animate old events as new. Later actual events may animate once; respect reduced motion.
- **Honesty:** Only successful app operations exist. No product agent/tool lifecycle is implemented. Keep simulation clearly labelled in /playground. No timers, fabricated busy stages or fake failures. Existing connection notice can label stale retained results on reconnect.
- **Reuse:** Use a minimal prop or slot through HistoricalJourney/Replay, preserving the unavailable default for synthetic/presentation use. No second activity component tree or new dependencies. Keep the accepted core financial flow and frozen evidence semantics unchanged.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
