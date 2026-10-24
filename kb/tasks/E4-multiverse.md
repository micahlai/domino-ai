# E4: Computed futures, fix scoring and history
- **Goal:** Produce real ResilienceReport, scored fix branches and historical cash for the hero visual.
- **Folder:** `packages/engine/` only; exception: this card's Result in the worker checkout.
- **Contracts used:** Engine.scanRisks/scoreFix/history/pastEvents/stressTest, RiskEvent, FixCandidate.targetRiskIds, Branch.riskIds, FixScoreContext, ResilienceReport.
- **Depends on:** E3b independently reviewed, merged and full checks passing; never run concurrently with another engine writer.
- **Done when:** risks.test.ts, score-fix.test.ts, history.test.ts and stress-test.test.ts cover the E4 acceptance cases in the implementation brief; outputs parse their schemas; full `pnpm check` passes.
- **Notes:** Read `kb/spec/engine-e3b-e4-implementation.md`, C1, build-spec sections 6.3/6.4/6.6 and skills/engine-tdd/SKILL.md. Use small hand-computed cases plus C1 Kestrel fixtures, never hard-coded demo scores.
- **Launch:** Human launches Claude Code in ../domino-E4 on E4-multiverse after the gate; branch/worktree not created yet. Independent Codex GPT-6 Astra review before integration.
- **Scope:** Reuse E3b rules and exact money helpers; rankFixes stays an engine-local export. No grade/learn, UI, agent adapters, contracts, dependencies, persisted data or network calls.
- **Coordination:** You are not alone. Preserve others' work; only own Result notes, no main/board/handoffs/merge/push/rebase. Checkpoint at 45 minutes; stop and request a scoped split at 90 minutes rather than claim partial E4 complete.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
