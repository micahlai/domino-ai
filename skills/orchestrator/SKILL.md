---
name: orchestrator
description: Act as the "brain" that plans Domino work, writes task cards, dispatches worker agents, reviews and merges. Use when starting a work session, at a gate, or when a human asks "what should we work on next".
---

# Orchestrator (the brain)

One agent session is the brain. It plans, writes task cards, dispatches workers, reviews and merges.
It does NOT write feature code itself. Workers (Claude Code, Codex, Cursor, any agent) do one task card each.

## Roles

| Role | Runs where | Does | Never does |
| --- | --- | --- | --- |
| Brain | Main repo folder, on `main` | Plans, writes task cards, dispatches, reviews, merges, updates `kb/status/board.md` and `kb/handoffs.md` | Writes feature code; lets `main` stay broken |
| Worker | Its own git worktree and branch | One task card, one folder; writes its result into the task card | Edits the board or handoffs; touches other folders |
| Human | Anywhere | Approves plans, launches interactive workers, glances at every diff before merge | |

## Brain loop

1. Follow the start steps in `skills/kb-sync/SKILL.md`. Read the board, newest handoffs, open requests, the current gate (`kb/spec/build-spec.md` §11).
2. Pick at most 3 tasks that touch different folders, have their dependencies done, and move the gate forward. Cut anything that does not.
3. Write one card per task with `skills/task-card/SKILL.md` in `kb/tasks/`. Commit the cards.
4. Create a worktree per card: `git worktree add ../domino-<ID> -b <ID>-<short-name>`.
5. Dispatch (see below). Set the board rows to `doing` with the branch.
6. When a worker finishes: read the Result section of its card, review the diff with `skills/review/SKILL.md`
   (prefer a different model than the worker), run `pnpm check` on the branch, merge, run `pnpm check` on `main`.
7. Copy the worker's result into `kb/status/board.md` and a short entry in `kb/handoffs.md`. Remove the worktree.
8. Repeat. Start a fresh brain session at each gate; it reloads everything from `kb/`.

## Dispatch: who launches workers

| Task type | Who launches | How |
| --- | --- | --- |
| Engine math, contracts, Convex schema, the hero UI, anything risky | The human | The brain tells the human: "Start <tool> in `../domino-<ID>` and paste `kb/tasks/<ID>-*.md`." The human watches and answers questions. |
| Small, contained work: tests, fixtures, mock endpoints, docs, copy fixes | The brain may launch headless | From the worktree, run the tool's non-interactive mode with the card as the prompt, for example `claude -p "$(cat kb/tasks/<ID>.md)"` or `codex exec "$(cat kb/tasks/<ID>.md)"`. Check exact flags with `--help` first. Run in the background, log output to `../logs/<ID>.log`, and check on it. |

Rules for headless workers: one at a time per folder, a time limit (30 minutes), and the human still glances at the diff before merge.

## Agent tool choice

- Claude Code: features across several files, anything needing judgment.
- Codex: clear, contained work (tests, fixtures, connectors, one engine function).
- Cursor: quick UI changes the human watches live.
- Review with a different model than the one that wrote the code.

## Merge order

1. Contract changes first (they unblock others).
2. Engine and sim (pure, well tested).
3. Convex and UI.
After each merge: `pnpm check` on `main`. If it fails, stop new work and fix it.

## Rules

- At most 3 workers at once. More means the human spends all their time reviewing.
- Never two workers in the same folder at the same time.
- Only the brain edits `kb/status/board.md` and `kb/handoffs.md` (avoids merge conflicts).
- If a task runs over 90 minutes, stop and split it.
- If a gate is at risk, cut scope (add-ons first, then held-out companies). Never cut the main demo flow.
