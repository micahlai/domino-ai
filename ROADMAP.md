# Domino roadmap and request inbox

**RESUMED October 24.** Lead: Claude Code PID 78153 (old 64305 gone). L0 06e1c98 passed final audit and goes to Codex integration. E0 1eb1052 failed its third audit: stopped, awaiting Jayden. L1 stays blocked on E0. See [pause state](kb/coordination/historical/pause-state.md).

Live chat steering: [user inbox](kb/coordination/historical/user-inbox.md). Claude lead checks new entries before dispatch/integration and between worker results, then records acknowledgment/disposition here. Feature code stays with implementation workers; new messages do not automatically cancel active work.

One user-launched Claude lead owns this queue and dispatch. Codex provides independent audit/integration support on request. [Control rules](kb/coordination/historical/claude-lead-control.md) supersede older per-worker manual-launch routing. Main untouched, monitor PAUSED, at most three implementation processes including friend/children, one UI writer.

Required design: [learning loop](kb/spec/learning-loop-design-2026-10-24.md), [evaluation recipe](kb/spec/forecast-evaluation-protocol-v1.md), [S4 persistence](kb/spec/scenario-persistence-v1.md). Cards contain exact scope; this file records status. All four L gates and real CREAO coordination remain required.

## Done

| ID | Owner | Dependency | Acceptance / evidence |
| --- | --- | --- | --- |
| C0 queue takeover | Claude lead | Codex checkpoint finished (clean tree at 16a3a56) | Lead owns ROADMAP.md/HANDOFF.md and dispatch from 2026-10-24; Codex CLI 0.159.2 logged in for audits |
| G6/G7/G8a/G8/S1/U1 | Prior workers; Codex audit | Prior gates | Accepted grouped map, frozen knowledge, scenario contracts, early product UI; feature checkpoint 0f87ed2, prior 1,185 tests/build/browser |
| D0 required-loop design | Codex; independent design auditor | Latest user scope | Reuse inventory, supported SEC JSON boundary, exact S4 and evaluation recipe reviewed; 1fce04a. Data/candidate seals and improvement are not done |
| L0 contracts | Claude worker; Codex audit/integration | Accepted S3 | Integrated d4e24d9. [Final audit](kb/reviews/L0-06e1c98-codex-final.md) ACCEPT; [integration](kb/reviews/L0-integration-d4e24d9.md) 1,251 uncached tests, 5 typechecks, lint 265 files (Turbo keychain fallback to direct runs). Lead reran contracts 338 pass |
| S3 quarterly scenario engine | Claude implementation; Codex audit/integration | Accepted S1 | Integrated at 16a3a56. [Independent audit](kb/reviews/S3-repair-5ecae8a-audit.md): 54 focused tests and 14 probes. Combined uncached preview check passed 1,208 tests, typechecks and lint. S4 persistence and U2 UI remain separate gates |

## Ready

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| S2 catalog, reserved | Friend exclusively | Continue existing S2 checkout/session; remote activity unknown | [Card](kb/tasks/S2-simulation-catalog.md): bounded read-only list and one index; commit/push and independent audit. Last fetched 1154972 has no implementation |

## In progress

Paused checkpoint: L0/E0 implementation workers have finished their final repair commits; existing read-only audits may finish. Friend S2 remains reserved with remote activity unknown. Claude lead is suspended, no new dispatch and no UI writer active.

| ID | Owner | Branch / worktree | Next action | Acceptance evidence |
| --- | --- | --- | --- | --- |

## Review

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |

## Blocked

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| C2 credential/input setup | Jayden: set env + browser check | Verified Oct 24 by read-only worker, lead spot-checked | Adapter sends `inputs.prompt` (packages/agents/src/creao.ts:299), app-scoped route only. Backend 3214 (anonymous-agent) has NO env vars set: needs CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID/_API_KEY and DOMINO_CREAO_VERIFIED_PROFILES via `npx convex env set` (user enters values). Remote `prompt` field and isolation unverified |
| E0 data custody | Jayden decision | Third audit REJECT on 1eb1052 | [Final audit](kb/reviews/E0-1eb1052-codex-final.md): (High) biome.json lacks custody ignores so `biome check .` can print sealed JSON; (Medium) generated manifest/labels JSON fail Biome format. Chronology/custody repairs verified. No repair round without Jayden |
| L1 normalization | Lead-assigned engine worker | Accepted L0 + E0 development package | [Card](kb/tasks/L1-source-normalization.md): unseen supported mapping package -> snapshot/engine, exact provenance, no company-specific patch |
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

| Request | Owner | Dependency | Acceptance / disposition |
| --- | --- | --- | --- |
| RQ1 all onboarding/reconciliation/learning/improvement required | Claude lead | Latest required scope | Accepted into L0-L5/E0/E1/L4; not complete |
| RQ2 one Claude lead with a queue and subagents | Claude lead | User launches C0; actual slots verified | This roadmap/control handoff ready; Codex stops competing dispatch |
| RQ3 Claude repair is done | Codex audit/integration complete | S3 commit 5ecae8a | Integrated at 16a3a56; combined 1,208-test/typecheck/lint check passes. No repair redispatch |
| RQ4 CREAO setup says done | Lead-assigned verifier | User-reported empty memory/data access and input/key steps | Verify remote `prompt` and backend config; no isolation/provider-success claim yet |
| RQ5 SEC contact User-Agent for E0 | Closed | E0 network work | data.sec.gov accepted a no-contact UA (6 GETs, all 200); no user email needed |
| RQ6 continuous chat steering / U1 | Claude lead; Codex records incoming requests | Read [U1](kb/coordination/historical/user-inbox.md) at next task boundary | ACKNOWLEDGED by lead 78153, Oct 24. User can send follow-ups here; preserve current repairs and triage changes without a competing dispatcher |
| New request | Claude lead | Add task ID and check ownership | Record exact request here, then move to Ready/In progress/Review/Blocked with evidence |
| RQ7 run the gated sequence / U2 | Claude lead dispatch; Codex audit/integration | Read [U2](kb/coordination/historical/user-inbox.md); accepted L0/E0 before L1 | Superseded by U3 pause, then resumed by RQ8. ACKNOWLEDGED. Continue active repairs/re-audits, integrate passing work and launch L1 when eligible; no duplicate lead or weakened gates |
| RQ8 resume via claude-lead-goal prompt | Claude lead 78153 | U3 pause | ACKNOWLEDGED Oct 24. Pause lifted; final audits read; L0 to integration, E0 stopped for Jayden |
