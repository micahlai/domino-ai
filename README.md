# Domino

**Domino investigates company cash, compares forecasts with later results, and tests costed alternatives.**

## How we use Convex

- HTTP actions verify signed vendor webhooks (`apps/web/convex/http.ts`).
- Scheduled functions run the simulated clock and the audit, forecasting and advisor agent swarms (`fieldClock.ts`, `fieldAnalyst.ts`).
- A composed schema with 43 tables and 69 indexes holds snapshots, findings, suggestions and timeline branches (`apps/web/convex/schemas/`).
- Realtime `useQuery` keeps the dashboard, brain map, worker page and Timeline live with no refresh.
- Full feature list, proof files and build log: [hackathon.md](hackathon.md).

The current demo is a historical 2U case study. Its main screen is a grouped agent map beside a persistent conversation. Inspect frozen company evidence, save a quarterly forecast, reveal reported outcomes and explore hypothetical decisions. Some scenario and CREAO coordination features are still incomplete.

Start with the [shared product plan, status and roadmap](kb/product/team-reset-2026-10-24.md), [team ownership](kb/coordination/historical/team-checkpoint.md), and [current/planned architecture diagrams](docs/architecture/README.md). The integration branch is preview/historical-overnight. Main remains unchanged.

Built at Cal Hacks 13.0 for Hyphenate's autonomous finance track. [Track coverage and gaps](kb/product/hyphenate-checklist.md) are explicit; we do not claim full completion.

The setup and operational-agent notes below are retained from the earlier Kestrel prototype. They are not evidence that those capabilities are part of the current historical journey. Do not run a seed/reset against the existing demo database. See HANDOFF.md for the current local runtime and checked commands.

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
| `skills/` | Development skills, plain markdown, work with any coding agent (orchestrator, ui-build, taste, ...) | Both |
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

### CREAO backend configuration

The local server configuration is in ignored `.env.local`. Keep `CREAO_API_KEY`
there; never copy it into this README or frontend code.

```dotenv
CREAO_API_BASE_URL=https://agent.creao.ai/api/v1
CREAO_AGENT_ID_MAPSOURCE=<your mapping agent ID>
CREAO_AGENT_ID_CONSTRAINTS=<your constraints agent ID>
CREAO_AGENT_ID_BRIEF=<your brief agent ID>
```

For this API family, start runs at `POST /apps/{agentId}/runs` relative to the
configured base URL, with bearer authentication and an `inputs` object. See the
[CREAO starter pack](https://community.creao.ai/AI_hackathon_UCLA2026/tech) and
[API Trigger guide](https://docs.creao.ai/pro/api-trigger).

An earlier local setup handoff recorded pending replacement of Jayden's key and agents,
and results containing input/summary objects rather than contract outputs. Environment
variables are now populated, but this integration does not revalidate their ownership or
current job output. Validate the configured agents before claiming end-to-end learning.
