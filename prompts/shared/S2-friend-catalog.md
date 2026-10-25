# Friend launch: S2 saved investigation catalog

## Current assignment and checkout

You own only the saved investigation catalog. This is the one parallel task for the second computer. Codex owns integration and audits; Jayden's local Claude owns S3 engine repairs. Do not take over their work or launch additional workers.

Before starting, fetch origin and inspect your branch, working tree and any existing Claude session. If S2 is already in progress, continue that checkout and preserve its edits. Do not create a second S2 writer. If you have not started, create a worktree on S2-simulation-catalog from origin/S2-simulation-catalog. This branch intentionally has the stable backend base needed for S2; do not merge preview or main into it just to get newer UI. The latest task card remains kb/tasks/S2-simulation-catalog.md.

Fresh checkout commands, only if the branch/worktree do not already exist:

```sh
git fetch origin
git worktree add ../domino-S2 -b S2-simulation-catalog origin/S2-simulation-catalog
cd ../domino-S2
claude
```

The copy of this prompt on preview/historical-overnight is the current handoff. Do not reset, rebase, stash or discard existing work to match it. Report conflicting ownership before editing.

## Claude task

Use Claude Code in a fresh isolated checkout of origin/S2-simulation-catalog. Read AGENTS.md, kb/tasks/S2-simulation-catalog.md, kb/spec/product-workspace-2026-10-24.md, skills/orchestrator/SKILL.md and the installed ponytail SKILL.md. Apply /orchestrator and /ponytail. No nested workers needed. If ponytail is unavailable, record that and apply its smallest-complete-change principle; do not install packages or stop useful scoped work.

Implement only the S2 card. You are not alone: local Claude owns contracts and the sole UI stream; preserve their work. Schema ownership is only one additive conversation index. Do not touch historicalRuns or existing branch contracts. Inspect current tests before implementation and reuse the harness. No providers, env files, deploys, database resets, other tasks or UI changes. No secrets printed. Read-only catalog must not start/retry any operation. Do not claim fixed workflow is autonomous CREAO.

Run focused tests/typecheck/lint. Update ONLY the card Result with exact API shape, status precedence, files, checks and known limits. Commit and push S2-simulation-catalog, then stop for Codex audit. Do not merge main or preview. Send Jayden the commit hash and test summary.
