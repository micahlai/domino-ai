# TL1 implementation decisions

Authorized by user request to start the Timeline roadmap. Implement TL1S/TL1B/TL1U first; no agent jobs, event simulation or constraint editing in this slice.

## Lane-local decisions

- Keep WeeklySeedV1 frozen. Model and constraints are explicit Timeline-local assumptions submitted separately as validated JSON text with a human-readable assumption note. Freeze all inputs in the run. Do not claim Field supplied them.
- Form starts with an explicit neutral model (version 0, empty customerDelayDays/recurringSpend/rules) and no extra constraints. Explain limitations and require a review checkbox before saving. Advanced controls accept supplied model/rules JSON. Never silently use the unrelated global fixture model.
- New table(s) only in Timeline schema fragment, names prefixed timeline, string/domain company identity. No Field reads/writes or root schema changes. Freeze input/result in one transactional mutation using existing public engine exports; no shared math/private cross-lane imports.
- Backend verifies JSON parse AND canonical SHA-256 seed content hash. Bound input/document sizes before expensive work. Validate model/constraints dates, limits, safe integer cents and foreign references; reject ambiguous relationships instead of guessing. Reject unknown assumption fields instead of silently stripping them. Pay-by-date requires a real bill target.
- Scope request IDs to canonical company identity; bind first request to canonical seed+model+constraints+assumption note+method version. Same request retries return saved output; changed payload conflicts. Indexed stable domain run lookup; changed assumptions can create new runs under same seed. No rewrites. Test concurrency and rollback.
- Save engine.forecast (13 weeks), engine.dominoes with explicit context, history/pastEvents, seed/input hashes, method pin and assumptions. Read returns saved output without computation. No risk scan/stress test needed. Scheduled items annotate records, never add duplicate cash.
- Existing anonymous demo security model only. Company-bound lookup/request context is not authentication. Do not claim production access control.
- UI uses /playground/timeline-seam through owned components. Import/save section, labelled peer fixture, reviewed assumptions, readable forecast, saved-run link using runId/company query parameters. Normal UI uses plain words; JSON controls can live in Advanced. Preserve quarterly harness/legacy consumers.
- Typed function references allowed pending CLI codegen; never manually edit generated files. Browser components never import engine/agents or runtime backend code.

## Verification and limits

Read apps/web/AGENTS.md, generated Convex guidelines, relevant installed Next docs, ui-build and taste before editing. Use installed packages. No deployment/reset/providers/secrets/sealed data/peer edits. Worker uses own checkout with no backend environment; lead deploys to local backend after audit. No child workers.

Execute three cards sequentially, fill Results, commit only scoped code/cards. Run pnpm check and separate Convex typecheck. Lead independently audits and browser-verifies before TL1 is smoke-ready.
