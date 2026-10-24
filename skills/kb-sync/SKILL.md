---
name: kb-sync
description: Keep the shared knowledge base in sync. Use at the START and END of every task or work session, for people and agents.
---

# kb-sync

The knowledge base (`kb/`) is how two people and many agents stay in step.

## Start

1. `git pull --rebase` on your branch (and `git fetch origin main`).
2. Read `kb/status/board.md` rows for your area.
3. Read the newest 3 entries in `kb/handoffs.md`.
4. Read open items in `kb/requests.md` addressed to you.
5. Read the spec section named on your task card.
6. Set your board row to `doing` with your branch name.

## Finish

1. `pnpm check` passes.
2. Update your board row (`review` or `done`, plus a short note).
3. Add a handoff entry at the top of `kb/handoffs.md`:
   ```
   ## YYYY-MM-DD HH:MM Name
   - Done: ...
   - Next: ...
   - Watch out: ...
   ```
4. If you made a decision, add one line to `kb/decisions.md`.
5. If the spec is now wrong, fix the spec in the same commit.
6. If you need something from the other person, add it to `kb/requests.md`.
7. Commit knowledge changes with the code: `kb: ...` lines in the same PR.

## Rules

- One fact in one place. Link, do not copy.
- Short entries. Newest at the top.
- Never write secrets in the knowledge base.
