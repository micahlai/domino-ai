# TL1 saved baseline: local acceptance

2026-10-24, preview branch `TL1-checkpoint`, worktree `/Users/micahlai/code/domino-timeline`. Scope: TL1S/TL1B/TL1U only. No main or lane-main feature merge, push, cloud deployment, provider call or dashboard edit.

## Implementation

- Backend worker `TL1-saved-baseline`: ac3f975, repaired e9e3f3c. Timeline-owned append-only table; verified frozen weekly seed plus explicit local model/rules/note; engine baseline, history and dominoes saved transactionally. Same company/request retries return the original run; differing payload conflicts; reads return saved outputs without running engine.
- UI worker `TL1-baseline-screen`: d1b8a37. Existing Timeline playground hosts import/review/save, strict response validation, exact weekly values, provenance and stable encoded company/run links. Assumptions must be reviewed; changing inputs clears review. Original historical harness retained.
- Lead merged on checkpoint branch and regenerated api.d.ts through the running local Convex CLI. Frozen contracts/root schema/shared math/Field tables/components unchanged. Legacy import inventory stays 18, zero in harness files.

## Independent review

Initial backend held for three reproduced issues: unsafe accumulated cents, ignored forward financial fields and total document size larger than seed text. Repair adds conservative BigInt arithmetic bound before engine calls, explicit unsupported-input rejection, and complete generated-row UTF-8 size bound. Fourteen independent recheck probes plus 41 backend/schema tests passed; auditor accepted e9e3f3c. UI passed eight extra independent behavior probes and existing 15 Timeline tests, with no independent blocker.

Regression tests ship in `apps/web/convex/timeline/baselines.test.ts`. Scratch audit probes remain under `/tmp/tl1-audit` and `/tmp/tl1ui-audit` on this machine. No rejected unsafe rows were deployed or saved to the local backend.

## Combined and actual runtime evidence

- `pnpm check`: 1,661 tests (contracts 496, engine 344, sim 5, agents 298 cached; web 518 fresh), five package typechecks, lint 322 files. Separate Convex typecheck passed. Production Next build passed. Logs `/tmp/domino-TL1-combined-check.log` and `/tmp/domino-TL1-build.log`.
- Local backend on 3240/3241 loaded timelineBaselines indexes and functions. App on 3107.
- Browser: valid Kestrel seed verified, unreviewed save disabled, confirmed review enabled save. Save produced run `timeline:baseline/6d468229c363b6896fe724402d98a43795953529` under `kestrel`.
- Read-only result has 13 weekly rows; low point Nov 16, 2026, usable cash $2,689,000.00 under the neutral model. Reload preserved every displayed weekly value. Result is not the older Kestrel prototype's learned-model forecast.
- Actual public API retry returned created:false and same run; tampered seed rejected by backend; saved result unchanged. Frontend tampered-copy control also rejects and disables review/save.
- Observed 719px browser viewport has document width 719px (no page overflow; wide table scrolls within its container). Screenshot `/tmp/domino-TL1-saved-baseline.png`. No separate 390px device test claimed.

## Limits / next

This is the first saved-baseline smoke slice, reached at `/playground/timeline-seam`; main timeline chart integration is TL2. Constraint editing is TL1C; conversational questions/event parsing TL3; sessions/catalog TL4. Advanced JSON can supply supported assumptions, but is not the promised constraint editor. Default model has no learned delays, extra recurring spend or additional cash rules; the UI discloses this.

The current engine does not support imported forward billing plans, pending payouts, invoice collections/writeoffs/paid amounts or agreed bill dates. TL1 refuses these fields instead of ignoring their financial meaning. Engine adoption is a separate owned checkpoint. No production authentication claims; this remains the local demo access model.

Field owns the dashboard file. Timeline's eventual health/scenario/chart handoff is tracked in boundary-requests.md; WeeklyResultRefV1 has no embedded chart payload yet. TL1 makes no final joined-Field acceptance claim.
