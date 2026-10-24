# S0 · Machine setup (both)

Run by: you, by hand (about 20 minutes). Then optionally ask an agent to verify.

## Steps

1. Install Node 20+ and enable pnpm: `corepack enable`.
2. Clone the repo and install: `pnpm install`.
3. Copy keys: `cp .env.example .env.local`. Fill values from the team password manager.
4. Accounts (join all): GitHub repo, Vercel team, Convex team, Anthropic console, Stripe (test mode), Capital One Nessie, CREAO (agent.creao.ai), Figma (Edu verified).
5. Check: `pnpm check` passes.
6. Install agent tools you use: Claude Code, Codex, Cursor. Open the repo once in each so they read `AGENTS.md`.
7. Micah only: after P1 creates `apps/web`, run `cd apps/web && npx convex dev` (your own dev deployment). Jayden does the same after pulling P1.
8. Figma: turn on the Dev Mode MCP server in the Figma desktop app, and add it to Claude Code / Cursor so agents can read frames.

## Prompt (optional check, Claude Code)

```
Load the kb-sync skill. Verify my setup: run pnpm install and pnpm check, confirm .env.local has every key name
from .env.example (do not print values), and list anything missing. Then set my S0 row in kb/status/board.md to done
and add a one-line handoff. Do not change any other files.
```
