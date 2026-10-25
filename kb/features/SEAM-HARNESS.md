# Feature seam harnesses (P0-H)

Boundary smoke tests for the frozen Field -> Timeline seam (`packages/contracts/src/feature-boundary.ts`, boundary 1.0.0). They are not the Field or Timeline features. Every seed shown is a labelled P0-C peer fixture, never output of a peer backend.

## Routes

| Route | Owner | What it proves |
| --- | --- | --- |
| `/playground/field-seam` | Field | Exports the valid 2U TimelineSeedV1 as JSON text (view + download) and shows server-side recomputed hashes for all five P0-C fixtures. |
| `/playground/timeline-seam` | Timeline | Imports seed JSON text (fixture buttons or paste), verifies it in the browser with Web Crypto, requires forecast-ready, then renders it through the unchanged `buildView` + `HistoricalReplay`. Blocked and mismatched seeds are rejected. |

Both are static, provider-free and need no Convex backend.

## Isolated commands (Node 24, from the repo root)

```sh
source ~/.nvm/nvm.sh && nvm use 24
pnpm install --frozen-lockfile            # once per checkout

# Frontend only: no Convex client is created when the URL is empty.
NEXT_PUBLIC_CONVEX_URL= pnpm --filter @domino/web dev:web --port 3107
# open http://127.0.0.1:3107/playground/field-seam and /playground/timeline-seam

# Checks
pnpm --filter @domino/web exec vitest run lib/feature-boundary components/field/seam components/timeline/seam
pnpm --filter @domino/web exec tsc --noEmit --incremental false
pnpm --filter @domino/web exec tsc --noEmit -p convex
NEXT_PUBLIC_CONVEX_URL= pnpm --filter @domino/web build
```

Pick any free port; never use 3102, 3210 or 3214 on Jayden's machine (preserved backends and servers). A lane's own real backend runs on its owner's machine with its own local deployment, for example `cd apps/web && npx convex dev --local --local-cloud-port <free> --local-site-port <free>` (not run by P0-H). Never point a branch at another person's or the preserved deployment, and never share a mutable development database.

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

## Namespace and import inventory

| Lane | Owns (P0-H files in bold) | May import |
| --- | --- | --- |
| Field | `app/investigate/**`, `app/case/2u/page.tsx`, `app/case/2u/company/**`, `app/playground/agent-canvas/**`, **`app/playground/field-seam/**`**, `components/investigate/**`, `components/case-workspace/CompanyView.tsx`, **`components/field/**`** | contracts, engine, shared `lib/**` (incl. `lib/feature-boundary`), `components/ui/**`, its own folders |
| Timeline | `app/historical/**`, `app/case/2u/simulations/**`, **`app/playground/timeline-seam/**`**, `components/historical/**`, `components/case-workspace/{SimulationList,SimulationDetail,Saved}.tsx` and `summary.ts`, **`components/timeline/**`** | contracts, engine, shared `lib/**`, `components/ui/**`, its own folders |
| Shared, frozen | `lib/feature-boundary/**`, `components/ui/**`, `app/layout.tsx`, `AppShell`, global CSS/tokens, `app/playground/page.tsx` + `components/Playground.tsx` | contracts, engine only |

Rules: Field files never import `components/timeline/**`, `components/historical/**` or `app/historical/**`; Timeline files never import `components/field/**`, `components/investigate/**` or `app/investigate/**`. Peer data crosses only as JSON text through `lib/feature-boundary/verify.ts`. Current state (checked with grep at P0-H): `components/field/seam` imports only `lib/feature-boundary/verify` and `components/ui/badge`; `components/timeline/seam` imports only `lib/feature-boundary/verify`, `components/historical/*` (Timeline-owned) and `components/ui/*`. The existing Playground preview (shared) still imports `components/historical/*` read-only.

Quick import audit:

```sh
grep -rnE "components/(timeline|historical)|app/historical" apps/web/components/field apps/web/app/playground/field-seam
grep -rnE "components/(field|investigate)|app/investigate" apps/web/components/timeline apps/web/app/playground/timeline-seam
```
