# G3 repair1: durable retries and pre-reveal alternative output

- **Goal:** close the two independent audit blockers on5d244d8 while preserving G4 spatial presentation.
- **Owner:** next sole UI phase in domino-G3, only apps/web/components/investigate/live/** and this Result. Start only after current G4 process finishes and its checkpoint is recorded. No concurrent UI writer.
- **Retry defect:** session.ts150-156 unconditionally clears a scope on stale completion. A starts, user leaves, B starts with different question and its response is lost, then A settles; A deletes B's saved key and retry duplicates B. Compare-and-clear the exact requestId on success AND definite rejection; preserve a newer intent. Reproducer /tmp/domino-g3-retry-audit.cjs.
- **Alternative defect:** FinancialOutput.tsx58-64 hides valid saved projection/costs/assumptions until reveal, though API allows an alternative first. Render saved alternative and baseline with existing chart primitives before reveal, exclude observed outcomes, preserve explicit costs/assumptions and post-hoc warning. No money math or duplicated renderer framework.
- **Integration note:** preserve G4 graph/primitives, backend authority and owned-run routes. G2d may add optional instructionsScope/remote identity metadata; do not mislabel per-run supplied rules as the entire remote system prompt. Account key remains unused.
- **Acceptance:** independent interleaving tests for stale success/rejection after newer pending intent, same-request successful cleanup, uncertain retry/reload; alternative-before-reveal shows saved forecast and costs but no future observed values; revealed path unchanged. Focused typecheck/lint/tests only; Codex owns fullcheck/build/browser.
- **Skills:** /orchestrator /ponytail full, taste, ui-ux-pro-max. One Sonnet/high process, nochildren,45mincheckpoint. No provider calls, secrets, backend/contracts/packages/global styles, fullsuite/build/server/browser/push/merge/sharednotes. Commit locally and stop. Other workers are present, preserve their edits.

## Result
- Pending, not dispatched until G4 checkpoint.
