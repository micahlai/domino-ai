# Domino roadmap and request inbox

One user-launched Claude lead owns this queue and dispatch. Codex provides independent audit/integration support on request. [Control rules](kb/coordination/historical/claude-lead-control.md) supersede older per-worker manual-launch routing. Main untouched, monitor PAUSED, at most three implementation processes including friend/children, one UI writer.

Required design: [learning loop](kb/spec/learning-loop-design-2026-10-24.md), [evaluation recipe](kb/spec/forecast-evaluation-protocol-v1.md), [S4 persistence](kb/spec/scenario-persistence-v1.md). Cards contain exact scope; this file records status. All four L gates and real CREAO coordination remain required.

## Done

| ID | Owner | Dependency | Acceptance / evidence |
| --- | --- | --- | --- |
| G6/G7/G8a/G8/S1/U1 | Prior workers; Codex audit | Prior gates | Accepted grouped map, frozen knowledge, scenario contracts, early product UI; feature checkpoint 0f87ed2, prior 1,185 tests/build/browser |
| D0 required-loop design | Codex; independent design auditor | Latest user scope | Reuse inventory, supported SEC JSON boundary, exact S4 and evaluation recipe reviewed; 1fce04a. Data/candidate seals and improvement are not done |

## Ready

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| C0 queue takeover | Claude lead, user launches once | Read HANDOFF and control rules; verify slots | Own queue, confirm existing writers, choose bounded tasks; no duplicate supervisor |
| L0 contracts | Lead-assigned Claude worker | C0 ownership and free slot | [Card](kb/tasks/L0-learning-contracts.md): additive schemas/tests, preserve old contracts; independent audit |
| E0 data custody | Separate lead-assigned worker | C0 ownership and free slot | [Card](kb/tasks/E0-evaluation-custody.md): development package, coverage/exposure ledger and real hashes; no test-value release |
| S2 catalog, reserved | Friend exclusively | Continue existing S2 checkout/session; remote activity unknown | [Card](kb/tasks/S2-simulation-catalog.md): bounded read-only list and one index; commit/push and independent audit. Last fetched 1154972 has no implementation |

## In progress

No implementation worker is independently confirmed active in this checkpoint. Friend's remote activity is unknown; S2 remains reserved in Ready. Claude lead must inspect actual processes/branches before filling this section; do not infer progress from a reserved card.

## Review

| ID | Owner | Dependency | Acceptance |
| --- | --- | --- | --- |
| S3 repair 5ecae8a | Claude lead requests integration; Codex audit complete | Finished Claude repair; clean domino-S3 | [Audit passes](kb/reviews/S3-repair-5ecae8a-audit.md): 54 focused tests, 14 independent probes, full 1,208-test/typecheck/lint check. Scoped code approved, NOT integrated; preserve S4 persistence/protocol gates |
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
| RQ3 Claude repair is done | Codex bounded audit complete; Claude lead next | S3 commit 5ecae8a | Independent audit passes; full 1,208-test check. Pending preview integration, no repair redispatch |
| RQ4 CREAO setup says done | Lead-assigned verifier | User-reported empty memory/data access and input/key steps | Verify remote `prompt` and backend config; no isolation/provider-success claim yet |
| New request | Claude lead | Add task ID and check ownership | Record exact request here, then move to Ready/In progress/Review/Blocked with evidence |
