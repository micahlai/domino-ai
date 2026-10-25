# TL1R: independent baseline audit

- **Goal:** Find actionable correctness/ownership defects before TL1 integration.
- **Folder:** Read-only `/Users/micahlai/code/domino-TL1` (scratch probes in /tmp only).
- **Contracts used:** WeeklySeedV1, CompanyModel, Constraint, Forecast and fixed ../features/timeline/TL1-interface.md.
- **Done when:** Review ac3f975 against TL1S/TL1B cards; report concrete defects with reproductions and file/line; check unsafe aggregates, input integrity, rollback/idempotence and old API compatibility.
- **Notes:** skills/review/SKILL.md; no edits/children/providers/runtime/deploy/commit. Lead suspects accepted recurring spend can overflow safe integer aggregates despite individually bounded inputs; reproduce independently.

## Result
- Done: independent auditor rejected ac3f975 for unsafe aggregate money, ignored forward input semantics and oversized generated rows; accepted e9e3f3c after 14 recheck probes and 41 tests. UI d1b8a37 had no independent blocker (8 additional probes/15 Timeline tests). Lead combined/runtime checks in ../features/timeline/TL1-acceptance.md.
- What changed (files): no source edits by reviewer; scratch probes in /tmp/tl1-audit and /tmp/tl1ui-audit. Lead filled this Result.
- Watch out: initial candidate was never deployed; only repaired backend reached local DB. TL1 does not implement future milestones or production auth.
