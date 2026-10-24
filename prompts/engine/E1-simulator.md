# E1 · Simulator: Kestrel + calibration + print CLI (Jayden)

Tool: Claude Code. Worktree branch: `E1-simulator`. Folder: `packages/sim`. Depends on: S0.
Skills: kb-sync, engine-tdd.

## Prompt

```
Load the kb-sync and engine-tdd skills. Read AGENTS.md, kb/spec/build-spec.md §7, and packages/contracts/src (sim.ts, core.ts, branches.ts).

Build packages/sim so it implements the Simulator interface from @domino/contracts.

1. src/rng.ts: a seeded generator (mulberry32) and helpers (normal, pick, chance). No Math.random anywhere.
2. src/profiles/kestrel.ts: the Kestrel parameters from build-spec §7.1 as one typed config object.
   Also stubs for tally.ts and orbit.ts with different parameters (§7.2).
3. src/calibrate/edgar.ts: a script (pnpm --filter @domino/sim calibrate) that downloads SEC EDGAR company facts
   for the 5 companies listed in kb/research/public-companies.md (Amplitude, PagerDuty, Sprout Social, Freshworks, Box;
   look up each CIK from https://www.sec.gov/files/company_tickers.json) (use SEC_EDGAR_USER_AGENT; endpoint
   https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json), computes the ratios in
   kb/research/public-companies.md, and writes them to src/calibrate/ratios.json. Fill the table in that file
   with the companies, filings and numbers. If the network is blocked, stop and tell me; do not invent numbers.
   Kestrel's profile reads its ratios from ratios.json.
4. src/create.ts createCompany(profile, seed): 26 weeks of history ending 2026-10-30. About 300 customers
   (4 named large ones matching the fixture names: Acme Logistics, Northwind Health, Brightpath Retail, Cobalt Labs),
   invoices with per-customer delay habits (Acme chronically ~21 days late), bank transactions that follow
   invoices and Stripe payout timing (1 to 3 days lag), bills, card spend, payroll every two weeks, deals
   (including one won but unsigned renewal), cashOnHand 4.5M, restrictedCash 600K.
   Plant the errors from build-spec §7.4. Put planned future events in pendingEvents.
5. src/advance.ts advanceWeek(world, injected): applies pending and injected events for one week, adds the new
   records, moves today forward 7 days.
6. src/eval/answerKey.ts answerKey(world). Only this folder may read it.
7. src/cli/print.ts and the "print" script: prints the snapshot summary and, if @domino/engine exports a working
   forecast, the 13-week forecast as a table. Wire "sim:print" at the root (already there).
8. Tests: same seed gives identical output; history has 26 weeks; balances add up; Acme mean delay is 18 to 24 days;
   every snapshot parses with SnapshotSchema; the answer key lists every planted error.

Money is integer cents. Dates in UTC. When done: pnpm check passes, update the board row E1, add a handoff.
```

## Done when
- `pnpm --filter @domino/sim test` passes and `pnpm sim:print` prints a sensible Kestrel summary.
- `kb/research/public-companies.md` has real numbers with sources.
