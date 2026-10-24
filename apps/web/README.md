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

## What P1 includes

- All seven routes from `kb/spec/design-spec.md` §1. Company screens are heading stubs.
- Every §4 component plus the hero has a preview backed by `@domino/contracts/fixtures`.
- The timeline, branch chart and learning chart are layout/data/empty-state stubs.
- The fix toggle, risk selection, evidence sheet and event dialog work locally.
- Simulation and approval buttons remain disabled until their owning task wires them.
- `formatCents` formats safe integer cents; `formatDate` validates dates and uses UTC.
- Inter and the design-spec §5 light theme tokens. Reduced motion is respected.

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
