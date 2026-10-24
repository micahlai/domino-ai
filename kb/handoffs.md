# Handoffs

Newest first. One short entry at the end of every task or work session.
Format: `## YYYY-MM-DD HH:MM Name` then three lines: Done / Next / Watch out.

## 2026-10-24 01:10 Micah (Codex, CREAO agents and environment)
- Done: created three private Domino agents in Chrome, saved the shared local key and all three IDs in ignored root `.env`, and completed mock API runs for every job. Mapping JSON and corrected constraint content pass contract validators; brief content cites the supplied grade/model. All agents have Ask first autonomy, no connectors and no schedules. `pnpm check` passes (35 tests, typecheck, lint).
- Next: E6 implements the adapter using the endpoint and response-format findings in `kb/research/sponsors.md`. Public judging share links remain outstanding; owner-access test runs are linked there.
- Watch out: `result.text` contains memory metadata. Actual outputs vary between JSON attachments and narrated `chatText`, so strict raw output is not reliable. The corrected Constraint Reader v1.1.0 keeps the same ID and uses the literal source category `document`. Other S0 account/integration access remains unverified.

## 2026-10-24 00:56 Micah (Codex, CREAO environment)
- Done: inspected CREAO in Chrome and populated only `CREAO_API_BASE_URL` in ignored root `.env` with the documented app API prefix, `https://agent.creao.ai/api/v1`. `pnpm check` passes (35 tests, typecheck, lint).
- Next: confirm creation of a new local API key and the three Domino job agents; then save the key and their IDs locally. Existing keys are not revealable and only Forecast Lab Worker exists.
- Watch out: app-scoped keys run only one agent. Developer Console `/v2` is a separate USD-billed product with zero balance; do not mix its keys or hosted agent IDs with chat API/CLI `/v1`. No keys or agents were created.

## 2026-10-24 00:33 Micah (Codex, S0/P1)
- Done: installed 10 active project skills for Codex; Corepack/pnpm 9.12.0 and frozen install verified. P1 web shell, all seven routes, ten shadcn primitives, fixture playground, formatting helpers with 22 tests, local Convex and generated bindings. `pnpm check` (35 tests total) and `pnpm build` pass. Browser reviewed at 582 px and 1280 px; fix toggle, proof drawer and event preview work. Root dev starts both services; Ctrl+C stops both.
- Next: P2 implements the confirmed tables in `kb/spec/convex-api.md`, queries/mutations and fixture seed. P3 builds the interactive hero from the layout stub. Vercel setup is documented in `apps/web/README.md`.
- Watch out: S0 local work is complete; cloud team membership and shared integration credentials remain unverified/unfilled. Local `.env.local` and `.convex/` stay ignored. The charts and company screens are P1 stubs; no approvals or external actions are connected. Figma requirements were removed from the frontend scope, including P3/P7/P8 and submission.

## 2026-10-24 00:18 Jayden (S0 check, agent)
- Done: `pnpm install` and `pnpm check` pass (via corepack; 13 contract tests).
- Next: `cp .env.example .env.local`, fill every key, then mark S0 done.
- Watch out: accounts, Convex dev, and Figma MCP steps not verified by the agent.

## 2026-10-24 00:00 Jayden (setup)
- Done: repo scaffold, contracts with Zod and fixtures (incl. multiverse), knowledge base, specs, prompts, skills, .env.example.
- Next: Micah runs S0 then P1. Jayden runs S0 then E1 and E3 in parallel.
- Watch out: fill `.env.local` from the password manager; never commit keys. CREAO API details are unconfirmed (no booth); test one call early.
