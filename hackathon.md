# Hackathon log

- **Project:** Domino
- **Event:** Cal Hacks 13.0
- **What it does:** An AI cash-flow analyst for B2B software companies that reads connected finance tools, audits them, builds a 13-week direct cash flow statement and suggests costed fixes a person accepts or declines.
- **Live app:** https://domino-ruddy.vercel.app
- **Repo:** https://github.com/micahlai/domino-ai
- **Frontend:** https://domino-ruddy.vercel.app (Vercel project `domino`)
- **Convex deployment:** knowing-bee-636 (https://knowing-bee-636.convex.cloud)
- **Components:** none
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, scheduled functions, realtime useQuery, paginated queries
- **Auth:** none
- **AI models:** claude-opus-5-5 (default; other Claude calls read ANTHROPIC_MODEL), plus CREAO agent apps
- **Started:** 2026-10-24T06:57:18Z
- **Last updated:** 2026-10-25T12:52:38Z

## How we use Convex

- Signed vendor webhooks (Stripe, Gusto, Ramp, Nessie) -> HTTP actions verify signatures, then a debounced scheduled drain re-ingests -> `apps/web/convex/http.ts`, `fieldWebhooks.ts`
- Simulated clock plays the company day by day -> self-rescheduling `scheduler.runAfter` ticks with a lease -> `apps/web/convex/fieldClock.ts`
- Audit, forecasting and advisor swarms -> parallel internal actions chained by the scheduler, writing through mutations -> `fieldAudit.ts`, `fieldAnalyst.ts`, `fieldAdvisor.ts`
- Immutable snapshots, findings, suggestions, timeline branches -> composed schema with 43 tables and 69 indexes -> `apps/web/convex/schemas/*.schema.ts`
- Agent activity feed -> paginated query `field.log` read with `usePaginatedQuery` -> `apps/web/components/field/data.ts`
- Live without a refresh (`useQuery`): dashboard, brain map, worker page, sim clock bar, Timeline, Try it judge panel -> `components/field/`, `components/timeline/workspace/books.tsx`, `components/judge/LivePanel.tsx`

## Log

- 2026-10-24 `c7dc305` Repo setup: contracts, kb, specs (`packages/contracts`, `kb/`)
- 2026-10-24 `f87d8f9` Decide to mock every tool but the bank (`AGENTS.md`, `prompts/`)
- 2026-10-24 `c354bcb` Engine: risks, fixes, history, stress tests (`packages/engine`)
- 2026-10-24 `234fdc3` Claude and CREAO provider adapters (`packages/agents`)
- 2026-10-24 `052e942` First Convex prototype (`apps/web/convex/computed.ts`)
- 2026-10-24 `594b185` Historical 2U view on live Convex APIs (`apps/web/app/historical`)
- 2026-10-24 `c6e0a89` Grouped company agent map (`apps/web/components`)
- 2026-10-25 `a3c3b4c` Lane-owned schema fragments (`convex/schemas/`)
- 2026-10-25 `93ab4f8` Ingestion agent, mock feed, audit (`fieldJobs.ts`, `fieldFeed.ts`)
- 2026-10-25 `d6fa303` 13-week direct cash flow statement (`packages/engine/src/cash-flow-statement.ts`)
- 2026-10-25 `305cc72` Real-tool mock connectors, Connect page (`convex/connectors/`)
- 2026-10-25 `f4def51` Analyst with parallel forecasters (`fieldAnalyst.ts`)
- 2026-10-25 `12e2ec5` Capital One Nessie bank (`fieldNessie.ts`)
- 2026-10-25 `11e4a3b` CREAO runtime and coordinator (`fieldCoordinator.ts`)
- 2026-10-25 `1c5c80c` Try it judge sandbox (`fieldJudge.ts`, `components/judge/`)
- 2026-10-25 `836ab8c` Real Apify counterparty signals (`fieldApify.ts`)
- 2026-10-25 `dbcb5aa` Simulation clock (`fieldClock.ts`)
- 2026-10-25 `dff349e` Signed vendor webhooks (`http.ts`, `fieldWebhooks.ts`)
- 2026-10-25 `b820883` Audit, forecasting, advisor swarms (`fieldAudit.ts`, `fieldAdvisor.ts`)
- 2026-10-25 `5449dee` Filing-backed reconstructed ledgers (`packages/sim/src/operating/`)
- 2026-10-25 `01964ca` Suggestions linked to saved simulations (`fieldSuggestionSimulation.ts`)
- 2026-10-25 `7aa3314` Agents start idle until Start agents (`fieldAgents.ts`)
- 2026-10-25 `881a2af` 2U backtest from Nov 2023 (`backtest.ts`)
- 2026-10-25 `28acaf6` Timeline scenario branches, Ask Domino (`convex/timeline/`)
- 2026-10-25 `0f2874f` Public deploy: Vercel + prod Convex with demo data imported (`.vercelignore`)
