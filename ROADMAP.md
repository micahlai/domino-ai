# Domino roadmap and request inbox

**Latest user direction: two independent full-stack features with a later merge.** [Ownership/interface plan](kb/spec/independent-feature-lanes.md), [Field outcome](kb/features/field/BRIEF.md), [Timeline outcome](kb/features/timeline/BRIEF.md). First finish shared P0 contracts/schema composition/harnesses and independent acceptance. Then each feature owns UI/backend/internal queue on its own long-lived branch, one writer per owned domain; cap three implementation processes across both people. P0 is NOT implemented. [Give current lead this setup prompt](prompts/shared/prepare-independent-features.md). Preserve/checkpoint active L1/S2 work first. Older one-global-dispatcher/one-UI-writer routing applies only until P0, not the independent stretch.

**Current accepted foundation.** L0 is integrated d4e24d9; user-approved E0 is integrated 05f10db with combined checks. L1 57a1581 first review rejected; lead owns checking repair state. Claude lead 78153 was the last verified shared dispatcher, not reverified by this planning update. Monitor remains PAUSED.

Live chat steering: [user inbox](kb/coordination/historical/user-inbox.md). Claude lead checks new entries before dispatch/integration and between worker results, then records acknowledgment/disposition here. Feature code stays with implementation workers; new messages do not automatically cancel active work.

One user-launched Claude lead owns this queue and dispatch. Codex provides independent audit/integration support on request. [Control rules](kb/coordination/historical/claude-lead-control.md) supersede older per-worker manual-launch routing. Main untouched, monitor PAUSED, at most three implementation processes including friend/children, one UI writer.

Required design: [learning loop](kb/spec/learning-loop-design-2026-10-24.md), [evaluation recipe](kb/spec/forecast-evaluation-protocol-v1.md), [S4 persistence](kb/spec/scenario-persistence-v1.md). Cards contain exact scope; this file records status. All four L gates and real CREAO coordination remain required.

## Done

| ID | Owner | Dependency | Acceptance / evidence |
| --- | --- | --- | --- |
| C0 queue takeover | Claude lead | Codex checkpoint finished (clean tree at 16a3a56) | Lead owns ROADMAP.md/HANDOFF.md and dispatch from 2026-10-24; Codex CLI 0.159.2 logged in for audits |
| G6/G7/G8a/G8/S1/U1 | Prior workers; Codex audit | Prior gates | Accepted grouped map, frozen knowledge, scenario contracts, early product UI; feature checkpoint 0f87ed2, prior 1,185 tests/build/browser |
| D0 required-loop design | Codex; independent design auditor | Latest user scope | Reuse inventory, supported SEC JSON boundary, exact S4 and evaluation recipe reviewed; 1fce04a. Data/candidate seals and improvement are not done |
| E0 custody/development package | Claude implementation; Codex audit/integration | Jayden-approved existing config fix after third rejection | Integrated 05f10db; [integration](kb/reviews/E0-integration-05f10db.md). Combined 1,251-test/typecheck/lint check passes (mixed cache), synthetic self-check fresh. Protected data unopened; L4 proof remains unmet |
| L0 contracts | Claude worker; Codex audit/integration | Accepted S3 | Integrated d4e24d9. [Final audit](kb/reviews/L0-06e1c98-codex-final.md) ACCEPT; [integration](kb/reviews/L0-integration-d4e24d9.md) 1,251 uncached tests, 5 typechecks, lint 265 files (Turbo keychain fallback to direct runs). Lead reran contracts 338 pass |
| S3 quarterly scenario engine | Claude implementation; Codex audit/integration | Accepted S1 | Integrated at 16a3a56. [Independent audit](kb/reviews/S3-repair-5ecae8a-audit.md): 54 focused tests and 14 probes. Combined uncached preview check passed 1,208 tests, typechecks and lint. S4 persistence and U2 UI remain separate gates |

## Ready

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| S2 catalog, reserved | Friend exclusively | Continue existing S2 checkout/session; remote activity unknown | [Card](kb/tasks/S2-simulation-catalog.md): bounded read-only list and one index; commit/push and independent audit. Last fetched 1154972 has no implementation |
| P0-C / P0-S shared setup | Current Claude lead assigns scoped workers | Actual L1/S2 ownership/checkpoint and available slots | [Contracts](kb/tasks/P0-C-feature-boundary.md), [schema](kb/tasks/P0-S-schema-ownership.md). Prepared cards only; independent audit required |
| T1 timeline controls | Optional internal Timeline subtask after P0 | Superseded as the complete friend assignment | Full [Timeline brief](kb/features/timeline/BRIEF.md) replaces the four-file feature split; preserve existing S2 |

## In progress

L0/E0 are accepted and integrated. No implementation worker launched by this planning update. Friend S2 remains reserved; lead checks actual L1 repair/S2 activity and available slots before P0 assignment. Active repairs are preserved through a safe checkpoint.

| ID | Owner | Branch / worktree | Next action | Acceptance evidence |
| --- | --- | --- | --- | --- |

## Review

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| L1 normalization 57a1581 | Claude lead owns repair/checkpoint; Codex audits | First review REJECT | [Audit](kb/reviews/L1-57a1581-codex-audit.md): invalid restricted-cash row selection and unauthenticated fiscal calendar. Repair activity must be checked before dispatch; not accepted |

## Blocked

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| P0-H + independent branch release | Current Claude lead; Codex acceptance | Accepted P0-C/P0-S, reviewed S2 index, combined checks | [Harness card](kb/tasks/P0-H-independent-harnesses.md); record exact common base/fixture hashes/namespace ownership before long forks |
| C2 credential/input setup | Jayden enters APP_ID + API_KEY privately; then verifier | Config separated from verification (Jayden, Oct 24) | Adapter sends `inputs.prompt` (creao.ts:299). Keep DOMINO_CREAO_VERIFIED_PROFILES UNSET until verified: (1) names set + app id MATCH, (2) key scoped to this app only, (3) instructions frozen-input + `<<<DOMINO_RESULT>>>`, hash as profileVersion, (4) remote field `prompt`, (5) offline parser compatibility, (6) memory isolation (account/team inheritance needs docs or one approved canary), then (7) set gate |
| L2 reconciliation | Lead-assigned engine worker | Accepted L1 | [Card](kb/tasks/L2-source-reconciliation.md): true conflicts block affected roles; duplicates/timing/definitions and totals handled honestly |
| L3 scoped feedback | Lead-assigned engine worker | Accepted L2 | [Card](kb/tasks/L3-scoped-rules.md): later eligible behavior changes, unrelated-company isolation, rejection/reversal/rollback |
| L5 knowledge runtime | Lead-assigned backend worker | Accepted L0-L3; S2 schema release; exact schema audit | [Card](kb/tasks/L5-knowledge-runtime.md): same database, durable versioned knowledge, concurrent idempotence and old-row compatibility |
| E1 evaluator | Lead-assigned evaluator worker | Accepted L0/L3 + E0 development interface | [Card](kb/tasks/E1-quarter-evaluator.md): exact paired metrics/failures on development/synthetic data; no sealed labels |
| S4 persistence | Lead-assigned backend worker | Accepted S2/S3/L0; serialized after L5 | [Card](kb/tasks/S4-durable-scenarios.md): frozen baseline/response extension/protocol pins, hashes and concurrent requests; V2/legacy compatibility |
| U2 visible journey | Sole lead-assigned UI writer | Accepted S2/L5/E1/S4 APIs | [Card](kb/tasks/U2-complete-simulation-journey.md): real full flow and read-only reopen; combined S4/U2 browser/activation gate |
| C2 real coordinator | Lead-assigned bounded worker after verification | Verified app identity/instructions/input/binding/isolation; exact follow-on card | [Card](kb/tasks/C2-real-coordinator-gate.md): actual bounded capability selection/jobs/events, old app-scoped API only |
| L4 measured improvement | Claude lead; independent evaluator/auditor | Data/protocol/candidate/evaluator seals BEFORE test | [Protocol](kb/spec/forecast-evaluation-protocol-v1.md): 16 paired quarters, >=5% lower pooled error, neither company worse, >=9 strict wins. Negative result leaves gate open |
| F0 final acceptance | Claude lead; Codex audit on request | All required gates above | Onboard -> reconcile -> forecast -> reveal -> accept/apply feedback -> evaluate -> costed scenario -> reopen; full checks/build/browser, no main merge |

## User request inbox

Lead triages each request into a card, owner, dependency and acceptance before dispatch. A request does not bypass existing gates or ownership.

RQ11 / U6 supersedes RQ10's tiny T1 assignment: each person owns a complete feature and can continuously steer their own agent. Prepared full feature briefs, owner prompts and P0 setup cards; no implementation launched. The global roadmap tracks P0/joint acceptance; feature-local roadmaps own internal tasks after P0. L1-L5/E1/C2 belong to Field, S2/S4/U2 Timeline portions belong to Timeline; older cross-feature runner/serial dependencies must be reconciled under the new ownership plan before dispatch, not used to restore a single global queue.

| Request | Owner | Dependency | Acceptance / disposition |
| --- | --- | --- | --- |
| RQ11 complete independent features / U6 | Current lead prepares P0; then each person steers their own feature lead | Accepted common base and frozen exchange/schema ownership/harnesses | Prepared full briefs, feature prompts and setup cards. Not yet acknowledged by Claude; no implementation/readiness claimed. Supersedes RQ10's small T1 assignment after P0 |
| RQ1 all onboarding/reconciliation/learning/improvement required | Claude lead | Latest required scope | Accepted into L0-L5/E0/E1/L4; not complete |
| RQ2 one Claude lead with a queue and subagents | Claude lead | User launches C0; actual slots verified | This roadmap/control handoff ready; Codex stops competing dispatch |
| RQ3 Claude repair is done | Codex audit/integration complete | S3 commit 5ecae8a | Integrated at 16a3a56; combined 1,208-test/typecheck/lint check passes. No repair redispatch |
| RQ4 CREAO setup says done | Lead-assigned verifier | User-reported empty memory/data access and input/key steps | Verify remote `prompt` and backend config; no isolation/provider-success claim yet |
| RQ5 SEC contact User-Agent for E0 | Closed | E0 network work | data.sec.gov accepted a no-contact UA (6 GETs, all 200); no user email needed |
| RQ6 continuous chat steering / U1 | Claude lead; Codex records incoming requests | Read [U1](kb/coordination/historical/user-inbox.md) at next task boundary | ACKNOWLEDGED by lead 78153, Oct 24. User can send follow-ups here; preserve current repairs and triage changes without a competing dispatcher |
| New request | Claude lead | Add task ID and check ownership | Record exact request here, then move to Ready/In progress/Review/Blocked with evidence |
| RQ10 earlier bounded split | Historical acknowledgment | Superseded by RQ11 | Lead acknowledged small T1/sole-UI proposal before Jayden clarified complete independent ownership. Preserve S2; use RQ11/P0 and full feature briefs for the new plan |
| RQ7 run the gated sequence / U2 | Claude lead dispatch; Codex audit/integration | Read [U2](kb/coordination/historical/user-inbox.md); accepted L0/E0 before L1 | Superseded by U3 pause, then resumed by RQ8. ACKNOWLEDGED. Continue active repairs/re-audits, integrate passing work and launch L1 when eligible; no duplicate lead or weakened gates |
| RQ8 resume via claude-lead-goal prompt | Claude lead 78153 | U3 pause | ACKNOWLEDGED Oct 24. Pause lifted; final audits read; L0 to integration, E0 stopped for Jayden |
