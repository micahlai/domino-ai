# Manual Claude queue

These are prepared assignments, not launched workers. Read kb/spec/learning-loop-design-2026-10-24.md for ownership and gates. Claude implements; Codex audits and integrates preview only. Main is untouched. Keep monitor paused. Verify actual workers before every launch, counting friend and children; at most three implementation processes, one UI writer, no nested agents for these cards.

1. Friend continues S2 only: S2-friend-catalog.md. Local continues S3 repair in its existing worktree: S3-local-repair.md. Preserve ownership and uncommitted work.
2. L0-learning-contracts.md and E0-sealed-evaluation.md are ready manual prompts as slots permit. Do not run friend + S3 + L0 + E0 together.
3. After accepted interfaces, use kb/tasks/L1-source-normalization.md, then L2-source-reconciliation.md, then L3-scoped-rules.md as the bounded Claude prompt with the common rules below. No sealed test reads. Codex audits each before the next.
4. L5-knowledge-runtime.md requires reviewed exact additive backend schema first. E1-quarter-evaluator.md is independent after accepted interfaces, without test release.
5. S4-durable-scenarios.md and U2-required-journey.md are prepared but BLOCKED prompts. Never launch them from this queue until Codex records accepted prerequisites and exact file/API ownership. C2 still needs platform isolation verification and a separate exact implementation card.

Common worker rules: use a dedicated task branch/worktree from the latest accepted preview; reuse an existing task checkout/session, never reset/stash/rebase/overwrite. Read AGENTS/HANDOFF, repository orchestrator, installed ponytail and the card/linked specs before editing. You are not alone; preserve other writers' work. Change only the card's folder and own Result. No env/secrets, provider calls, package installs, account changes, database resets, shared-runtime deployment, main/preview merges or implementation children. Run Node24 focused tests/typecheck/lint, record exact commands/results/limits, commit your task branch and stop for independent audit. Codex serializes full checks/build/browser.
