# User-defined Timeline constraints

Status: implementation requirements added from the user's 2026-10-24 request. This is planned scope, not an implemented editor or prompt endpoint. Delivery: ROADMAP TL1C, TL2-TL5.

## User experience

1. Define a rule inside a question/event prompt, for example, "What if we spend $80,000 next month? Keep usable cash above $500,000."
2. Separate the proposed event from the proposed constraint. Show a plain-language interpretation with amount/unit, cash basis, target record where needed, and the evaluation timing. Ask for missing details. Confirm a new or changed rule before saving it; do not silently replace an existing rule with the same label.
3. Offer the same rule controls later in the timeline's Constraints panel: add, edit and remove from future simulations. Prompt and form entry share validation and evaluation.
4. Simulate the action and show rule results next to its branch and in the answer. A violation remains inspectable as a hypothetical; it does not execute any action or change an actual company record.
5. Example output format: "This expense would break your $500,000 usable-cash minimum in the week of [date]. Projected usable cash: [engine value]; shortfall: [engine value]." Every displayed amount/date comes from code, not generated arithmetic.

## First supported rules

| User intent | Existing support | Interpretation to show |
| --- | --- | --- |
| Keep usable cash above a limit | `Constraint.kind = min_cash` | Limit in integer cents; current engine checks usable cash at weekly close, not continuously each day. Clarify cash basis if prompt is ambiguous. |
| Keep at least a stated runway | `min_runway_months` | Months and the engine's defined net-burn method; disclose the supported 13-week forecast horizon. |
| Pay a specific bill by its allowed deadline | `pay_by_date` with `billId` | Resolve the actual bill; existing limit is allowed late days after its original due date. Do not silently translate a general payment policy or an unsupported earlier deadline into a different rule. |

Other rules (for example headcount caps, expense-category budgets or daily cash floors) remain explicitly unsupported until implemented through the required shared contract/engine checkpoint. Preserve the user's request for clarification; never report an unevaluated rule as passing.

## Backend requirements

- Keep rule definitions, original wording, creator/provenance, stable identity and immutable version in Timeline-owned storage. Treat these as user-defined assumptions, not verified lender clauses. An optional consequence can be recorded as a user statement; do not invent fees, accelerate debt or apply an unstated cash effect.
- Validate with the existing shared constraint schema plus strict Timeline input checks for valid units, finite supported limits, required bill target and company/run linkage. Parse provider output at the boundary. Agents extract/propose rules; engine code evaluates them.
- User-defined Timeline constraints do not write Field's `constraints` table. Keep them separate from imported sourced constraints; do not silently delete an imported lender rule. Resolve the local provenance/storage boundary in `boundary-requests.md`.
- Freeze the constraint set/version, snapshot, model and complete event ancestry in each saved calculation. Applying a later edit produces a new run/comparison. Old saved answers, rule receipts and outputs remain unchanged and reopen without recomputation.
- Evaluate both parent and proposed scenario under the same rule version. Distinguish a newly introduced breach, one that already existed, and an improved/resolved outcome. Attribute to the scenario's defined changes; do not blame an action just because a breach exists in both forecasts. Where needed, run an explicit counterfactual to substantiate a particular action's effect.
- A violation receipt identifies rule/version, scenario/action references, supported metric/unit, evaluation date/week, limit, observed projected value or payment status, and engine-derived shortfall/lateness where applicable. Include input/evidence references and the comparison run identity.
- Results distinguish violated, no violation observed within the evaluated horizon, outside horizon and unable to evaluate. Missing inputs/unsupported semantics are not compliance. Translate from the existing evaluator truthfully; add structured result access through a checkpoint if its current package exports are insufficient, rather than parse domino prose.
- Responses, fixes and automatic analysis use the same pinned rule set. Better cash alone does not imply that every constraint passes. Human approval remains separate from simulation; no execution is enabled by a passing check.

## Acceptance cases

- A prompt containing an event and a minimum-cash constraint produces two explicit proposals; confirmation saves the rule and the engine produces the same result as form entry.
- "Keep enough cash" asks for a limit and cash basis. An unresolved bill or unsupported rule explains what is missing without a false pass.
- A future expense that newly breaches the minimum names that action, rule, week, projected amount and shortfall; a baseline that already breaches is labelled as pre-existing.
- Add/edit/remove constraints later; re-evaluate into a new run; reopen the older run with its original rules/results unchanged.
- Targeted payment rules show original deadline and projected funding/payment outcome. A deadline outside the forecast is labelled outside horizon.
- Provider failure, malformed rule output, duplicate requests and cross-company targets cannot partially save a calculation or invent a receipt.
