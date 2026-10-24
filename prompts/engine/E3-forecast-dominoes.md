# E3 · Engine: changes, forecast, dominoes (Jayden)

Current execution card: `kb/tasks/E3b-dominoes.md`. Read `kb/spec/engine-e3b-e4-implementation.md` first; it supersedes conflicting instructions in this historical full-task prompt. Respect the card dependency gate and worker ownership.

Tool: Claude Code or Codex ("Codex OK"). Branch: `E3-forecast`. Folder: `packages/engine`. Depends on: S0.
Skill files (in skills/): kb-sync, engine-tdd.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/engine-tdd/SKILL.md. Read AGENTS.md, kb/spec/build-spec.md §6.1, §6.2, §6.7 and packages/contracts/src.

In packages/engine, implement (test first, pure functions, integer cents, UTC dates):
1. src/dates.ts: weekStarts(asOf, n), addDays, weekIndexOf(date, weeks).
2. src/apply.ts: applyChanges(snapshot, changes) -> an adjusted copy, following §6.7 exactly. Reject delay_bill on critical bills.
3. src/forecast.ts: forecast(snapshot, model, changes) following §6.1. Unsigned won deals add no cash.
4. src/dominoes.ts: dominoes(forecast, constraints, snapshot) following §6.2, with order, causedBy and evidence.
   The min_cash domino must quote the constraint evidence.
5. Wire them into the engine object in src/index.ts (keep the other functions as notBuilt for now).

Tests with @domino/contracts/fixtures:
- every week balances; usable = closing - restrictedCash
- Acme's invoice lands 21 days after its due date (model mean)
- the unsigned Northwind deal adds no cash
- a delay_invoice of 45 days on Acme moves its cash out of the 13-week window and creates a min_cash domino when usable < $3M
- discount_early_pay rounds to whole cents
- same inputs give identical outputs (deep equal)

When done: pnpm check passes, board row E3, handoff.
```
