# Overnight result: reviewable 2U cash replay

Completed October 24, 2026 at 08:49 PDT. The requested reviewable prototype is ready; the overnight monitor is paused and all owned Claude workers have finished. Main remains 694ab2a and has not been merged or pushed.

## Open the demo

- Fresh journey: http://127.0.0.1:3102/historical
- Completed example: http://127.0.0.1:3102/historical?style=ramp&run=baseline-64fe7e476812a83b&alt=alternative-16cefc03dc4b5748
- Review branch: preview/historical-overnight, checkout ../domino-preview. Runtime code is 5db5f21, with acceptance 3570989 and final handoff files above that checkpoint. Diff base: main 694ab2a.
- Click Save forecast, Reveal what was reported, then Compute the alternative. Reload retains the run. The theme selector offers Original, Ramp, Hyphenate and shadcn without changing financial state.

## What is ready

- One curated case uses disclosures available by November 10, 2023, with September 30 opening balances. It saves an immutable quarterly cash forecast, reveals the February 12, 2024 disclosure, compares year-end results, and computes one explicitly hypothetical cost-only alternative.
- Cash and equivalents forecast: $23.109M. Reported outcome: $60.689M. Reported minus forecast: +$37.580M. The alternative point is $18.8465M, a cost-range midpoint, not an estimate of success.
- Frozen input objects and hashes remain attached to saved forecasts. Revealed observations are frozen separately. Publication gates exclude later evidence before reveal. Facts, assumptions, derived values and post-hoc authorship are labelled.
- Actual activity records successful saves, reveals and alternative computations. Retries do not duplicate records. Baseline feeds are isolated; alternatives retain their own output IDs. Initial history is quiet. No product agents or tools are being spawned; those examples remain a labelled playground simulation.
- Existing chart, Radix/shadcn-style primitives, theme tokens, Motion and activity reducer were reused. No new package dependency was needed for this overnight implementation. Raw issuer HTML is retained for source hashes, not imported into the client.

## Checkpoints and verification

| Area | Accepted checkpoint | Evidence |
| --- | --- | --- |
| Cash evidence | a4e49e0 | Raw S7/S8 hashes, publication dates and 13 normalization tests |
| Contracts / engine | 442d23b / a75406d, real-case 41d04e7 | Independent review and exact hand-calculated case assertions |
| Persistence | 8389326, acceptance 66b2d2a | Independent Astra review, 726 tests, local concurrent save/reveal and frozen-input probes |
| Activity backend | 6498b75, acceptance 4795d51 | Independent Astra review, 734 tests, truly parallel sequence/dedupe/isolation checks |
| Live UI core | 4d5c86f, acceptance 641afd1 | Independent Sol review, 798 tests/build, real browser journey |
| Live activity UI | 5db5f21, acceptance 3570989 | Independent Sol review, 815 tests/build and actual three-event browser journey |

A fresh offline install in domino-preview passed all 815 tests, typechecks, lint and production build. Logs: /tmp/domino-preview-{install,check,build}.log. The final checkout served the complete saved journey with three events and no browser errors.

Browser checks covered save/reveal/alternative/reload, S7-only sources before reveal, keyboard point selection, four theme switches without losing run or selected event, quiet initial announcements after reload, and 375px chart/activity presentation. Desktop and mobile captures use the same saved state. The chart scrolls horizontally on mobile rather than inventing weekly points.

## Style evidence

| Style | Desktop | Mobile |
| --- | --- | --- |
| Original | [Screenshot](screenshots/original-desktop.png) | [Screenshot](screenshots/original-mobile.png) |
| Ramp | [Screenshot](screenshots/ramp-desktop.png) | [Screenshot](screenshots/ramp-mobile.png) |
| Hyphenate | [Screenshot](screenshots/hyphenate-desktop.png) | [Screenshot](screenshots/hyphenate-mobile.png) |
| shadcn | [Screenshot](screenshots/shadcn-desktop.png) | [Screenshot](screenshots/shadcn-mobile.png) |

[Real activity at 375px](screenshots/mobile-activity.png). Ramp and Hyphenate use public reference colors with inferred spacing/fonts. These are comparable treatments, not verified pixel copies of private product screens.

## Limits and next decision

- This is a retrospective cash forecast miss with outcome known during authorship. Risk-warning accuracy remains unvalidated; no evidenced risk threshold is applied. Debt, lender terms and bankruptcy-prevention claims are outside this accepted case.
- A1 has explicit upfront costs, 92-day minimum benefit lag, unknown feasibility and no benefit inside the forecast window. Its possible downside is visible but unmodeled, never assumed to be zero.
- Pending mutation request IDs do not survive a page reload. Reloading during an unknown save outcome can create a second run with the same inputs; stored runs remain immutable.
- Forced network-outage recovery and reduced-motion preference emulation were not exercised in the browser. Re-delivery/reconnect logic and reduced-motion behavior have source/component coverage. Browser tooling exposed no media-emulation capability.
- Agent canvas/chat, arbitrary tools/agents, broader disasters, a second company, production deployment and main integration remain deferred.

Call: review this narrow complete journey before merging main. Counterargument: a debt-aware distress case would better demonstrate warning value, but the current verified evidence does not support that claim. The next product decision is whether to deepen 2U with verified debt/constraint history or keep the honest cash-miss demonstration.

## Runtime ownership and restart

- Final Next preview: localhost 3102, exec29397/PID54500, /tmp/domino-final-preview.log, cwd domino-preview. Older owned previews 3100/3101 were stopped. Main server 3000 was untouched.
- Isolated anonymous Convex: localhost 3210/site 3211, exec80763/backendPID38093, /tmp/domino-H2-local-convex.log, cwd domino-H2/apps/web. Its local database contains the saved demo. No shared cloud database was used or reset. Older pre-repair smoke reveals intentionally fail closed; start fresh rather than resetting data.
- Automation domino-overnight-audit is PAUSED. All owned Claude workers are finished. Bounded awake guard exec88844/PID14212 remains until its original timeout around 11:13 PDT. Local services require the computer to remain awake.
- Use Node24 at /Users/jaydenl/.nvm/versions/node/v24.11.1/bin. Do not duplicate listeners. If restarting the already configured isolated backend, run from domino-H2/apps/web: `CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --local-cloud-port 3210 --local-site-port 3211 --typecheck disable --codegen disable`.
- From domino-preview, build with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @domino/web build`, then start with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @domino/web start --port 3102`. Do not use default root dev commands against a shared deployment.

## Primary evidence

[S7: 2U third-quarter 2023 results](https://www.prnewswire.com/news-releases/2u-reports-results-for-third-quarter-2023-301983979.html) supplies the eligible cutoff inputs. [S8: fourth-quarter/full-year 2023 results](https://www.prnewswire.com/news-releases/2u-reports-results-for-fourth-quarter-and-full-year-2023-302059834.html) supplies later observations. Normalized values, publication metadata and local raw hashes are in data/historical/2u/.
