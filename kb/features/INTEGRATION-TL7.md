# TL7 integration: Timeline merged into Field

Date: 2026-10-25. Branch `integrate/tl7` (worktree `domino-integrate`), from field/main 836ab8c. It also merges field/main 49d238f (CREAO robustness, sim clock). Not pushed and not merged to main.

## What merged

- `origin/TL7-checkpoint` 1140c26 (66 commits, based on shared/shell f20f0c4). It brings Timeline TL1-TL7: saved baselines, workspace runs, constraints, questions, the TL6 output envelope (`timeline/output:get`), TL7 automatic analysis (`timeline/analysis:*`), the saved-scenario sidebar, chart scales and the inline scenario editor.
- Merge commit 3396249. The only conflict was the table count in `apps/web/convex/schemaComposition.test.ts`.
- The later field/main merge (af9497f) had two conflicts. In `AppShell.tsx` both imports were kept: SimClockBar and the selected profile. The schema count also conflicted.
- Composed schema: 39 tables. Timeline has 16 (`risks` ... `timelineAnalyses`). Field has 23, including `findings`, `connections`, `aiCalls`, `apifyRuns`, `nessieLinks`, `simClocks` and the new `timelineLinks`.
- `schema.ts` is unchanged. One copy of the shared theme is kept, since TL7 did not touch it. `api.d.ts` registrations were hand-merged and then confirmed by a local `convex dev` codegen (only its formatting differed). `package.json` and the lockfile were not changed by either lane. `lane-imports` passes (19 cross-lane imports, 0 in harness files).

## Joint engine change (shared math: both lanes' numbers shift)

Lead decision: option A. Commit 1c323ab, in `packages/engine`:

- Written-off invoices are never projected as inflows. The new `isOpenInvoice` means not paid and not written off. A paid invoice's `paidAmount` is terminal, so a short payment never projects the remainder.
- Pending processor payouts become `payout` inflows on `expectedArrival`, net of fees. By contract their invoices are already paid, so nothing is counted twice.
- The cash flow statement classifies payouts as customer collections and still ties to forecast closings. `scanRisks` uses the same open-invoice rule.
- Hand-computed tests were added in `forecast.test.ts` and `cash-flow-statement.test.ts`.
- Effect: Field's dashboard derivation and Timeline runs both change slightly. Field companies had about 7 written-off invoices that used to count as cash in, and 2 payouts that were ignored.

## Timeline changes needed for Field books (commit 7d59638)

- `checkSupportedFields` now rejects only `invoice.collection` and `bill.agreedPayOn` (`UNSUPPORTED_SEED_FIELDS`). Billing plans and plan links, `paidAmount`, `writtenOff` and `pendingPayouts` are accepted. Money bounds now include payouts and plan occurrences.
- Before this, every Field seed was rejected: Field's sim v2 uses billing plans for all companies, and the guard predates engine efdaf45.
- TL7 analysis budgets went from 2,000 records / 24 open invoices / 24 deals to 4,000 / 100 / 100. Field companies have about 1,800 records, 35-47 open invoices and about 40 deals. Every forecast still runs through the same engine.
- Written-off invoices are not "open" for Timeline events or analysis.

## Seam wiring (commit 3b21f57)

`convex/fieldTimeline.ts` (Field-owned) calls Timeline only through its public functions:

1. `field.exportSeed` -> `parseWeeklySeedJson`.
2. `timeline/baselines:save`. Field's `constraints` (lender's minimum, runway policy) and its latest `models` row are the reviewed assumptions. The assumption note lists them, the engine conventions above, and the fields that still reject. Deterministic request ids mean the same books reopen the same run.
3. `timeline/workspace:open` (the root run).
4. `timeline/analysis:start`, launched by the explicit click and never on page open. A failure to start is recorded as `analysisError`.
5. `timeline/workspace:resultRef`, checked with `parseWeeklyResultRefJson` and against the seed id and hash. It is stored in the new Field table `timelineLinks`; `fieldTimeline.latest` reads it back with `current` (whether it was made from the latest books).

Timeline's company id is the seed's `company.id`, which is the sim profile id (`kestrel-crunch` for Osprey). Timeline routes are therefore `/c/<profile>/timeline`.

## UI (commit e625258 and a follow-up)

- **Open in Timeline** (`components/field/OpenInTimeline.tsx`) appears on the dashboard, the worker header and a Field strip above Timeline pages (`TimelineBridge`). It navigates to the saved run.
- **Dashboard**, when a Timeline run exists:
  - TL6 health ("Rated by Timeline", with the rule receipt's breach week and shortfall).
  - The TL6 13-week chart and lender minimum.
  - TL7 "Saved risk scenarios": risk label, weight with its stated basis, low-point impact, best response with cost note, scenario links, and the weighted scenario index labelled as not a survival probability.
  - "Try fixes on the timeline" opens the analysis page; "Open the timeline" opens the run.
  - Stale runs (newer books ingested) say so and offer to open the latest books.
- **Dashboard without a run:** Field's derivation, labelled "Field estimate", with Open in Timeline.
- **Navigation:** the top bar Timeline link goes to `/c/<selected company>/timeline`. The company switcher on Timeline pages moves to the picked company (2U goes to the dashboard). Opening a Timeline URL selects its company. `/simulations` is now Timeline's saved-run catalog for the selected company. The old demo sub-nav stays only on legacy `/c` pages.

## Overlap decision

- Timeline TL7 automatic analysis is the source of truth for risk scenarios and responses on the dashboard and the timeline.
- Field's Analyst and forecasters and the CREAO coordinator remain for triage, research and the brain map. On the dashboard their cards are titled "Field triage scenarios" and shown under Timeline's "Saved risk scenarios". Field's illustrative sample cards show only before a Timeline run exists. Nothing was deleted.

## Verification

**Automated checks:**
- tsc: web, convex and the four packages.
- vitest: contracts 496, engine 376, sim 73, agents 326, web 1056.
- `pnpm --filter @domino/web build`.
- Biome: changed files clean. `pnpm lint` fails only on `apps/web/components/field/BrainMapSourceDemo.json` formatting. That failure is pre-existing on field/main 49d238f and was left untouched.
- `convex/tests/fieldTimeline.test.ts` covers Osprey end to end: same seed hash and result identity, TL6 health `at_risk` from `con_lender_min`, idempotent reopen, and a succeeded TL7 analysis with saved risks.

**Live run:** isolated anonymous local Convex on 3390/3391 and Next on 3131, `field:setupAll`, no AI provider env. Servers were stopped afterwards.
- Osprey: Open in Timeline saved the run. Timeline shows the lender's minimum breach ($3,000,000; short $697,417.43 in the week of Dec 28, 2026; low $1,827,028.45 on Jan 25, 2027).
- The dashboard showed "At risk, Rated by Timeline", the Timeline chart, and 3 saved risk scenarios plus Field triage scenarios.
- The analysis page, `/simulations`, and the company switch to Kestrel (follow, import, dashboard "On track, Rated by Timeline") all worked.
- At 390px the document width was 390. Console errors: 0.
- Screenshots are in the session scratchpad `integrate/` folder.

## Remaining gaps

- **TL8 branch rejoin** is not started; its financial-state semantics still need agreement.
- **Unsupported seed fields:** `invoice.collection` and `bill.agreedPayOn` still reject. The sim does not produce them today.
- **Responses:** TL7 tested responses do not clear the pre-existing runway-policy breach for Osprey, so its risk cards show the failure reason rather than a response. The weighted scenario index is 0.00.
- **Stale runs:** a Timeline run is not refreshed automatically when the sim clock ingests new books. The dashboard marks it stale and offers a re-import.
- **Assumptions provenance:** the model and constraints Field passes are copied into Timeline's frozen run as reviewed assumptions. A first-class shared model and rule exchange remains a contract checkpoint.
- **Analysis start:** Open in Timeline starts TL7 analysis on the click. If the lead prefers a separate reviewed start, drop step 4 in `fieldTimeline.ts`.
- **Root `HANDOFF.md`** was not updated by this worker. The integration owner should do it.
