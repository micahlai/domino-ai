# Domino roadmap and request inbox

Live chat steering: [user inbox](kb/coordination/historical/user-inbox.md). Claude lead checks new entries before dispatch/integration and between worker results, then records acknowledgment/disposition here. Feature code stays with implementation workers; new messages do not automatically cancel active work.

One user-launched Claude lead owns this queue and dispatch. Codex provides independent audit/integration support on request. [Control rules](kb/coordination/historical/claude-lead-control.md) supersede older per-worker manual-launch routing. Main untouched, monitor PAUSED, at most three implementation processes including friend/children, one UI writer.

Required design: [learning loop](kb/spec/learning-loop-design-2026-10-24.md), [evaluation recipe](kb/spec/forecast-evaluation-protocol-v1.md), [S4 persistence](kb/spec/scenario-persistence-v1.md). Cards contain exact scope; this file records status. All four L gates and real CREAO coordination remain required.

## Done

| ID | Owner | Dependency | Acceptance / evidence |
| --- | --- | --- | --- |
| C0 queue takeover | Claude lead | Codex checkpoint finished (clean tree at 16a3a56) | Lead owns ROADMAP.md/HANDOFF.md and dispatch from 2026-10-24; Codex CLI 0.159.2 logged in for audits |
| G6/G7/G8a/G8/S1/U1 | Prior workers; Codex audit | Prior gates | Accepted grouped map, frozen knowledge, scenario contracts, early product UI; feature checkpoint 0f87ed2, prior 1,185 tests/build/browser |
| D0 required-loop design | Codex; independent design auditor | Latest user scope | Reuse inventory, supported SEC JSON boundary, exact S4 and evaluation recipe reviewed; 1fce04a. Data/candidate seals and improvement are not done |
| S3 quarterly scenario engine | Claude implementation; Codex audit/integration | Accepted S1 | Integrated at 16a3a56. [Independent audit](kb/reviews/S3-repair-5ecae8a-audit.md): 54 focused tests and 14 probes. Combined uncached preview check passed 1,208 tests, typechecks and lint. S4 persistence and U2 UI remain separate gates |

## Ready

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| S2 catalog, reserved | Friend exclusively | Continue existing S2 checkout/session; remote activity unknown | [Card](kb/tasks/S2-simulation-catalog.md): bounded read-only list and one index; commit/push and independent audit. Last fetched 1154972 has no implementation |

## In progress

Slots: 3 of 3 counted (friend S2 reserved + L0 + E0). Lead coordinates only, no coding. No UI writer active.

| ID | Owner | Branch / worktree | Next action | Acceptance evidence |
| --- | --- | --- | --- | --- |
| L0 contracts | Repair 9f6f677 done; Codex re-audit running | L0-learning-contracts / ../domino-L0 | Await re-audit | 335 contracts tests, typecheck, biome pass (worker-reported) |
| E0 data custody | Claude worker, repair round 2 running | E0-evaluation-custody / ../domino-E0 | Codex REJECTED 217bd44 too ([re-audit](kb/reviews/E0-217bd44-codex-reaudit.md)): missing-acceptance substitution, incomplete historical read log, thin self-check. Last round before escalation | Accession pinning, instants, strict boundary fixed; 16/16 still claimed |

## Review

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| C2 credential/input setup evidence | Claude lead assigns verifier; no live call yet | Existing dedicated evidence app and user-reported setup | Verify `prompt` remote input versus adapter `inputs.prompt`, authorized app binding and secret presence without exposing values; full isolation remains a separate gate |

## Blocked

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
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
| RQ6 continuous chat steering / U1 | Claude lead; Codex records incoming requests | Read [U1](kb/coordination/historical/user-inbox.md) at next task boundary | QUEUED, acknowledgment pending. User can send follow-ups here; preserve current repairs and triage changes without a competing dispatcher |
| New request | Claude lead | Add task ID and check ownership | Record exact request here, then move to Ready/In progress/Review/Blocked with evidence |
