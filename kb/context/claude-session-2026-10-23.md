# Context handoff: Claude planning session (Fri Oct 23 to Sat Oct 24, 2026)

Read this to understand every decision made before the code started. The spec files are the source of truth for WHAT
to build (`kb/spec/`). This file explains WHY, what we rejected, and where things stand.

## 1. Who and what

- Team: Jayden (engine) and Micah (product). Both non-finance people. Plus coding agents (Codex, Claude Code, Cursor).
- Event: Cal Hacks 13.0, hacking started Fri Oct 23 ~6 PM PT. Deadline assumed Sunday ~9 AM (confirm the real time).
- Repo: github.com/micahlai/domino-ai. Local copy: `~/Dev/Hackathon/CalHacks 26/domino-ai`.
- Product: **Domino**, an AI FP&A analyst for B2B software companies. Learns a company's data, forecasts cash 13 weeks,
  predicts risky events, shows the chain of consequences ("dominoes"), simulates fixes, a person approves every action.

## 2. How Jayden wants agents to work with him

- Lead with the conclusion. Terse. Make the judgment call, state the counterargument so he can overrule.
- Honest, critical evaluation over agreement. Catch overstatements. Never claim what tests do not show.
- No em dashes in anything written for him. Plain words, one idea per bullet.
- UI/UX is top priority. A person with zero finance knowledge must understand the product after the demo.
- Do not shove sponsor tools in without a real job in the product.

## 3. How we got here (decision trail)

1. Started by researching Cal Hacks sponsor tracks for recruiting value. Coinbase and Figma attach recruiter access;
   Hyphenate (formerly Maximor) has the biggest cash prize ($8K/$5K/$3K) and offers expedited interviews.
2. Ideas considered and dropped: cash reconciliation (Jayden burned out on it; HackMIT already had many),
   a pure "AI company of agents" for Creao (crowded), Track Scout (hackathon critique tool), an agent company that
   sells itself, corporate restructuring (layoffs: bad optics; post-merger integration: HackMIT winner VistaAI did it).
3. Researched HackMIT 2026 Maximor track (19 projects). Winners: VistaAI (1st, PE roll-up back office),
   CFO-Sabbatical (2nd, 16 bots, AR changes ripple into the 13-week forecast, tested), Sherlock (3rd),
   Money Maxer (4th, deterministic kernel), TrueUp (5th). Lessons: rigor (code owns numbers, human approval) is the
   entry ticket; breadth and a fresh framing won; visuals alone did not win. Nobody did a multiverse stress test.
4. Landed on financial turnaround / cash crunch, then simplified to "simulate good and bad events, predict cash,
   suggest and simulate fixes". Named it Domino (domino effect of late cash).
5. Hyphenate mentor feedback: make the agent self-learning and self-improving; pull from mock copies of tools like
   Stripe and Ramp; define constraints clearly; test on a dataset with simulated significant events; it should plug into
   any company and learn its data sources from scratch.
6. Vertical: B2B software (SaaS). Seat: FP&A analyst who owns the cash forecast (controller and CFO approve).
7. Hero / wow: the **multiverse timeline**. Past on the left with real event markers, a Today line, many possible
   futures fanning out, each ends "survives" or "breaks"; a resilience score ("survives 7 of 11 futures, 64%");
   an "Apply fixes" toggle animates broken futures up to green (fixtures: 64% to 93%, 9 of 11).
8. Rejected: MiroFish (unvalidated social-opinion simulation), Jev as a dependency (not a sponsor, no reasoning trace),
   Monte Carlo and OR-Tools for v1 (named scenarios and simple ranking first), Anthropic "Claude for Public Benefit"
   and Cartesia tracks (no real fit), hyperscalers as the demo company (wrong scale; a cloud price increase is a scenario instead).

## 4. Key build decisions (also in `kb/decisions.md`)

- All TypeScript monorepo (pnpm, turbo, biome, vitest). Contracts in `packages/contracts` with Zod.
- Engine is pure code: no AI, no network, no clock, no randomness. Money is integer cents. AI never calculates money.
- **Mocks only:** Stripe-shaped billing, HubSpot-like CRM, Ramp-like cards, NetSuite/QuickBooks-like books,
  Gusto-like payroll and contract PDFs all come from our own mock servers (`apps/mocks`). Only the bank is outside:
  Capital One Nessie. Each connector takes a base URL so a real API can replace a mock later (path to production).
- Database: Convex only (live UI updates). No Postgres.
- Agents: CREAO runs the learning jobs (mapSource, readConstraints, weeklyBrief); Claude runs live jobs
  (proposeFixes, explain). `AGENT_BACKEND_<JOB>` switches per job; Zod validates; fallback to Claude.
  CREAO was not at their booth; their API is UNCONFIRMED. Prompt E6 must confirm it first.
- Demo company: Kestrel Data, simulated, about $24M ARR, 120 people, $4.5M cash of which $600K is lease collateral,
  lender rule: usable cash at least $3M. Calibrated from public peers via SEC EDGAR: Amplitude, PagerDuty,
  Sprout Social, Freshworks, Box. Held-out test companies: Tally, Orbit.
- The moment: the loan does not count lease collateral as cash, so with Acme paying late the breach moves from week 9
  to week 5; fixes raise survival from 64% to 93%.
- Skills are tool-independent markdown in `skills/` (`.claude/skills` is a link). Prompts name skill files.

## 5. Tracks we enter (see `kb/product/submission.md`)

Hyphenate (main), Microsoft Grand Prize "Built for the Real World", Figma "Idea to Demo" (stage log + Figma Slides,
Edu verification), CREAO "AI-First Disruptor", Convex, Capital One Nessie. Add-ons only if time: Apify (customer news
risk signals, public pages only, no LinkedIn), CRS (business credit data, test data only).

## 6. Where things stand (Sat Oct 24, ~00:25 PT)

- Done: repo scaffold, contracts + fixtures (incl. multiverse) with 13 passing tests, knowledge base, build spec,
  design spec, Convex API contract, prompts E1 to E8 and P1 to P8, 11 skills, `.env.example`.
- Commits on local main: setup, peer companies, tool-independent skills, mocks-only. The last one may not be pushed yet
  (`git status -sb`). Uncommitted: Jayden's S0 agent edits to `kb/handoffs.md` and `kb/status/board.md`.
- S0 (machine setup): install and `pnpm check` pass. Still needed: `corepack enable`, `.env.local` with Anthropic,
  CREAO, Nessie keys; Convex fills its own keys via `npx convex dev` after P1.
- Next (per `prompts/README.md`): Jayden runs E3 (Codex OK), E1, E6 in parallel. Micah runs P1 then P2 and sketches the
  multiverse in Figma. Gate at Sat 12 PM: multiverse shows real engine output.

## 7. Open questions

- Exact submission time on Sunday.
- CREAO API: endpoints, auth, latency, can it reach our mock servers at a public URL.
- Does the Microsoft grand prize require a Microsoft product.
- Nessie: enough transaction history for 26 weeks, or seed only recent weeks.

## 8. Other docs from the session (outside the repo)

Claude Docs scope docs exist ("Runway: Project Scope", "Domino: Project Scope", "Domino: Build Spec"). They are
superseded by `kb/spec/`. Do not rely on them.
