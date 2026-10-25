# TL7R: independent isolated checkpoint review

- **Goal:** find correctness/boundary blockers in automatic risk/response jobs before integration acceptance.
- **Folder:** read-only ../tl7-analysis-backend/domino-ai/apps/web/convex/timeline/analysis* and eventual TL7-checkpoint; scratch /tmp/TL7-audit ONLY; this Result filled by lead.
- **Contracts used:** RiskEvent, Change, FixCandidate, Forecast, ResilienceReport, OperationSummaryV1, same frozen user rules and workspace APIs.
- **Done when:** report concrete file/line/repro blockers or acceptedstableSHA with independent tests of rules/cost/ancestry/idempotence/lease/partial/job-budget/company/money/date/quietreopen. Read review skill and TL6-TL7-interface.md.
- **Notes:** no source edits/services/env/provider/main/TL5 operations or delegation. User forbids TL5 merges. Preserve all worktrees. Author can repair; reviewer verifies stable diff. Proposed Field envelope adoption separate; baseline/rule-only scope is explicit.

## Result
- Done:
- What changed: none; read-only scratch audit.
- Watch out:
