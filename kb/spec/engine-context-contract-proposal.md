# C1: Engine context contract proposal
Status: prepared at f80401d on contract-engine-context for Jayden and Micah review. Independent review and 103-test workspace check passed. Not merged; no production or seeded data is changed.
Scope: optional payload fields, new Zod context schemas, optional trailing Engine arguments, fixtures and contract tests. Claude continues E3a repairs on its existing branch.
Decision: use explicit record relationships and calculation context rather than infer them from names or matching amounts. Counterargument: one-to-one invoice linkage does not cover split billing; reject that unsupported case in v1 rather than silently approximate it.

## 1. Deal identity and invoice linkage
- Add Deal.invoiceId?: Id | null and Deal.kind?: "new_business" | "renewal" | "expansion".
- invoiceId missing means unknown legacy mapping; null explicitly means not invoiced; a string identifies the full invoice for that deal. A linked invoice may already be paid: the deal must still never add a second receipt.
- Snapshot validation rejects an explicit dangling link, duplicate invoice ID for a linked target, customer mismatch, amount mismatch, or two deals claiming one invoice. Null/omitted fields remain valid legacy inputs.
- Link deal_acme_renewal to inv_acme_2027 and mark it renewal. Mark deal_nw_expansion as expansion and explicitly uninvoiced; do not link its $120K to the unrelated $250K invoice.
- Preserve stable Northwind branch/risk IDs and illustrative cash paths, but relabel their supposed non-renewal as a hypothetical invoice-loss scenario. Its evidence references inv_nw_q4 with an assumption note; the unsigned expansion must not be used as proof of losing that invoice.
- E3b must replace the temporary ambiguous-match guard with these rules: linked deals add no cash; explicitly uninvoiced signed won deals add cash once; unknown mappings never guess and may require review.
- E4 must not infer renewals from customer IDs or amounts. Missing kind is unknown. Unsupported renewal/churn signals are omitted, not manufactured.

## 2. Constraint targets and consequences
- Add Constraint.billId?: Id, meaningful only for pay_by_date. Reject billId on other kinds. Legacy pay_by_date without billId parses, but execution must refuse to claim the rule was evaluated.
- Keep existing limit semantics: cents for min_cash, allowed late days after the original bill due date for pay_by_date, months for min_runway_months. Do not rename fields. pay_by_date limit must be a nonnegative integer.
- Add optional consequence: { label: nonempty string, evidence: Evidence }, with its own exported Zod schema/inferred type. Only emit that consequence when its rule breaks and its supplied evidence supports it.
- E3b/E4 must resolve billId to an actual bill in the snapshot; missing targets fail evaluation. Use the original bill deadline plus limit even when a scenario delays payment.
- Weekly closing cash cannot prove ability to pay on a specific date. Engine replays its internal daily cash schedule from snapshot, model and changes. Use the same daily check in dominoes and stressTest. Same-day inflows precede outflows as an explicit demo convention.
- Runway uses the 13-week forecast's net outflow divided by three months; nonpositive net burn means no runway breach. Compare by exact integer/rational arithmetic rather than introduce floating money.
- Existing forecast/week contracts stay unchanged. These are execution rules for E3b/E4, not an engine implementation in C1.

## 3. Context for dominoes and branch scoring
- Export DominoContextSchema = { model: CompanyModelSchema, changes: ChangeSchema[], baseline?: ForecastSchema }, and infer DominoContext from it.
- Extend Engine.dominoes with optional fourth argument context?: DominoContext. changes contains the complete ordered scenario, including ancestor and current changes exactly once. baseline, when supplied, is the counterfactual forecast used for comparison.
- Without context, legacy callers may evaluate directly supported weekly min_cash rules only. They must not invent delayed-invoice causes, daily deadlines or causal links. Refuse rules requiring absent context.
- Export FixScoreContextSchema = { ancestorChanges: ChangeSchema[] }, and infer its type.
- Extend Engine.scoreFix with optional sixth argument context?: FixScoreContext. ancestorChanges excludes parent.changes and fix.changes, in root-to-parent order. Effective changes = ancestorChanges + parent.changes + fix.changes.
- An omitted context is valid only for a root parent (parentId=null). Non-root scoring must receive explicit ancestry, even [] for a base ancestor with no changes. Wiring loads the chain and rejects missing parents/cycles.
- Keep scoreFix returning Branch and Branch.changes relative. Utility is computed from low-point gain; filtering/ranking is an engine-local helper. Do not encode usefulness as human approval status or add a required Engine method just to sort.

## 4. Explicit risk and fix targeting
- Add Branch.riskIds?: Id[] for the cumulative known risk IDs affecting that branch, and FixCandidate.targetRiskIds?: Id[]. Both arrays reject duplicates.
- Missing means unknown legacy context. Branch [] means base/no risks. Fix target [] is an explicitly global fix; a nonempty list applies to universes containing at least one listed risk.
- stressTest must reject an untargeted legacy fix or unknown target ID rather than apply it everywhere. Apply each applicable fix once, in given order. Engine validates referenced change targets too.
- Populate fixture base/event/fix branch riskIds and both Acme fix targets. The fixture helper should honor target metadata rather than hardcode an Acme test. Keep existing illustrative cash paths; do not claim calibrated effects.
- Agents.proposeFixes already receives Branch, so riskIds supplies canonical context without changing its signature. Wiring validates proposed target IDs against known risks and assigns authoritative branch targets if a legacy provider omits them. Never guess from labels.

## 5. Compatibility, persistence and honest scores
- Optional arguments and fields preserve existing callers and old payloads. Zod round trips must preserve new fields and still parse valid old objects.
- Convex snapshots, constraints, fixes and branches store data as v.any(); no table validator migration is needed. Existing query parsers automatically use the new shared schemas after deployment.
- Fixture seed is create-once. Rerunning it will not backfill old records. After approval, add a separate narrowly scoped, idempotent data update that preserves approvals and logs, or create a separate demo company. No reset or reseed is performed by C1.
- Update all readers before writing the new fields: old Zod readers may strip them on parse-and-rewrite.
- Survived-count fraction and probability-weighted scenario score remain separate. Existing survivalRate is a weighted scenario index over overlapping named futures, not a calibrated probability that the company survives. Counts and percentages must be computed, not fixed at 7/11 or 93%.
- Old hard-coded fixture forecasts remain illustrative. C1 changes data meaning and context, not arithmetic results or engine behavior. The raw Kestrel forecast will still throw on Claude's old guard until E3b adopts the new link.

## 6. Verification and rollout
- Contract tests cover old-field omission, explicit null, retained metadata, bad links/duplicates, constraint field validity, context schemas and optional Engine signature compatibility.
- Run focused contracts tests and full pnpm check including web/Convex, simulator and router. Existing malformed-deal fixture tests may need a contract-valid deliberate ambiguous copy in future E3b, not changes to Claude's current worktree.
- Review C1 independently. Both owners review before merging the shared contract branch, per skills/contract-change/SKILL.md.
- After approval: merge C1; then re-review/merge Claude's E3a repairs; E3b adopts invoice linkage and context, followed by E4 using common rule evaluation and explicit targets. E5/E7 later supplies contexts from Convex.
- Do not touch Claude's branch, seed live data, deploy, push, create paid calls, or send team messages during this preparation.
