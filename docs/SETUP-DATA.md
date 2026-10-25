# Demo data setup

A fresh checkout has an empty Convex database. Pick one path:

- **A. Local deployment, deterministic seed** (recommended for development).
- **B. Local deployment, import a full export** (exact copy, including past agent runs and AI output).
- **C. Read the shared prod deployment** (no local backend; you see the live demo data).

Never commit `.env.local`, export zips, or key values. Convex exports exclude deployment env vars,
but they include tables such as `vendorWebhookSecrets` (simulated webhook signing secrets), so
treat a zip as private.

## Prerequisites

```sh
git clone https://github.com/micahlai/domino-ai.git && cd domino-ai
source ~/.nvm/nvm.sh && nvm install 24 && nvm use 24
corepack enable && pnpm install --frozen-lockfile
```

## Start a local Convex backend

From `apps/web`, in its own terminal (leave it running; it pushes functions on every change):

```sh
cd apps/web
CONVEX_AGENT_MODE=anonymous npx convex dev      # coding agents: no login, local backend
# or, as a person: npx convex dev   (choose "local" when asked)
```

This writes `apps/web/.env.local` with `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL`. Wait for "Convex functions ready!".

## A. Deterministic seed

From the repo root, with `convex dev` running:

```sh
pnpm data:setup
```

It runs, all idempotent (safe to rerun):

1. `field:setupAll`: the four picker companies (Kestrel Data, Harrier Analytics, Merlin Metrics,
   Osprey Insights), seed 1, with their first ingest.
2. `fieldOperating:ensure` plus `fieldAgents:start` for every operating demo (2U, Asana-inspired,
   GitLab-inspired, current Asana/GitLab) times every scenario (baseline, late payments,
   customer loss, unexpected expense).
3. `fieldTimeline:openInTimeline` for each: the deterministic "Bring in latest books" import
   that saves its timeline baseline.

Takes about 80 seconds. Expect `ok` lines only, with no `FAIL` lines. `SKIP_TIMELINE=1 pnpm data:setup`
skips step 3.

Not reproduced by the seed: sandbox "Judge Co." companies (created per visitor on `/judge`),
past agent runs, analyst scenarios and AI explanations. Those need `ANTHROPIC_API_KEY` set on
the deployment and the agents to run, or path B.

## B. Import a full export

Get a zip from a teammate who can read the source deployment (`npx convex export --path
/abs/path/domino-data.zip`, run from `apps/web`). It is about 18 MB, so it is not committed. Then:

```sh
pnpm data:import /abs/path/domino-data.zip     # replaces ALL data in your local deployment
```

Use an absolute path (the command runs from `apps/web`).

## Run the app

```sh
pnpm --filter @domino/web dev:web     # Next.js on http://127.0.0.1:3000
```

(`pnpm --filter @domino/web dev` starts both `convex dev` and Next.js together instead.)

## Verify

```sh
cd apps/web
npx convex run field:companies                  # 4 companies with names and health
npx convex run fieldOperating:list              # 20 operating demos after path A
```

In the browser: `/field`, `/judge`, `/case/2u/backtest`, and
`/c/operating%2F2u%2Fbaseline/timeline` should show a cash chart, not "No saved scenarios yet".

## C. Point at the shared prod deployment

No local backend; reads the live demo data at `knowing-bee-636`:

```sh
cd apps/web
NEXT_PUBLIC_CONVEX_URL=https://knowing-bee-636.convex.cloud npx next dev --hostname 127.0.0.1
```

This is not enforced read-only: buttons in the UI call public mutations and write to the shared
demo. Avoid Play, Start agents, Reset and imports on prod. Never run `convex dev`, `deploy`,
`import` or `run` with `--prod` unless you own the deployment. Public site:
https://domino-ruddy.vercel.app

## Environment variable names

Set on the Convex deployment with `npx convex env set NAME` (values from a teammate, never in git).
All are optional for the seeded demo:

- `ANTHROPIC_API_KEY`: Claude calls (agents, explanations, Ask Domino). Model overrides:
  `ANTHROPIC_MODEL`, `TIMELINE_ASSISTANT_MODEL`, `TIMELINE_QUESTIONS_MODEL`; cap: `FIELD_AI_HOURLY_CAP`.
- `NESSIE_API_KEY`, `NESSIE_BASE_URL`: Capital One Nessie connector.
- `APIFY_TOKEN`: Apify web sources.
- `CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY`, `CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID`,
  `DOMINO_CREAO_VERIFIED_PROFILES`: CREAO agent apps.
- `CRS_USERNAME`, `CRS_PASSWORD`: CRS checks.

Next.js only needs `NEXT_PUBLIC_CONVEX_URL` (written by `convex dev`, or set by hand for path C).
