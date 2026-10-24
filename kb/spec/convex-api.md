# Convex API contract

Owner: Micah (schema, queries, mutations). Jayden writes the actions that call the engine,
connectors and agents. Change this file BEFORE you change a function, in the same PR.

All types come from `@domino/contracts`. Store money as integer cents (`v.number()` with an
integer check in the mutation). Large objects (Snapshot, Forecast) are stored as JSON values
and parsed with the Zod schema when read in actions.

## Tables (`apps/web/convex/schema.ts`)

| Table | Fields | Indexes |
| --- | --- | --- |
| `companies` | `name`, `profile`, `currentWeek`, `today`, `status` ("connecting" \| "ready") | — |
| `sources` | `companyId`, `kind` (SourceKind), `baseUrl`, `mappings` (FieldMapping[]), `lastPull` (ISODate or null before the first pull), `tieOut` ("ok" \| "needs_review" \| "pending"), `step` (text shown on connect screen) | `by_company` |
| `snapshots` | `companyId`, `asOf`, `data` (Snapshot) | `by_company_asOf` |
| `models` | `companyId`, `version`, `data` (CompanyModel) | `by_company_version` |
| `constraints` | `companyId`, `data` (Constraint) | `by_company` |
| `risks` | `companyId`, `asOf`, `data` (RiskEvent) | `by_company` |
| `branches` | `companyId`, `branchId`, `parentId`, `kind`, `data` (Branch) | `by_company`, `by_branchId` |
| `fixes` | `companyId`, `branchId`, `data` (FixCandidate), `gain` (Cents) | `by_branch` |
| `resilience` | `companyId`, `asOf`, `withFixes` (boolean), `data` (ResilienceReport) | `by_company_withFixes` |
| `history` | `companyId`, `weeks` (HistoryWeek[]), `pastEvents` (PastEvent[]) | `by_company` |
| `approvals` | `companyId`, `fixId`, `branchId`, `decision` ("approved" \| "rejected"), `by`, `at`, `note` | `by_company` |
| `grades` | `companyId`, `week`, `errorPct`, `misses` (Evidence[]) | `by_company` |
| `explanations` | `branchId`, `inputHash`, `text` | `by_branch` |
| `log` | `companyId`, `actor` ("person" \| "engine" \| "agent:creao" \| "agent:claude" \| "connector"), `action`, `refs`, `at` | `by_company` |

## Identifier and demo rules

- `companyId` in API arguments and table relationships is the Convex `companies` document ID. `companies.create` and the fixture seed return it. Canonical fixture payloads keep their contract IDs (for example snapshot.companyId `kestrel`).
- `branchId` and `fixId` are contract IDs, globally unique in this demo. The seed keeps the fixture IDs.
- Risk lists and resilience reports use the latest `asOf`; model reads use the highest version.
- Missing singleton data returns `null`; missing collections return `[]`. Writes reject missing or unrelated records.
- `approvals.decide` takes the ID of a simulated **fix branch**, plus the candidate that produced its changes. It records the decision and updates that branch atomically; it never executes the fix.
- Approval `by` uses a verified identity when available. This demo has no sign-in UI; anonymous clicks are explicitly recorded as `demo-user (unverified)`. Company access controls belong to production hardening.
- `currentWeek` and the fixture seed start at week 0. Weeks are Monday ISO dates; `at` is an ISO timestamp.
- The seed is an internal mutation, creates Kestrel once and preserves existing decisions when rerun. Empty grades, approvals and explanations are valid until real results exist; the seed does not invent them.
- P2 internal action placeholders throw `not built`. Scheduled work remains visibly unsuccessful until Jayden implements the named action; mutations do not manufacture computed results.

## Queries (UI reads only these)

| Function | Args | Returns |
| --- | --- | --- |
| `companies.get` | `{ companyId }` | company row |
| `sources.list` | `{ companyId }` | sources rows (connect screen) |
| `resilience.get` | `{ companyId, withFixes }` | `ResilienceReport` |
| `history.get` | `{ companyId }` | `{ weeks: HistoryWeek[], pastEvents: PastEvent[] }` |
| `risks.list` | `{ companyId }` | `RiskEvent[]`, ranked |
| `branches.list` | `{ companyId }` | `Branch[]` |
| `branches.get` | `{ branchId }` | `Branch` |
| `fixes.forBranch` | `{ branchId }` | `{ fix: FixCandidate, gain: Cents }[]`, ranked |
| `constraints.list` | `{ companyId }` | `Constraint[]` |
| `explanations.forBranch` | `{ branchId }` | `string \| null` |
| `grades.list` | `{ companyId }` | grades rows, oldest first |
| `models.latest` | `{ companyId }` | `CompanyModel` |
| `approvals.list` | `{ companyId }` | approvals rows, newest first |
| `log.list` | `{ companyId, limit }` | log rows, newest first |

## Mutations (UI writes only these)

| Function | Args | Effect |
| --- | --- | --- |
| `companies.create` | `{ name, profile }` | New company, status "connecting"; schedules `connect.run` |
| `approvals.decide` | `{ fixId, branchId, decision, note? }` | Records the decision; writes log; sets branch status |
| `events.add` | `{ companyId, label, changes: Change[] }` | Validates changes with Zod; schedules `engine.addEvent` |
| `fixes.simulate` | `{ branchId, fixId }` | Schedules `engine.simulateFix` |
| `week.next` | `{ companyId }` | Schedules `week.advance` |

## Actions (Jayden)

Pending C1: [engine-context-contract-proposal.md](engine-context-contract-proposal.md) defines explicit invoice links, bill targets, branch risk IDs, fix targets and engine calculation contexts. No table-validator migration is needed. After contract approval, actions must load ordered ancestry and pass the model/changes for daily deadline checks. Existing seed records require a separate safe backfill; rerunning the create-once seed does not update them. No backfill has run.

| Function | What it does |
| --- | --- |
| `connect.run` | For each source: discover, call `agents.mapSource` (CREAO), pull, tie out, save. Then `agents.readConstraints`, then `engine.recompute`. Updates `sources.step` as it goes so the UI animates. |
| `engine.recompute` | Load snapshot, model, constraints. Run `history`, `pastEvents`, `scanRisks`, base and event branches, `dominoes`, `stressTest` with and without top fixes. Write all tables. |
| `engine.addEvent` | Build an event branch from user changes; propose and score fixes; rerun `stressTest`. |
| `engine.simulateFix` | `engine.scoreFix`; write the fix branch. |
| `agents.proposeFixes` | Claude: candidates for a branch. Engine scores them. Writes `fixes`. |
| `agents.explain` | Claude: 3-sentence explanation. Cached by input hash. |
| `week.advance` | `sim.advanceWeek`, re-seed tools, pull, `grade`, `learn`, `recompute`, then `agents.weeklyBrief` (CREAO). |

## Scheduled

- None needed for the demo. `week.advance` is triggered by the button. (Optional: a cron for a daily brief.)
