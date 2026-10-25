# TL7U-R1: align real analysis rule receipts

- **Goal:** valid analyses with rules render, while per-rule proof is validated against the selected source run.
- **Folder:** apps/web/components/timeline/analysis ONLY plus this Result.
- **Contracts used:** actual TL7 AnalysisReceipt, source WorkspaceRun/RuleReceipt; shared schemas unchanged.
- **Done when:** source has distinct set-level constraintVersion and individual receipt.constraintVersion; actual-shaped risk/response reads ready; changed/missing rule versions reject. Align evidence cap100 with backend; focused tests/typecheck/lint pass; commit.
- **Notes:** current api.ts compares every individual receipt.constraintVersion to analysis set version, always rejecting real rule-bearing output. Remove that comparison; validate per-rule against source run.receipts by constraintId in readAnalysis/readAnalyses. Align other strict limits with actual backend schema. No runtime/shared/backend/TL5 changes. Root integrates TL7 only.

## Result
- Done: repaired real rule-bearing analysis reads; focused30 tests, web typecheck, scoped lint and git diff --check pass.
- What changed: full-set constraintVersion still pins the selected source run, while every risk/response proof now matches the source receipt by constraintId, individual version, kind and limit. Missing/extra/changed rule proof rejects. Updated playground/test fixtures to carry distinct set and individual hashes, and aligned evidence100, changes1..8, text2000, warnings30 and scenario-count1..8 limits with backend9e87c77. Logs: /tmp/TL7-ui-r1-tests.log, /tmp/TL7-ui-r1-typecheck.log and /tmp/TL7-ui-r1-lint.log.
- Watch out: lead still owns live browser verification/integration on TL7. No runtime/backend/shared/TL5 edits.

- Phone taste follow-up: risk failure explanations now render as a separate block below the proof button, preventing joined button/reason text on narrow screens. Scoped lint and web typecheck pass; no other UI changes.
