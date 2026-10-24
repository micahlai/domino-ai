# E7a: Observable grading and retrospective learning
- **Goal:** Replace the two remaining pure engine placeholders with measured grading and conservative replay-gated learning.
- **Folder:** packages/engine only; exception: this card Result.
- **Contracts used:** Engine.grade/learn, GradeContext, LearnContext, CompanyModel, Snapshot, Forecast, Evidence.
- **Done when:** Hand-computed grading tests, leakage/no-evidence/tie/regression/idempotence learning tests and full pnpm check pass; no placeholder remains in engine.
- **Notes:** Read kb/spec/learning-context.md, kb/spec/grade-learn-implementation.md and skills/engine-tdd/SKILL.md. C2 must be merged first. Pure code, integer cents, exact comparisons. The spec resolves missing evidence conservatively.
- **Scope:** Implement grade/learn plus local helpers/tests. No contracts, sim, agents, web, dependencies, env or fixture-output changes.
- **Coordination:** You are not alone. No other checkout edits, subagents, external calls, board/handoff edits, pull/rebase/reset/stash/merge/push. Commit owned files and Result for independent audit. User explicitly authorized direct Claude implementation.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
