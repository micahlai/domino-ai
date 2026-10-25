# Required learning loop: bounded implementation design

Status: lead design, not implemented. Authority: [required gates](required-learning-loop-2026-10-24.md). Preview only. Human launches Claude; Codex audits/integrates. Preserve all accepted UI, data and runtimes.

Latest routing: Jayden launches ONE Claude lead; it owns queue/worker dispatch. Codex is independent audit/integration support on request. [Control rules](../coordination/historical/claude-lead-control.md) and root ROADMAP.md supersede older per-worker human-launch wording. No implementation launched by Codex; monitor stays PAUSED.

## Call and supported boundary

Support authorized local uploads of SEC companyfacts JSON plus submissions JSON and accession acceptance metadata. One company per package, consolidated standard US-GAAP cash facts, USD, calendar quarters, 10-Q/10-K and separately versioned amendments. No arbitrary PDF extraction, custom taxonomy, segment facts, FX conversion or private connectors in this boundary. Unknown currency, tag, scale, acceptance instant, scope or calendar produces a question/block. A missing value is not zero.

This is automatic onboarding within one real source format: identify company/schema, propose standard tag mappings, validate actual periods/units, normalize exact cents, preserve raw pointers/hashes, resolve roles and construct engine inputs without adding company-specific code. An upload is authorized access, not a claim of an arbitrary live integration. The SEC provides companyfacts/submissions JSON and describes companyfacts as standard-taxonomy, entity-wide facts: [official API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). Fetching the full latest companyfacts response is NOT a historical snapshot. Filter each record by its accession's verified acceptance instant before it enters the company context. Never use frames' latest-filed selection for replay.

Call: this small boundary can cover all L1-L4 behaviors while reusing existing historical contracts. Counterargument: operational SaaS onboarding is broader. Do not claim bank/CRM/billing ingestion from this work.

## Reuse assessment, checked at 2da5c08

| Existing code | Reuse | Limit |
| --- | --- | --- |
| contracts/historical.ts | Source hashes, reported/derived facts, dates, closure, run/comparison validation | Needs mapping/reconciliation/rule receipts and generic company snapshot envelope |
| engine/period.ts, money.ts, dates.ts | Exact cents, quarter bridge, comparison and cost math | Calendar-quarter assumptions; no generic ingestion or held-out evaluator |
| agents/prompts.ts mapSource, semantics.ts, extract.ts | Boundary validation and proposal patterns | Canonical entities are operational invoices/bank records; do not coerce quarterly facts into them |
| engine/learn.ts, grade.ts; contracts/learning.ts | Version/evidence patterns and honest replay caveat | Uses bank windows, invoices and percentage error; not public quarterly proof |
| convex/historical.ts | Frozen snapshots, hash checks, append-only runs, separate reveal | CASE/ROLES/CUTOFF are 2U constants; generic onboarding needs an additive path |
| convex/investigation.ts | Request receipts, transactional operations, remote-run identity, statuses | Fixed scheduler; does not establish real CREAO coordination |
| convex/connect.ts | Preserve existing scheduled API | Throws `not built`; no reusable working connector/tie-out found on preview |
| sources schema/mappings and parked mock work | Existing legacy interfaces only | Empty mappings and pending tie-out are not reconciliation; parked E2a has known blockers |
| data/historical/2u | Regression/UI evidence | Exposed retrospective case, never untouched improvement proof |

Paths above are relative to packages/ unless prefixed convex/ (apps/web/convex/). No feature implementation accepted by this assessment.

## Shared contract to freeze first (L0)

Add a contracts-only module, keeping HistoricalRun.branch and existing operational types unchanged. Names below are proposed new APIs, not existing exports.

- SourcePackage: company identity (CIK), schema version, raw content SHA-256, original URL, retrieved timestamp, accession -> verified acceptance instant/form/period. Preserve raw decimal lexemes; do not multiply an already-rounded JS number into cents. SEC USD values are base dollars, not filing table thousands. Reject unsafe/non-integral cents.
- MappingReceipt: source hash, JSON pointer/tag/unit, metric/definition, transform from a finite allowlist, status proposed/validated/rejected/needs_input, mapper version and validation errors. No generated code execution. SEC standard tag dictionary is global and versioned, never a company-name switch.
- ObservationKey: company + consolidated scope + metric definition + currency + exact instant/duration. Raw record identity also includes accession, tag, unit and pointer. Separate accounting period, publication time and retrieval time.
- ReconciliationReceipt: candidate record IDs, classification, selected IDs or blocked reason, authority rule/version, actor, rationale, source dates and decision recordedAt. All candidates survive. Preserve HistoricalFact.availableAt's existing invariant: derived facts use exactly the latest source-fact input availability. A separate receipt/role eligibleAt gates human/learned decisions by max(source availability, decision recordedAt, effectiveFrom); snapshot validation and engine-input construction must check it against cutoff. Never encode a human decision as a fake source fact. Deterministic experimental parsing/deduplication/original-accession selection has a separately sealed method version and computedAt, with source-derived availableAt. It never impersonates historical feedback; unresolved manual conflicts still block evaluation.
- CompanyKnowledgeSnapshot: company identity, cutoff, source/mapping/resolution/rule version IDs, HistoricalCase-compatible facts/assumptions, validated quarter roles, blocked roles, completeness and canonical content hash. No invented fact/risk/assumption to complete the shape.
- FeedbackRecord and LearnedRuleVersion: raw suggestion separate from accepted rule; company/schema/source-signature scope, finite action (mapping override, authority preference or model method selection), rationale/evidence, recordedAt/effectiveFrom, supersedes/revokes, validator version, accepted/rejected/revoked status. Rule actions never contain executable code or unvalidated money. Explicit global rules require a separate user choice; default scope is one company.
- EvaluationProtocol/Seal/Report: see [frozen recipe](forecast-evaluation-protocol-v1.md). Test labels are evaluator-only. Protocol, dataset, source, candidate, rules and evaluator hashes are separate identities.

## L1 ingestion and L2 reconciliation

Pure normalization lives in engine, with no network/clock/AI. Backend stores upload metadata/blob references and durable operations in the SAME Convex database. Use the existing sources table for linked source status where compatible; new versioned knowledge/feedback documents are allowed for distinct new entities, not a duplicate simulation store. The exact additive backend schema must be reviewed before that worker edits schema.ts. Do not deploy a candidate to preserved 3210/3214 during worker checks.

Dictionary proposals cover cash/equivalents, restricted/combined cash and operating/investing/financing/FX flows only. The L0 card freezes actual supported tags from development inputs. Reject ambiguous total-versus-current restricted cash. Sum components only with explicit compatible scope and full component coverage. Fiscal calendar must be evidenced, not inferred from a frame label.

Compare candidates only after the ObservationKey matches. Agreement across different sources is corroboration; same raw identity/content is a duplicate. Distinct dates are timing differences; total/usable, consolidated/segment, YTD/quarter are definition/period differences. A new amendment is a separate dated source. Conflicting eligible same-key values block dependent roles unless an explicit applicable authority policy or accepted user resolution selects one. Never silently average, use majority vote or prefer a later retrieval. Byte-identical payloads from two URLs are one evidence origin, not independent votes.

Cash identity: beginning combined cash + OCF + ICF + FCF + FX = ending combined cash, same period/scope. Record disclosed rounding precision and permit only its explicit arithmetic bound; otherwise require exact cents. YTD subtraction needs matching starts, scope, currency and compatible definitions. A derived fact keeps both IDs and latest source-fact availability; any later human decision stays a separate receipt eligibility gate. A blocked irrelevant field does not block unrelated calculations; an unresolved used role does.

Acceptance: agreeing, duplicate, timing-only, definition-only, rounding-only, genuine conflict, amendment-after-cutoff, missing unit, unsafe money and incompatible-YTD fixtures. Synthetic disagreements are visibly labelled. A real second-company package must reach snapshot -> engine without source-specific code edits after mapping code freeze. Correct expected monetary values must be independently audited against source rows, not calculated by the same implementation under test.

Reserve exposed Freshworks 2023Q3 original source package for L1 acceptance and L3 unrelated-company scope tests, subject to E0 coverage verification. Develop mappings on Amplitude only, freeze normalizer/dictionary commit before releasing the Freshworks acceptance package to that worker, then report success/failure without silently patching company exceptions. Freshworks is withheld from mapping development, not claimed unseen to the wider team or a forecast test. Do not consume Tenable/Varonis test inputs for product demos before E2.

## L3 behavior and time

An accepted rule changes a later eligible import/reconciliation or forecast method, with a receipt showing previous/new version, reason and affected fields. Rejection changes nothing. Revocation creates a new record; rollback selects the preceding version for NEW work and never edits an old snapshot. Scope tests use another company with the same tag/header. Conflicting equally applicable rules block, rather than depend on iteration order.

Eligibility requires accepted + matching company/schema/source signature + recordedAt and effectiveFrom no later than the task knowledge cutoff. No backdating today's feedback into 2023. For a visible live learning demo use a present-time task and a later present-time import; the historical 2U run remains frozen. Synthetic time tests are labelled tests.

The retrospective L4 experiment may choose a new deterministic model method today, using development data only. This is explicitly a retrospective experimental method, not a claim that a human correction existed at its historical forecast origin. Source facts at every origin remain cutoff-safe. Do not fabricate historical LearnedRuleVersion timestamps to make these paths appear equivalent.

## Ordered owners and launch gates

| Order | Card | Exclusive scope | Launch state |
| --- | --- | --- | --- |
| Now | Existing S2 friend / S3 repair | Friend catalog/index; local scenario engine | Human may continue existing owners; no duplicate |
| 1 | L0-learning-contracts | packages/contracts only | Prepared for human launch |
| 1, independent | E0-evaluation-custody | data/evaluation only | Prepared for human launch; no test values returned to lead/model worker |
| 2 | L1-source-normalization | packages/engine onboarding files | Wait accepted L0 and development package |
| 3 | L2-source-reconciliation | packages/engine reconciliation files | Wait accepted L1 |
| 4 | L3-scoped-rules | packages/engine rule and candidate-method files | Wait accepted L2; never edit S3-owned files |
| 5 | L5-knowledge-runtime | apps/web/convex only | Wait accepted L0-L3 and S2 schema release; reviewed additive schema first |
| 5, independent | E1-quarter-evaluator | packages/sim/eval only | Wait accepted L0 and E0 development interface; no sealed labels |
| 6 | S4 durable scenarios | apps/web/convex only | SERIAL after L5, accepted S2/S3 and persistence-design review |
| 7 | U2 visible workflow | apps/web frontend only | One UI writer; accepted L5/S4/E1 APIs |
| 8 | C2 coordinator follow-on | Exact scope still gated | Platform isolation verified, then bounded allowlist contract/card |
| 9 | E2 final evaluation + browser acceptance | Codex-led audit and evaluator-only label release | Dataset/protocol/candidate seals first; no tuning after opening |

At most three implementation processes including friend/children. Do not launch every prepared card. L0 + E0 + friend already fills the cap. All full checks/build/browser are serialized by Codex. Worker prompts forbid nested workers. No main merge or monitor resume.

## Completion

Onboard unseen supported source -> inspect mapping and real gaps -> reconcile with lineage -> investigate/forecast -> separate reveal -> accept/reject feedback -> apply eligible version to new work -> sealed error comparison -> costed Event/Response -> reopen without dispatch. Reuse grouped canvas, Company inspector, financial chart and existing conversation/operation records. Each node reflects a recorded operation. All four L gates and actual CREAO isolation/coordinator remain required; a negative L4 result leaves L4 incomplete.
