# TL5R: independent core acceptance audit

- **Goal:** find blocking correctness or boundary failures in TL1C–TL4 before TL5 acceptance.
- **Folder:** read-only audit of ../domino-TL2B/apps/web/convex/timeline/workspace*, ../domino-TL3Q/apps/web/convex/timeline/questions*, then combined ../domino-timeline. Scratch probes ONLY /tmp/tl5-audit; no source edits/commits.
- **Contracts used:** WeeklySeedV1, Change, Constraint, Forecast, OperationSummaryV1, WeeklyResultRefV1; read engine evaluator semantics.
- **Done when:** independently report concrete blockers (file/line/repro), or acceptance with test evidence, after checking immutable rules, attribution, nested effects once, wrong-company targets, unsafe aggregates/date bounds, idempotence, provider output failure, and exact saved proposals/links.
- **Notes:** read kb/features/timeline/TL2-TL5-interface.md, AGENTS and review skill. Claude workers implement; you audit only, do not spawn workers or alter running worktrees. First review backend as it appears; question audit follows after it lands. No secrets/provider/runtime configuration. Tell lead promptly about blockers. No shared-main/peer changes.

## Result
- Done:
- What changed (files): none; read-only/scratch audit.
- Watch out:
