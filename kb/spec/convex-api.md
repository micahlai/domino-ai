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
| `sources` | `companyId`, `kind` (SourceKind), `baseUrl`, `mappings` (FieldMapping[]), `lastPull`, `tieOut` ("ok" \| "needs_review" \| "pending"), `step` (text shown on connect screen) | `by_company` |
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
