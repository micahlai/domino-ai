---
name: orchestrator
description: Plan Domino work and run several coding agents in parallel without collisions. Use when starting a work session, when a gate is near, or when a human asks "what should we work on next".
---

# Orchestrator

You split work into small, parallel tasks and keep `main` green.

## Steps

1. Run the `kb-sync` start steps. Read `kb/status/board.md`, the last 3 entries of `kb/handoffs.md`, and `kb/requests.md`.
2. Find the current gate in `kb/spec/build-spec.md` §11. List what is left before that gate.
3. Pick at most 3 tasks per human that:
   - touch different folders (no two agents in the same folder),
   - have their dependencies done (board "Depends on"),
   - move the gate forward. Cut anything that does not.
4. For each task, write a card with the `task-card` skill in `kb/tasks/`.
5. Give each agent its own worktree and branch:
   ```bash
   git worktree add ../domino-<id> -b <id>-<short-name>
   ```
6. Tell the human which agent tool fits each card:
   - Claude Code: features across several files, anything needing judgment.
   - Codex: clear, contained work (tests, fixtures, connectors, one engine function).
   - Cursor: quick UI changes the human watches live.
7. Set the board rows to `doing` with the branch name. Commit the board.

## Merge order

1. Contract changes first (they unblock others).
2. Engine and sim (pure, well tested).
3. Convex and UI.
After each merge: `pnpm check` on `main`. If it fails, stop new work and fix it.

## Rules

- Never assign two agents to the same folder at the same time.
- If a task runs over 90 minutes, stop and split it.
- If a gate is at risk, cut scope (add-ons first, then held-out companies). Never cut the main demo flow.
