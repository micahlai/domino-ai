# TL2U-R1: accept supported fractions and state rule scope precisely

- **Goal:** supported fractional runway/model data reopens safely; chart/rule wording does not imply unproved safety or individual causality.
- **Folder:** apps/web/components/timeline/workspace ONLY, plus Result in this card.
- **Contracts used:** same UI card; exact local JSON validation with targeted safe integer money fields.
- **Done when:** tests accept 4.5-month rules/proposals and fractional model delays/discount percentages, reject fractional/unsafe cents and unknown nested fields; pnpm check passes.
- **Notes:** read /tmp/tl5-audit/review.md blocker2. exactBoundarySchema forbids all fractional numbers and is inappropriate for this local projection: retain canonical input-vs-parse equality but allow shared-supported finite fractions, enforce bounded safe cents/monetary delta fields explicitly. Do not change shared seam schemas. Use neutral/accent forecast color (green cannot imply survival when no/all-breached rules), reserve violation highlights for actual saved breaches; no arbitrary pink lowpoint-as-breach. Rule clear means 'No breach found in these 13 weeks', not broad compliance. Baseline scheduled annotations must be plainly labelled original/imported schedule if they do not move with scenario changes. Action labels accompanying a breach are the full scenario/group inputs, never each action individually blamed. Keep existing API/route. Update Result/commit on TL2-timeline-screen. No services/env/main/push/delegation.

## Result
- Done:
- What changed:
- Watch out:
