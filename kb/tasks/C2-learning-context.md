# C2: Explicit grading and replay observations
- **Goal:** Make grading and retrospective learning possible without guessing missing dates or origin records.
- **Folder:** packages/contracts only; exception: this card Result.
- **Contracts used:** Engine.grade/learn, Forecast, Snapshot, BankTxn and new GradeContext/LearnContext schemas.
- **Done when:** Optional trailing contexts compile for legacy/current callers; schemas validate real dates, cutoff order, complete bank-window assertion and unique observable origins; full pnpm check passes.
- **Notes:** Read kb/spec/learning-context.md, skills/contract-change/SKILL.md and current modules/core schemas. No behavior implementation or existing Snapshot/Forecast shape changes.
- **Scope:** Add exported Zod schemas/inferred types and optional Engine parameters, focused contracts tests. No fixtures needed unless genuinely relevant.
- **Launch:** Claude Opus/high in ../domino-C2, C2-learning-context; direct backend-completion authorization, 30-minute checkpoint.
- **Coordination:** You are not alone. No engine/web/agent/dependencies/env/other checkout/board/handoffs, pull/rebase/reset/stash/merge/push, external messages or subagents. Commit owned files and Result for independent audit.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
