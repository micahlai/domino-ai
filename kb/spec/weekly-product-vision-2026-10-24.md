# Domino weekly product vision (Jayden, Oct 24)

Supersedes the SEC quarterly case study as the product centerpiece. Audited L0-L3 (normalize, reconcile, scoped rules) are reused as the ingestion/audit core for weekly books. SEC quarterly L4 evaluation is a side proof, not the demo.

## Product

1. **Always-on finance agent.** A bounded backend job polls the mock data sources (billing, CRM, cards, books, payroll, Nessie bank) and ingests new entries as they appear. Every ingest is a recorded operation, so the map animates real events. A "simulate new entries" control advances the mock feed for demos. Never calls real money systems; never moves money.
2. **AI audit.** Ingested entries are reconciled and checked for abnormalities (duplicates, conflicts, unusual amounts/timing, missing expected items). Findings become escalations.
3. **Dashboard (home).** Key book numbers (cash now, 13-week low point, runway, AR/AP due) and a 13-week health rating (OK / watch / at risk) with the reason.
4. **Worker page** (one click from dashboard). Review escalations and decisions, launch an analysis, simulate an event the user picks.
5. **AI brain map.** All agents, the agents they manage, tools and data sources, synced to the backend. Animations only for real recorded data exchange and tool/agent spawns. Hover: short brief. Click: instructions, tool calls, reasoning summary, connected agents, inputs/outputs.
6. **Auto-analysis.** Autonomously generates plausible unexpected events, runs the domino chain on the 13-week forecast, tests the company's planned responses, and scores resilience. If the company fails (e.g. cash deficit), show why and when.
7. **Simulation catalog.** Every simulation saved and reopenable.
8. **13-week timeline.** History of past events, scheduled future items (client payments, bills, payroll), and branches for simulated scenarios. Branches can split again and rejoin the main line if the company survives; failing branches end visibly with the cause.

## Engine and data

Weekly 13-week forecast, dominoes, stress test, risks and fix scoring already exist in packages/engine (forecast.ts, dominoes.ts, stress-test.ts, risks.ts, score-fix.ts). Money stays integer cents; engine stays pure; agents never compute money; a person approves every action.

## Lanes

- **Field (Jayden):** ingestion agent and mock feed, audit/anomalies and escalations, brain map, worker page actions that launch agents.
- **Timeline (friend):** dashboard and health rating, 13-week timeline with scheduled items and branching scenarios, auto-analysis and resilience, simulation catalog.
- **Seam:** Field exports a hashed weekly company state (WeeklySeedV1: ingested books snapshot + 13-week baseline inputs + scheduled items + open escalations); Timeline consumes it and returns result references. JSON text only, reusing the P0-C canonical hash path.
