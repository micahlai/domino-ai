# TL3Q-R1: preserve prompt meaning and explain effective cash movements

- **Goal:** core why-week question answers actual saved-context movements; no altered amounts/rules or double-counted existing bills.
- **Folder:** apps/web/convex/timeline (same questions-only whitelist; Result in this card).
- **Contracts used:** same TL3Q types; read-only engine cashSchedule allowed for deterministic evidence, no shared edits.
- **Done when:** original tests plus independently reproduced grammar/combined probes pass; exact meanings preserved or clarified; pnpm check/Convex typecheck pass; full Result and commit.
- **Notes:** read /tmp/tl5-audit/review.md. Fix why-week/item routing ahead of generic domino why; explain relevant effective schedule records (including ancestor changes/model timing), cite saved totals and actual record refs, do not present original scheduled annotations as scenario receipts. Reject numeric suffix/partial matches: 4.5 months must stay4.5 or clarify, 1.5 days cannot become5, malformed $80,00 and -$80 cannot become positive80. Conservative grammar/semantic guards must preserve negation, reject cash UPPER bounds ('keep usable cash below $3M') rather than flip to minimum; ambiguous bare cash basis clarifies. Existing bill/invoice rescheduling cannot become a second cash event (e.g 'pay $45,000 to Northlight Marketing for the existing bill on Nov20'); clarify unsupported wording. Generated intents pass same semantic guard. Scope question/rule/operation domain IDs by company+request, not request alone. Bound UTF8 provider receive bytes while streaming, reject redirects with credential header, retain abort and strict output/refusal/truncation handling. Keep method/status visible, same frozen interface and failure receipts; no real provider/env/service calls (lead verifies). Do not delegate. Commit on TL3-questions.

## Result
- Done:
- What changed:
- Watch out:
