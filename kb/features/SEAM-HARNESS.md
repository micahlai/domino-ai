# Feature seam harnesses (P0-H)

Boundary smoke tests for the frozen Field -> Timeline seam (`packages/contracts/src/feature-boundary.ts`, boundary 1.0.0). They are not the Field or Timeline features. Every seed shown is a labelled P0-C peer fixture, never output of a peer backend.

## Routes

| Route | Owner | What it proves |
| --- | --- | --- |
| `/playground/field-seam` | Field | Exports the valid 2U TimelineSeedV1 as JSON text (view + download) and shows server-side recomputed hashes for all five P0-C fixtures. |
| `/playground/timeline-seam` | Timeline | Imports seed JSON text (fixture buttons or paste), verifies it in the browser with Web Crypto, requires forecast-ready, then renders it through the unchanged `buildView` + `HistoricalReplay`. Blocked and mismatched seeds are rejected. |

Both pages are provider-free. Each has a **Backend smoke** panel that runs ONE existing read-only public query against the lane's own local backend when `NEXT_PUBLIC_CONVEX_URL` is set: Field runs `investigationCatalog.list` for case `twou-2023-cash-v1`; Timeline runs `historical.getCase` for the same case. With the URL empty the panel says "Backend not configured" and the rest of the page still works. No mutation, seeding or provider call.

P0-H evidence (2026-10-24, worktree domino-P0H): a NEW anonymous local backend on 3240/3241, dev server on 3107. Field got `0 saved investigation(s), isDone true`. Timeline got `2U, Inc., 7 facts, cutoff 2023-11-10T23:59:59-05:00, revealed false`. Codegen left tracked `_generated` byte-identical. Both processes were stopped afterwards.

## Isolated commands (Node 24, from the repo root)

```sh
source ~/.nvm/nvm.sh && nvm use 24
pnpm install --frozen-lockfile            # once per checkout

# Frontend only: no Convex client is created when the URL is empty.
NEXT_PUBLIC_CONVEX_URL= pnpm --filter @domino/web dev:web --port 3107
# open http://127.0.0.1:3107/playground/field-seam and /playground/timeline-seam

# With a real, isolated local backend (two terminals, from apps/web). CONVEX_AGENT_MODE=anonymous
# makes the CLI create a NEW anonymous local deployment for this checkout (state in the
# git-ignored apps/web/.convex/ and .env.local). Never copy .env.local from another checkout.
# convex 1.48.0 rejects --local; leaving it out with no deployment configured selects local.
CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3240 --local-site-port 3241 --tail-logs disable
pnpm dev:web --port 3107      # reads NEXT_PUBLIC_CONVEX_URL from the new .env.local

# Checks
pnpm --filter @domino/web exec vitest run lib/feature-boundary components/field/seam components/timeline/seam
pnpm --filter @domino/web exec tsc --noEmit --incremental false
pnpm --filter @domino/web exec tsc --noEmit -p convex
NEXT_PUBLIC_CONVEX_URL= pnpm --filter @domino/web build
```

Check ports with `lsof -iTCP:<port> -sTCP:LISTEN` first and pick free ones. Never use 3102, 3210, 3214, 3230 or 3231 on Jayden's machine (preserved backends and servers). Never point a branch at another person's or the preserved deployment, and never share a mutable development database. Stop both processes when done.

Build note: the default `pnpm --filter @domino/web build` (Turbopack) passes outside sandboxes (P0-H runs). Codex's sandbox blocks Turbopack's port binding, so a build failure there is an environment limit, not a code failure.

## Verifier contract (shared, frozen with P0)

`apps/web/lib/feature-boundary/verify.ts` is the consumer-side check both lanes use:

1. Parse JSON text with the frozen `parse*Json` function (never the object schemas).
2. Recompute SHA-256 (Web Crypto) over `canonicalJson`: snapshot and seed `contentHash` digest `contentHashPreimage(record)`; `snapshotRef.contentHash` must equal the recomputed snapshot hash.
3. Result refs and reveals are verified through the context parsers against a verified seed.
4. Optional `expectedFixtureHash` pins the whole-value digest (needed for records without a self-hash).

Verified fixture hashes (recomputed, equal to `FEATURE_BOUNDARY_FIXTURE_HASHES`):

| Fixture | fixtureHash | contentHash / snapshot | Verifier outcome |
| --- | --- | --- | --- |
| validTwoUSeed | 7f8a48bc...043644 | ec648c0c...9fe2ef / 691c60f0...d1c11b | verified, forecast-ready |
| blockedSeed | ac9b114a...af3392 | eb38f85f...91ea00 / 54ca5b9c...6a99c9 | verified, rejected as forecast input |
| mismatchedSeed | 884e5a69...ee76dd | n/a | rejected (snapshotRef names other content) |
| savedResultRef | 3847404c...89fbe6 | n/a | verified against validTwoUSeed |
| postRevealTwoU | 9def5cd4...3bb77c | n/a | verified against validTwoUSeed |

## Weekly seam v2 (P0 v2)

`packages/contracts/src/weekly-boundary.ts`: WeeklySeedV1 (`parseWeeklySeedJson`) and WeeklyResultRefV1 (`parseWeeklyResultRefJson`), same JSON-text and hash rules as P0-C. `/playground/field-seam` exports the Kestrel weekly fixture as JSON text; `/playground/timeline-seam` verifies it with `verifyWeeklySeedText` and shows company, asOf, scheduled items and findings. The tampered copy is rejected by the recomputed hash. Pins: `WEEKLY_BOUNDARY_FIXTURE_HASHES`.

P0 v2 ownership: Timeline also owns `app/c/**`, `components/{company,multiverse}/**` and the top-level weekly components used by `/c/[companyId]` (see `apps/web/scripts/lane-imports.mjs`). Convex tables: Field owns companies, sources, snapshots, models, constraints, approvals, log; Timeline owns risks, branches, fixes, resilience, history, grades, explanations. `convex/schemas/legacy.schema.ts` keeps only the shared `companyId` validator.

## Namespace and import inventory

| Lane | Owns (P0-H files in bold) | May import |
| --- | --- | --- |
| Field | `app/investigate/**`, `app/case/2u/page.tsx`, `app/case/2u/company/**`, `app/playground/agent-canvas/**`, **`app/playground/field-seam/**`**, `components/investigate/**`, `components/case-workspace/CompanyView.tsx`, **`components/field/**`**, `convex/investigation.ts` + `convex/tests/investigation.test.ts`, `convex/field/**`, `convex/schemas/field.schema.ts` | contracts, engine, shared files, its own folders |
| Timeline | `app/historical/**`, `app/case/2u/simulations/**`, **`app/playground/timeline-seam/**`**, `components/historical/**`, `components/case-workspace/{SimulationList,SimulationDetail,Saved}.tsx`, `summary.ts`, `case-workspace.test.tsx`, **`components/timeline/**`**, `convex/historical.ts`, `convex/investigationCatalog.ts` (+ tests), `convex/timeline/**`, `convex/schemas/timeline.schema.ts` | contracts, engine, shared files, its own folders |
| Shared, frozen | `lib/**` (incl. `lib/feature-boundary/**`), `components/ui/**`, `app/layout.tsx`, `AppShell`, global CSS/tokens, `app/playground/page.tsx`, `components/Playground.tsx`, `components/case-workspace/{CaseNav.tsx,links.ts}`, `convex/schema.ts`, `convex/lib/**`, `convex/_generated/**` | contracts, engine; existing imports stay as they are |

Rule for new code: NO new cross-lane imports. Peer data crosses only as JSON text through `lib/feature-boundary/verify.ts`. The P0-H harness files have zero cross-lane imports. `components/timeline/seam` imports only Timeline-owned `components/historical/*`, shared `lib/feature-boundary` and `components/ui`. `components/field/seam` imports only shared files and `convex/_generated/api`.

Reproduce the inventory (resolves relative `../` and `@/` imports; exits 1 if a harness file gains a cross-lane import):

```sh
node apps/web/scripts/lane-imports.mjs
```

### Frozen legacy exceptions (pre-existing at base 664ab45)

18 cross-lane imports: 15 production, 3 test. Unchanged after P0 v2 (rerun on branch P0-v2-weekly-seam: still 18, 0 in harness files). Each is frozen. It may be deleted by its importing lane but never widened. The OWNER of the imported module must keep the listed exports and their signatures/props backward compatible until a coordinated checkpoint removes the edge.

| Importer (lane) | Line | Imports | Owner keeping it stable |
| --- | --- | --- | --- |
| `components/case-workspace/CompanyView.tsx` (Field) | 5 | `formatReportDate` from `components/historical/format.ts` | Timeline |
| `components/case-workspace/CompanyView.tsx` (Field) | 9 | `NeedsService`, `NoInvestigation`, `Pending`, type `Saved`, `useSaved` from `components/case-workspace/Saved.tsx` | Timeline |
| `components/investigate/live/CompanyKnowledge.tsx` (Field) | 9 | `formatReportDate` from `components/historical/format.ts` | Timeline |
| `components/investigate/live/CompanyKnowledge.tsx` (Field) | 10 | `CASE_ID` from `components/historical/live.ts` | Timeline |
| `components/investigate/live/FinancialOutput.tsx` (Field) | 6 | `HistoricalReplay` (props `HistoricalReplayProps`/`HistoricalView`) from `components/historical/HistoricalReplay.tsx` | Timeline |
| `components/investigate/live/FinancialOutput.tsx` (Field) | 7 | type `AlternativeData`, `AlternativeDataSchema`, `BaselineDataSchema`, `CASE_ID`, `CaseDataSchema`, `RevealDataSchema`, `alternativeIssue`, `buildView` from `components/historical/live.ts` | Timeline |
| `convex/investigation.ts` (Field) | 31 | `CASE`, `CUTOFF`, `computeAlternativeIn`, `fail`, `loadRun`, `requireRequestId`, `revealIn`, `saveBaselineIn`, `visibleCase` from `convex/historical.ts` | Timeline |
| `components/case-workspace/Saved.tsx` (Timeline) | 7 | `readConversation` from `components/investigate/live/InvestigateLive.tsx` | Field |
| `components/case-workspace/Saved.tsx` (Timeline) | 8 | types `Adapted`, `Conversation`, `adaptConversation` from `components/investigate/live/adapt.ts` | Field |
| `components/case-workspace/SimulationDetail.tsx` (Timeline) | 6 | `STATUS_LABEL` from `components/investigate/graph.ts` | Field |
| `components/case-workspace/SimulationDetail.tsx` (Timeline) | 7 | `FinancialOutput` from `components/investigate/live/FinancialOutput.tsx` | Field |
| `components/case-workspace/SimulationDetail.tsx` (Timeline) | 8 | `InvestigateLive` from `components/investigate/live/InvestigateLive.tsx` | Field |
| `components/case-workspace/SimulationDetail.tsx` (Timeline) | 9 | types `Adapted`, `Conversation` from `components/investigate/live/adapt.ts` | Field |
| `components/case-workspace/SimulationList.tsx` (Timeline) | 5 | type `Conversation` from `components/investigate/live/adapt.ts` | Field |
| `components/case-workspace/summary.ts` (Timeline) | 1 | type `Conversation` from `components/investigate/live/adapt.ts` | Field |
| test: `components/case-workspace/case-workspace.test.tsx` (Timeline) | 22 | type `Conversation`, `adaptConversation` from `components/investigate/live/adapt.ts` | Field |
| test: `components/case-workspace/case-workspace.test.tsx` (Timeline) | 24 | `CompanyBody` from `components/case-workspace/CompanyView.tsx` | Field |
| test: `convex/tests/investigation.test.ts` (Field) | 12 | `CASE`, `CUTOFF` from `convex/historical.ts` | Timeline |

All paths are under `apps/web/`. The script counts `convex/investigation.ts:31` as production, which may explain a count of 15 versus an audit count of 14. Side-effect-only imports (`import "x"`) are not scanned. None cross lanes today.
