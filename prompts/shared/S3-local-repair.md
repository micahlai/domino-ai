# Local Claude: repair S3 saved-baseline compatibility

> Completed at 5ecae8a; independent scoped audit passes. Archive instructions below, not a new dispatch. See kb/reviews/S3-repair-5ecae8a-audit.md and ROADMAP.md. Claude lead owns the next integration step.

Human-launched only. Use the existing domino-S3 worktree on S3-quarterly-event-engine, currently commit 38297d4. First inspect branch/status and verify no other writer is active. Preserve all existing work. Read AGENTS.md, kb/tasks/S3-quarterly-event-engine.md, the installed orchestrator and ponytail skills, and skills/engine-tdd/SKILL.md. One bounded worker, no nested agents.

Codex independently audited the initial checkpoint and blocked integration on one confirmed defect:

- packages/engine/src/period-scenario.ts checkBaseline requires exact equality between saved run.inputs and quarterBridge.inputs. The actual backend saveBaselineIn adds the disclosed AS-RESTRICTED method assumption. A real saved 2U baseline passes HistoricalRunContextSchema but quarterScenario rejects it. The existing period-2u.test.ts assemble helper reproduces the persisted shape.

Repair this narrowly. Preserve the saved baseline and its manifest byte-for-byte. Accept only explicitly validated method assumptions and their provenance. Do not strip AS-RESTRICTED, ignore arbitrary extra inputs, disable lineage validation or rewrite historical records. Inspect the real assumption definition and existing engine checks before choosing the smallest safe change. If the correct fix requires changing existing period.ts or shared contracts, record the exact proposed scope instead of silently editing outside ownership.

Ownership: packages/engine/src/period-scenario.ts, period-scenario.test.ts, index.ts export only if necessary, and the S3 task card Result. No backend/schema/contracts/UI/provider/environment changes. Friend exclusively owns S2 catalog and its single schema index.

Add a regression using the real 2U case and saved backend-shaped baseline. Demonstrate event-only and A1-response scenarios work, while wrong predictions, wrong methods, missing provenance and unsupported extra inputs still fail. Preserve exact money, restricted cash, date cutoff and post-hoc behavior.

Integration note, not extra implementation scope: the authoritative 2U protocol marks A1 post-hoc even though the case assumption's selectedAfterReveal is false. S4 must freeze and propagate that protocol taint plus the response evidence extension. Do not claim S3 alone solves persistence or CREAO.

Use Node 24. Run focused period/period-2u/period-scenario tests, engine typecheck and lint on changed files. No full suite/build/browser/server/provider calls; Codex serializes those. Update only your task Result with exact changes/checks/limits, commit a repair on this branch, then stop. Do not merge or push main or preview. Send Jayden the commit hash for Codex audit.
