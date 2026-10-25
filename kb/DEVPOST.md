# Domino

An AI cash-flow analyst for B2B software companies.

## Inspiration

Software companies that run short of cash usually saw it coming in their own tools: invoices that slip, card spend that creeps up, payroll landing the week a big customer pays late. An FP&A analyst stitches that together by hand, often monthly. We wanted an analyst that reads every tool continuously, shows its work to the cent, and tells a person what it would do without ever touching the money.

## What it does

- **Connect.** Billing, cards, books, payroll and CRM come from mock servers shaped like the real Stripe, Ramp, QuickBooks, Gusto and HubSpot APIs. The bank is real: Domino creates its own customer and accounts in the Capital One Nessie sandbox and posts each week's lines there.
- **Ingest and audit.** An ingestion agent maps every source into one immutable snapshot. An audit swarm then runs one checker agent per check (duplicates, cross-tool tie-out, amounts, timing, overdue customers, missing expected items, billing ends).
- **13-week direct cash flow statement.** Actual weeks come from bank transactions, then 13 projected weeks, all in integer cents. Every week must tie to the bank balance; a dropped or double-counted transaction fails the tie-out.
- **Forecasting swarm.** An analyst agent picks 6 to 10 stress scenarios with deterministic rules and spawns one forecaster per scenario plus a research agent that runs real Apify actors to search for news on top customers and vendors.
- **Advisors and suggestions.** If a scenario takes cash below the lender's minimum, one advisor per candidate fix (draw the credit line, delay a bill, accelerate collections, defer hires) computes that fix's effect. CREAO recommends one with a rationale. A person accepts or declines. Accepting records a decision; Domino never moves money.
- **Timeline.** Our teammate's lane: scenarios, saved branches and Ask Domino, a chat assistant over the forecast.
- **Brain map.** A live map of the agents that ran, which tools they read and what they reported, built from the agent log rather than a canned animation.
- **Simulated clock.** Plays a company's world day by day at 1x, 5x or 20x so the agents react as entries land.
- **Try it.** Judges start a sandbox company, plant scenarios or CSV rows, and watch the real ingestion, audit and analyst code react.
- **2U backtest.** A replay from the Nov 10, 2023 cutoff using public 2U filings.

## How we built it

Next.js and React (Tailwind, Radix, React Flow for the brain map) on a Convex backend. HTTP actions verify vendor webhook signatures. Scheduled functions drive the simulated clock and chain the audit, forecasting and advisor swarms as parallel internal actions. A composed schema of 43 tables and 69 indexes holds snapshots, findings, suggestions and timeline branches, and realtime `useQuery` keeps the dashboard, brain map, worker page and Timeline current without a refresh.

The split between AI and deterministic code is strict. All money math lives in a pure TypeScript engine package: no network, no clock, no randomness, integer cents only, with Vitest tests. Agents propose and explain; they never calculate money. CREAO runs the coordinator, flag explanations, counterparty notes, scenario summaries and fix recommendations, with Claude as the fallback when CREAO is unavailable. Claude (claude-opus-5-5 by default) powers Ask Domino.

Companies are simulated. Some are synthetic profiles; others are ledgers reconstructed from public filing anchors (2U, plus Asana-inspired and GitLab-inspired demos).

## Challenges we ran into

- Making a direct-method statement tie to the cent when bank transactions carry no category. We classify from record links first, then plain-text rules, and fail loudly when a week does not tie.
- Running parallel agents without races. Swarm members write through single mutations, the clock holds a lease so ticks never overlap, and Apify spend is reserved in a mutation so two runs cannot both pass the daily cap.
- Two full-stack lanes at once: we split the Convex schema into lane-owned fragments.

## Accomplishments that we're proud of

- A cash flow statement that reports a tie-out error, with the difference in cents, instead of a number when a week does not reconcile.
- An honest backtest. On 2U, the top-ranked decision from cutoff facts alone (draw the rest of the credit line) matched what management actually did: borrowings under the facility were $40.0 million at Dec 31, 2023. The forecast itself missed the direction of Q4: operating cash turned positive and financing brought cash in, which the nine-month pace and zero-financing assumption both missed. The counterfactual chart is labelled simulated, and the page states that the list of responses was chosen with hindsight.
- A judge sandbox that runs the real backend, not a recording.

## What we learned

- Deterministic engines and AI agents work best with a hard wall between them. Agents explain and recommend; the engine owns every number.
- Convex scheduled functions fit agent swarms well: each agent is a chain of actions, and the UI sees every step live.
- "Not modeled" builds more trust than a confident guess.

## What's next

- Real OAuth connections to the tools we mock, and a public deployment.
- Measuring forecast error across more held-out historical cases instead of one.
- Showing measured forecast improvement as Domino learns each company's payment timing.

## Built with

TypeScript, Next.js, React, Convex, Tailwind CSS, Radix UI, React Flow, D3, Zod, Vitest, Biome, pnpm, Turborepo, Anthropic Claude API, CREAO, Apify, Capital One Nessie API
