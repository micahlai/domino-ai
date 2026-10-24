# AGENTS.md

Rules for every AI coding agent in this repo (Claude Code, Codex, Cursor, CREAO).
Read this file fully before you write any code.

## 1. What we are building

Domino is an AI FP&A analyst for B2B software companies. It learns a company's data,
forecasts cash for 13 weeks, predicts risky events, shows the chain of problems each
event causes (the "dominoes"), and simulates fixes as branches of the timeline.
A person approves every action. Domino never moves money.

Full spec: `kb/spec/build-spec.md`. Read the section for your task before you start.

## 2. Before you start any task

1. Open `skills/kb-sync/SKILL.md` and follow its "start" steps.
2. Read your task card in `kb/tasks/`. If there is no card, ask the human for one, or
   write one with `skills/task-card/SKILL.md` and show it before coding.
3. Read `packages/contracts/src/` for every type you will touch.

## 3. Hard rules

1. **Stay in your folder.** Only change files in the folder named on the task card.
2. **Never change `packages/contracts/` or `apps/web/convex/schema.ts`** unless the task
   card says so. To ask for a change, add an entry to `kb/requests.md`.
3. **Money is integer cents.** Never use floating point numbers for money. Use the `Cents`
   type. Format money only in the UI.
4. **Dates are ISO strings** (`2026-11-02`). Weeks start on Monday.
5. **The engine is pure.** `packages/engine` has no network calls, no AI calls, no
   `Date.now()`, and no randomness. Same input gives the same output.
6. **Agents never calculate money.** Code in `packages/agents` proposes and explains. It
   returns `Change` objects; the engine computes the numbers.
7. **Never read the answer key** (`packages/sim` `answerKey()` output, `data/answer-keys/`)
   from engine, agents, connectors, or web code. Only `packages/sim/eval` may use it.
8. **Validate at boundaries.** Parse every outside input (APIs, agent output, JSON) with
   the Zod schemas in `@domino/contracts`.
9. **Mocks only.** Billing, CRM, cards, books and payroll come from our mock servers. Never call a real payment, card, CRM or payroll API. The bank is Capital One Nessie.
10. **No secrets in code or commits.** Read keys from environment variables only.

## 4. Done means

- `pnpm check` passes (typecheck, tests, lint).
- New engine or sim code has Vitest tests with fixtures.
- New UI has a playground entry at `/playground`.
- You followed the "finish" steps in `skills/kb-sync/SKILL.md` (board, handoff note, decisions).

## 5. Style

- TypeScript strict. No `any`.
- Small functions with clear names. Comments explain why, not what.
- Plain words in all UI text: "lender's limit", not "covenant".
- Commit messages: `area: what changed` (for example `engine: add domino rules for min cash`).

## 6. Skills (tool-independent)

Skills live in `skills/<name>/SKILL.md`. They are plain markdown checklists, not tied to any one tool.
Any agent (Claude Code, Codex, Cursor, Gemini, CREAO, or a person) uses a skill the same way: open the file and follow it.
`.claude/skills` is only a link to `skills/` so Claude Code also finds them automatically.
When a prompt or task card names a skill, read that file before you start.

| Skill | Use it when |
| --- | --- |
| `orchestrator` | Planning work, splitting it into task cards, running several agents |
| `task-card` | Writing a task for an agent |
| `kb-sync` | At the start and end of every task |
| `contract-change` | You need a type in `packages/contracts` to change |
| `engine-tdd` | Writing simulator or engine code |
| `ui-build` | Building any screen or component |
| `taste` | Reviewing a screen for design and wording |
| `ideate` | Trying a new idea fast (15-minute loop) |
| `review` | Reviewing another agent's diff before merge |
| `demo-check` | Running the demo script end to end |
| `figma-stage-log` | Writing a Figma stage log entry |

## 7. Owners

| Area | Owner |
| --- | --- |
| `packages/contracts` | Both (change by PR, both approve) |
| `packages/sim`, `packages/engine`, `apps/mocks`, connectors in `apps/web/convex/connectors/` | Jayden (engine) |
| `packages/agents` | Jayden; `explain` prompt wording by Micah |
| `apps/web` (UI) and `apps/web/convex/` (schema, queries, mutations) | Micah (product) |
| `kb/` | Both |
