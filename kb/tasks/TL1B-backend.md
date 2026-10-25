# TL1B: validate, compute and save baseline

- **Goal:** A verified weekly seed and explicit assumptions produce an immutable, reopenable engine baseline.
- **Folder:** `apps/web/convex/timeline` only (CLI may regenerate api bindings after integration).
- **Contracts used:** parseWeeklySeedJson, canonicalJson, contentHashPreimage, CompanyModelSchema, ConstraintSchema, ForecastSchema, DominoSchema, HistoryWeekSchema, PastEventSchema.
- **Done when:** convex-test covers pinned Kestrel seed, tampering, invalid inputs, request retry/conflict/concurrency, changed assumptions/new runs, read without recompute, and zero Field writes; check passes.
- **Notes:** ../features/timeline/TL1-implementation.md; weekly boundary fixture, not substitute snapshot. Depends TL1S.

## Result
- Done:
- What changed (files):
- Watch out:
