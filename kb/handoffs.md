# Handoffs

Newest first. One short entry at the end of every task or work session.
Format: `## YYYY-MM-DD HH:MM Name` then three lines: Done / Next / Watch out.

## 2026-10-24 01:07 Micah (Codex, dark theme and logo)
- Done: applied the supplied mint/clay/rose/green/brown palette as the default dark theme, with readable off-white text and accessible warning text. Reused the original two-tile Domino SVG from calhacks-2026 for the header and favicon; preserved geometry and wordmark dot. Checks (56 tests), build and desktop screenshot review pass.
- Next: P3 and P4 use these semantic tokens; continue sequential worktrees and merge each task.
- Watch out: mint is both selection and survival, so chart labels and outcome symbols must distinguish them. Rose fills/strokes stay #BA6A68; small warning text uses a lighter derived shade for contrast.

## 2026-10-24 00:57 Micah (Codex, P1 merge/P2)
- Done: merged P1 with the latest mocks-only main and pushed merge `20ba4ed`. P2 adds all 14 tables and query functions, five mutations, contract parsing, transactional approvals, action placeholders, and `pnpm convex:fixtures`. 21 new backend/parser tests; `pnpm check` (56 total), `pnpm build`, frozen install and all 14 live local queries pass. Seed rerun creates no duplicates and preserves decisions. Kestrel is visible as ready in the local Convex dashboard.
- Next: P3 builds the hero; P4 wires screens to these queries. Use the company ID returned by the seed, not the literal route stub `kestrel`. Jayden replaces the internal action placeholders in E5/E7; see `kb/spec/convex-api.md` and `apps/web/convex/README.md`. P2 is on `codex/p2-convex`.
- Watch out: `sources.lastPull` is null until an actual pull. Fixture tie-outs are pending; approvals/grades/explanations stay empty until real results. Action placeholders throw `not built`; no money moves. Anonymous demo decisions are labeled unverified; production company access controls remain outside this demo. P2 changes are isolated from unrelated local edits in the primary checkout.

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
