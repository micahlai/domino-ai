# TL1C–TL5 local implementation interface

Checkpoint: TL5-checkpoint, based on accepted TL1 0b06882. User authorizes parallel delivery through TL5. No main/lane-main merge. This is a Timeline-local API, not a shared contract change. Existing baseline API remains unchanged. Money is integer cents. All company identities are the weekly seed's string id; this is a local demo boundary, not production authentication.

## Backend functions (timeline/workspace)

- `open` mutation `{companyId, baselineRunId, requestId}` -> `{companyId,runId,created}`. Creates/reuses an immutable workspace root from a saved TL1 baseline.
- `reviseConstraints` mutation `{companyId,parentRunId,requestId,constraintsJson,note,reviewed}` -> same result. Full replacement of Timeline-local constraints, user-confirmed. Every edit/removal creates a new run; imported baseline and older nodes remain unchanged.
- `simulate` mutation `{companyId,parentRunId,requestId,label,changesJson,reviewed,constraintsJson?:string,constraintNote?:string}` -> same result. Optional confirmed rules and changes are one atomic operation. Complete ancestor changes are applied exactly once to the original snapshot/model. Maximum depth 20 / total changes 64, bounded input/text/row sizes. Historical changes must be explicitly rejected with a useful explanation in this core version; observed history is immutable. No silent ignored events outside horizon.
- `get` query `{companyId,runId}` -> `WorkspaceRun | null` below. Reads saved outputs only.
- `catalog` query `{companyId,paginationOpts:{numItems:number,cursor:string|null}}` -> `{page:CatalogEntry[],isDone:boolean,continueCursor:string}`. Bounded company-scoped pagination, newest first.
- `graph` query `{companyId,baselineRunId}` -> `CatalogEntry[]` (bounded 100, stable ordering; UI says if truncated).
- `resultRef` query `{companyId,runId}` -> `string|null`, canonical JSON parsed with `parseWeeklyResultRefJson`. Valid frozen pointer, seed identity/hash, saved run id and working route. Health optional; TL6 health/chart handoff is separate.

`WorkspaceRun` (strict local projection; all fields required except explicitly optional):
```ts
{
 runId:string; companyId:string; baselineRunId:string; parentRunId:string|null;
 kind:'baseline'|'rules'|'scenario'; label:string; savedAt:string;
 inputHash:string; methodVersion:string; constraintVersion:string; constraintNote:string;
 constraints:Constraint[]; ownChanges:Change[]; changes:Change[];
 forecast:Forecast; dominoes:Domino[]; receipts:RuleReceipt[];
 comparison:null|{parentRunId:string;weekly:{weekStart:string;usableDelta:number}[];lowPointDelta:number};
 baseline:SavedBaseline; operation:OperationSummaryV1;
}
type CatalogEntry = {
 runId:string;companyId:string;baselineRunId:string;parentRunId:string|null;
 kind:'baseline'|'rules'|'scenario';label:string;savedAt:string;
 lowPointCents:number;lowPointWeek:string;constraintVersion:string;
};
type RuleReceipt = {
 constraintId:string;constraintVersion:string;label:string;
 kind:'min_cash'|'min_runway_months'|'pay_by_date';
 status:'breached'|'clear'|'beyond_horizon'|'unable';
 relation:'new'|'pre_existing'|'resolved'|'clear'|'outside_horizon'|'unable';
 limit:number;unit:'cents'|'months'|'days';value:number|null;shortfall:number|null;
 date:string|null;weekStart:string|null;actionLabels:string[];evidence:string[];
};
```
For runway, leave value/shortfall null unless exact shared evaluator values are available; never fabricate a financial calculation. For payment receipt evidence include bill/deadline/projected funding or unpaid. Minimum cash receipts include computed usable/shortfall and Sunday evaluation date. Evaluate parent under the SAME new rules for attribution; rule-only edits do not assert an action caused a breach. No parsing engine prose. Reuse exported `evaluateRules` via read-only engine subpath; do not change shared engine/index/contracts. All UI reads are validated with Zod/shared schemas plus scope identity checks.

## Schema owner (backend worker only)

Add Timeline-owned `timelineRuns` (index company+runId, company+requestId, company+baselineRunId, company) with immutable saved node data and request binding. Avoid repeating large seed on each child. Add `timelineQuestions` columns `{companyId:string,runId:string,requestId:string,inputHash:string,status:string,data:any,startedAt:string,updatedAt:string}` and indexes `by_company_and_requestId`, `by_company_and_runId`. Questions worker alone writes these rows. No root composition/Field tables edits. Update schema composition regression expectation.

## Questions functions (timeline/questions)

- `ask` action `{companyId,runId,requestId,prompt,selectedWeek?:string,selectedItemId?:string}` -> `QuestionReceipt`. Bounded one-shot intent extraction, not an autonomous conversation agent. Inputs only from selected saved run. No recalculation until person confirms a proposal via simulate/reviseConstraints.
- `list` query `{companyId,runId}` -> `QuestionReceipt[]` bounded 100, chronological. Reload reads stored outputs. UI switches context on selecting a run; ancestry visible via graph.
- `link` mutation `{companyId,questionId,resultRunId}` -> `{linkedRunId:string}`. Validate exact company/parent, proposed changes/rules equal result, and immutable binding. UI calls after confirmed simulation, and offers recovery if linking failed.

```ts
type QuestionProposal = {label:string;changes:Change[];constraints:Constraint[]|null;constraintNote:string|null};
type QuestionReceipt = {
 id:string;companyId:string;runId:string;requestId:string;prompt:string;
 selectedWeek:string|null;selectedItemId:string|null;
 status:'running'|'answered'|'proposal'|'clarification'|'failed';answer:string;
 citations:{ref:string;label:string}[];proposal:QuestionProposal|null;
 errorCode:string|null;linkedRunId:string|null;savedAt:string;operation:OperationSummaryV1;
};
```
Persist request binding before provider call. Same request returns saved/running receipt; conflicts reject. Failed receipt is terminal; explicit retry uses a new id; abandoned running work must have a bounded failure/recovery path. Internal claim/finalize mutations never public arbitrary-output saves. Every record validated, no raw provider text/errors/secrets. Provider may extract intent/event/rules, NEVER compute money or financial narrative. Build answers/citations from saved engine outputs + actual snapshot/schedule records. Unsupported/ambiguous prompts clarify, including missing date/amount/counterparty, vague rules, daily cash floors/headcount budgets. No schema-stripped unknown output, truncation/refusal/timeout considered failure. No provider creds -> saved failure, no financial result. A bounded documented grammar may answer common requests without paid calls; identify method honestly. Optional provider adapter stays in Timeline modules with fetch and strict boundary parsing, no private agents import or new shared job type. Synthetic seed context only. Do not build custom LLM multi-turn memory/component; pin each one-shot operation to saved context.

## UI ownership

New workspace components under `components/timeline/workspace/`; route `/c/[companyId]/timeline` with `?runId=...` (or baselineRunId bootstrap), catalog under same route when no selection. Make accessible from existing BaselineLive and `/playground/timeline-seam`, preserving baseline flow. No dashboard edits. Show 26-week observed history + 13-week saved forecast, parent/baseline comparison, annotations from scheduled items as labels (never add money), select week/item, rules editor (three supported types), explicit future/late-invoice event form, saved ancestry/catalog, questions with confirmation and failure/clarification states. Plain product language; advanced JSON optional only. All calculations/financial deltas supplied by server. Responsive, accessible keyboard controls, reduced motion, no engine/provider browser imports. Same request retained across uncertain retries. Confirmation resets when input changes. Catalog/reopen perform reads only, no implicit simulate/ask.

## Acceptance and delivery

Three implementation processes maximum; separate worktrees. Workers commit only assigned files and task Result. Commit boundaries named TL1C/TL2/TL3/TL4; lead integrates on TL5-checkpoint, audits failure/isolation/overflow/idempotence, full checks/build/Convex typecheck/lane-import inventory, actual local backend and desktop/phone browser smoke. TL6+ stays out. No deployment/push/main merge is requested.
