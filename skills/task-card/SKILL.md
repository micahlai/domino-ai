---
name: task-card
description: Write a precise task card for a coding agent. Use before starting any agent, so it knows its goal, folder, contracts and how to prove it is done.
---

# Task card

Vague tasks make agents wander. A good card is short and testable.

## Template (save as `kb/tasks/<ID>-<short-name>.md`)

```markdown
# <ID>: <title>

- **Goal:** one sentence, a user-visible or test-visible result.
- **Folder:** the ONLY folder the agent may change.
- **Contracts used:** exact types/functions from packages/contracts.
- **Done when:** named tests pass, or a named playground section shows X. `pnpm check` passes.
- **Notes:** spec sections, fixtures to use, known traps.

## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
```

## Rules

- One folder per card. If it needs two folders, make two cards.
- "Done when" must be checkable by someone who did not write the code.
- Name the fixture to test against (`@domino/contracts/fixtures`).
- Link the spec section, do not copy it.
- Under 15 lines.

## Example

```markdown
# E3a: forecast() with invoices and payroll

- **Goal:** engine.forecast returns 13 weeks of cash for the fixture snapshot.
- **Folder:** packages/engine
- **Contracts used:** Snapshot, CompanyModel, Change, Forecast
- **Done when:** forecast.test.ts passes: weeks balance, usable = closing - restricted, Acme cash lands 21 days after due.
- **Notes:** build-spec §6.1. Use fixtures.snapshot and fixtures.model. No Date.now().
```
