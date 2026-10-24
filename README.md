# Domino

**Domino stops cash problems before they start a chain reaction.**

Domino is an AI FP&A analyst for B2B software companies. It plugs into a company's tools,
learns how money moves, forecasts cash for 13 weeks, and predicts risky events such as a
late customer payment. For each risk it shows the chain of problems that follows (the
dominoes), and it simulates fixes as branches of the timeline. A person approves every
action. Domino never moves money.

Built at Cal Hacks 13.0 for the Hyphenate track ("The Hyphenated Enterprise").

## Quick start

```bash
# 1. Tools: Node 20+, pnpm 9
corepack enable

# 2. Install
pnpm install

# 3. Keys
cp .env.example .env.local        # fill in values from the team password manager

# 4. Your own Convex dev database (after apps/web exists, prompt P1)
cd apps/web && npx convex dev

# 5. Run everything (web, Convex, mock servers)
pnpm dev

# 6. Reset the simulated company to a known state (after prompt E2)
pnpm seed
```

Before you push: `pnpm check` (typecheck, tests, lint).

## Where things are

| Path | What it is | Owner |
| --- | --- | --- |
| `kb/` | Knowledge base: spec, status board, decisions, handoffs. Read `kb/README.md` first. | Both |
| `prompts/` | Ready-to-run prompts for coding agents, in order. Start at `prompts/README.md`. | Both |
| `.claude/skills/` | Development skills for agents (orchestrator, ui-build, taste, ...) | Both |
| `packages/contracts` | Shared types, Zod schemas, fixtures. The contract between all modules. | Both, by PR |
| `packages/sim` | Simulated companies, events, planted errors, answer key | Jayden |
| `packages/engine` | Forecast, dominoes, risk scan, fix scoring, learning. Pure functions. | Jayden |
| `packages/agents` | CREAO and Claude agents behind one interface | Jayden |
| `apps/mocks` | Mock servers for CRM, cards, books, payroll | Jayden |
| `apps/web` | Next.js UI and Convex backend | Micah |

## How we work

1. Pull, then read `kb/status/board.md` and the latest entries in `kb/handoffs.md`.
2. Pick a task card from `kb/tasks/` (or run the next prompt in `prompts/`).
3. Work on a short branch. Merge to `main` at least every 2 hours. `main` must pass `pnpm check`.
4. Update the board and add a handoff note before you push.

## Judging notes

- **Seats it fills:** the FP&A analyst who owns the cash forecast, working with the controller and CFO.
- **What is real and what is simulated:** see `kb/product/proof.md`.
- **CREAO agent ids and run links:** see `kb/product/submission.md`.
