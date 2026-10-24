# Domino web

Next.js App Router, React, TypeScript, Tailwind, shadcn/ui and Convex. Owner: Micah.
Design and prototypes live in `/playground`; the frontend targets Vercel.

## Run locally

From the repository root, with Node 20.9+ and the pinned pnpm version:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open [the playground](http://127.0.0.1:3000/playground).
The root Turbo task starts the web package. Convex configures the backend and generates
bindings before starting Next with its built-in `--run-sh` option. Both services stay
running together; Ctrl+C stops them together.
With no cloud deployment selected, Convex provisions a local backend on port 3210.
The first run downloads the official backend binary and needs network access.
Generated bindings in `convex/_generated/` are committed; `.convex/` and local environment
files are ignored. Copy `.env.example` to root `.env.local` for later integrations.
The Convex CLI maintains `apps/web/.env.local`; do not replace it with blank values.

For separate terminals:

```sh
pnpm --filter @domino/web dev:convex
pnpm --filter @domino/web dev:web
```

To use your team’s cloud development deployment, run `pnpm exec convex dev --configure`
in `apps/web` and select the team and project. No external service key is needed for
P1’s fixture playground. Live queries, mutations and source integrations belong to P2 onward.

## Current product screens

- All seven routes from `kb/spec/design-spec.md` §1. The company main screen is live; other company routes remain P1 previews until P5/P6.
- Every §4 component plus the hero has a preview backed by `@domino/contracts/fixtures`.
- The hero timeline has animated history/futures, selection and fix comparison. Branch and learning charts remain previews.
- The fix toggle, risk selection, evidence sheet and event dialog work locally.
- Live approvals require a matching saved fix branch and confirmation. New simulation, event and next-week actions remain disabled until E7 is ready.
- `formatCents` formats safe integer cents; `formatDate` validates dates and uses UTC.
- Inter and the design-spec §5 dark brown, green, pink and orange tokens. Reduced motion is respected.

## Check and build

```sh
pnpm check
pnpm --filter @domino/web build
```

`pnpm check` includes formatting unit tests, workspace types, tests and Biome.
Builds also work without `NEXT_PUBLIC_CONVEX_URL` for the fixture-only shell. When
configured, the root `ConvexClientProvider` validates the URL and supplies the client.

## Vercel

Import this monorepo, select the Next.js preset and set **Root Directory** to `apps/web`.
Include files outside the root directory so `@domino/contracts` resolves. Use the
repository lockfile and package manager; keep the Next.js default output directory.
Set `NEXT_PUBLIC_CONVEX_URL` to the selected cloud deployment URL, never localhost.
Server-only integration keys belong in Convex, not in `NEXT_PUBLIC_*` variables.
Configure automatic Convex deployment with P2’s real schema and backend functions;
P1 does not publish or mutate a production deployment.

Vercel monorepo settings: [official setup guide](https://vercel.com/docs/monorepos/turborepo).
Convex local setup: [official agent guide](https://docs.convex.dev/cli/agent-mode).

## P4 company workspace

`/c/<companyId>` uses the Convex company document ID returned by `pnpm convex:fixtures`.
It subscribes to company, reports with/without fixes, history, constraints, risks, branches
and the selected branch’s fixes. A future must match every selected risk before its
chain and fixes are shown; missing combinations have an explicit empty state.

`/c/kestrel` is a labeled sample preview with local-only approval previews. To make
this shortcut open the seeded company, set `NEXT_PUBLIC_DEMO_COMPANY_ID` to the seed’s
company ID alongside `NEXT_PUBLIC_CONVEX_URL` in ignored `apps/web/.env.local`.
The assembled sample workspace also appears in `/playground`.

Approval records a decision and changes the matching fix branch’s status; it does not
execute the fix. This demo has no sign-in and labels anonymous decisions unverified.
`components/company/LiveCompany.tsx` keeps compute actions disabled until E7 replaces
the internal placeholders. Enable the corresponding readiness flags only after those
actions are implemented and tested. The mutation callbacks are already connected.
