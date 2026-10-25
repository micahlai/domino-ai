# Setup

How to run Domino locally. For loading demo data, see [SETUP-DATA.md](SETUP-DATA.md).

## 1. Tools

- Node 20+ (24 recommended), pnpm 9

```sh
git clone https://github.com/micahlai/domino-ai.git && cd domino-ai
corepack enable
pnpm install --frozen-lockfile
```

## 2. Keys

```sh
cp .env.example .env.local        # fill in values from the team password manager
```

Never commit `.env`, `.env.local` or key values. The Convex backend does **not** read these files:
server-side keys must also be set on your Convex deployment (step 3).

## 3. Convex backend

From `apps/web`, in its own terminal (it pushes functions on every change):

```sh
cd apps/web
npx convex dev                                   # choose "local" when asked
# coding agents: CONVEX_AGENT_MODE=anonymous npx convex dev
```

This writes `apps/web/.env.local` with `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL`. Each worktree keeps its own deployment in `apps/web/.convex`, so a
new worktree starts empty and without keys.

### Claude (Anthropic) key

1. Create a key at console.anthropic.com → Settings → API Keys.
2. Set it on Convex without putting it in shell history:

```sh
cd apps/web
read -s "K?Anthropic key: " && npx convex env set ANTHROPIC_API_KEY "$K"; unset K
npx convex env set ANTHROPIC_MODEL claude-opus-5-5
```

`ANTHROPIC_MODEL` is required; a missing model is a config error and no request is sent.
Optional: `TIMELINE_ASSISTANT_MODEL`, `TIMELINE_QUESTIONS_MODEL`, `FIELD_AI_HOURLY_CAP`.

### Other server keys (all optional for the seeded demo)

Set each with `npx convex env set NAME`:

| Variable | Used for |
| --- | --- |
| `NESSIE_API_KEY`, `NESSIE_BASE_URL` | Capital One Nessie bank connector |
| `APIFY_TOKEN` | Apify counterparty news signals |
| `CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY`, `CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID`, `DOMINO_CREAO_VERIFIED_PROFILES` | CREAO agent apps |
| `CRS_USERNAME`, `CRS_PASSWORD` | CRS identity and fraud checks (test data) |

### CREAO agent apps

```dotenv
CREAO_API_BASE_URL=https://agent.creao.ai/api/v1
CREAO_AGENT_ID_MAPSOURCE=<your mapping agent ID>
CREAO_AGENT_ID_CONSTRAINTS=<your constraints agent ID>
CREAO_AGENT_ID_BRIEF=<your brief agent ID>
```

Runs start at `POST /apps/{agentId}/runs` relative to the base URL, with bearer auth and an
`inputs` object. See the [CREAO starter pack](https://community.creao.ai/AI_hackathon_UCLA2026/tech)
and [API Trigger guide](https://docs.creao.ai/pro/api-trigger). If a CREAO call fails, the
coordinator falls back to Claude.

## 4. Demo data

With `convex dev` running, from the repo root:

```sh
pnpm data:setup          # deterministic seed, about 80 seconds, idempotent
```

Other options (import a full export, or read the shared prod deployment) are in
[SETUP-DATA.md](SETUP-DATA.md). Never run a seed or reset against the shared demo database.

## 5. Run

```sh
pnpm --filter @domino/web dev:web     # Next.js on http://127.0.0.1:3000
# or everything (web, Convex, mock servers):
pnpm dev
```

## 6. Check before you push

```sh
pnpm check        # typecheck, tests, lint
```

## Working in this repo

Rules for people and coding agents are in [AGENTS.md](../AGENTS.md). In short:

1. Pull, then read `kb/status/board.md` and the latest entries in `kb/handoffs.md`.
2. Pick a task card from `kb/tasks/` (or the next prompt in `prompts/`).
3. Work on a short branch. `main` must pass `pnpm check`.
4. Update the board and add a handoff note before you push.
