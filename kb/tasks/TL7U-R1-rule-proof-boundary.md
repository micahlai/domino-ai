# TL7U-R1: align real analysis rule receipts

- **Goal:** valid analyses with rules render, while per-rule proof is validated against the selected source run.
- **Folder:** apps/web/components/timeline/analysis ONLY plus this Result.
- **Contracts used:** actual TL7 AnalysisReceipt, source WorkspaceRun/RuleReceipt; shared schemas unchanged.
- **Done when:** source has distinct set-level constraintVersion and individual receipt.constraintVersion; actual-shaped risk/response reads ready; changed/missing rule versions reject. Align evidence cap100 with backend; focused tests/typecheck/lint pass; commit.
- **Notes:** current api.ts compares every individual receipt.constraintVersion to analysis set version, always rejecting real rule-bearing output. Remove that comparison; validate per-rule against source run.receipts by constraintId in readAnalysis/readAnalyses. Align other strict limits with actual backend schema. No runtime/shared/backend/TL5 changes. Root integrates TL7 only.

## Result
- Done:
- What changed:
- Watch out:
