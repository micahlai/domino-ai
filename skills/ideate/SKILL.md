---
name: ideate
description: Try a new product idea in 15 minutes and decide keep or kill. Use when someone says "what if we...", for new scenarios, visuals or features.
---

# Ideate (15-minute loop)

## Steps

1. **Write it** (2 min): one line in `kb/scenarios.md` or `kb/decisions.md` draft: what the user sees, and why a judge would care.
2. **Fake the data** (3 min): add or tweak a fixture in a scratch file (`apps/web/app/playground/scratch.ts`), not in contracts.
3. **Show it** (8 min): render it in `/playground` with the simplest possible code. Figma Make is fine too.
4. **Decide** (2 min): keep or kill. Keep only if it makes the demo clearer or the "wow" bigger, AND fits before the next gate.
   - Keep: write a task card, add a board row, log the decision.
   - Kill: one line in `kb/decisions.md` with why. Delete the scratch code.

## Rules

- Never change contracts, engine or Convex during ideation.
- Timebox hard. If it is not clear in 15 minutes, kill it or park it in `kb/scenarios.md`.
