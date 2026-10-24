# Handoffs

Newest first. One short entry at the end of every task or work session.
Format: `## YYYY-MM-DD HH:MM Name` then three lines: Done / Next / Watch out.

## 2026-10-24 02:28 Codex brain (E3b-r1 review)
- Done: independently audited clean 565c3fa; full branch check passes 178 tests/typechecks/lint. Lead reproduced 320 passing daily/weekly rounding cases, 15 duplicate-bill rejections and four receipt-loss cases. Original unrelated-expense false arrow is fixed. One remaining blocker: whole-customer churn removal falsely proves a record/drop cause; two exact cases are in the new review.
- Next: Claude continues the existing E3b worktree using kb/tasks/E3b-r2-causal-scope.md copied from main. Scope proof to the candidate's cash effect or omit ambiguous arrows. Re-review before E3b merge or E4 launch.
- Watch out: E3b remains unmerged; branch checks are not combined with current P3/P4 main. Main's prior 147-test UI integration remains intact. No feature edits or worker-checkout changes by Codex; particles remain deferred.

## 2026-10-24 02:23 Codex brain (main integration, particle work deferred)
- Done: integrated origin/main 687b91f (P3/P4, theme/copy, CREAO notes), preserving both knowledge histories and local README setup notes. Independent review found a C1 risk-identity mismatch in P4 selection; isolated Claude I1 fixed only the helper/tests, and Codex re-review passed. Combined 147 tests, typechecks, lint and fresh production build pass; browser preview/selection/empty-state check passed.
- Next: finish auditing Claude's E3b repairs when returned, then integrate before E4. E6b provider adapters and safe seed backfill remain separate. Particle branch is explicitly deferred.
- Watch out: no particle commits or E3b changes included. Environment files, uncommitted .env.example and unrelated web/CREAO files preserved. Browser used sample data and saved no approvals. No push, deployment, reset or worktree deletion.

## 2026-10-24 02:08 Codex brain (E3b independent audit)
- Done: audited clean Claude commit e77474d with independent Astra rules review and GPT-6.1 Sol causal review; lead forced check passes 169 tests, typechecks and lint. Lead reproduced three defects with schema-valid inputs: weekly hire savings misdate daily funds, causal arrows blame unrelated events, duplicate bill IDs corrupt deadline results. Review and repair card committed in main.
- Next: Claude copies kb/tasks/E3b-r1-funding-causes.md from main into its existing E3b worktree, implements the scoped repairs and returns a commit for re-review. E4 stays gated.
- Watch out: E3b not merged; no feature code written or worker checkout modified by Codex. Main still awaits remote UI integration identified earlier. Unrelated environment/README/CREAO/web tooling work preserved.

## 2026-10-24 01:46 Codex brain (Claude implementation handoff)
- Done: integrated reviewed E3a repair at 59fe62d; combined 131 tests, typechecks, lint and fresh production build pass. User assigned both E3b/E4 implementation to Claude, with Codex auditing/checking. Prepared the E3b branch/worktree from passing main.
- Next: human launches Claude Code in ../domino-E3b using kb/tasks/E3b-dominoes.md. Return the completed commit to Codex for independent audit and integration; only then launch E4.
- Watch out: no Claude feature worker launched by Codex. Raw fixture guard remains until E3b. Existing Claude E3a checkout and unrelated README/CREAO/web tooling work preserved. No push/deployment/data reset.

## 2026-10-24 01:45 Micah (Codex, plain timeline copy)
- Done: ran humanizer and taste on timeline copy. Replaced future/survival/break metaphors with cash forecasts, scenarios, cash requirements and projected impact; updated navigation, page title, accessibility text, empty states and playground descriptions. Renamed Apply fixes to Preview fixes and explained score weighting. Browser verified revised labels and the 7-to-9 scenario preview; checks and production build pass.
- Next: use the updated design-spec wording table for P5/P6.
- Watch out: contract identifiers, chart geometry, financial values and calculation behavior are unchanged. The score is a weighted share of tested scenarios, not an unconditional likelihood. Screenshot: /tmp/domino-plain-copy.png.

## 2026-10-24 01:40 Codex brain (C1 merged, Claude repairs verified)
- Done: merged reviewed C1 at 3c54e67 under user authorization; forced main check passes 103 tests plus typechecks/lint, build passes. Verified Claude repair 4a9be26 with independent Astra review and 41-test branch check. Prepared gated E3b/E4 cards and implementation brief; no feature code written by the brain.
- Next: integrate reviewed E3a and run combined checks, then human launches E3b in Codex GPT-6.1 Sol/high from a fresh worktree. E4 follows E3b review/merge in Claude Code. Neither next worker is launched.
- Watch out: E3a is still unmerged; its branch check is not combined C1 validation. Existing seed payloads need separate safe backfill. No push/deploy/reset, no E3a worktree edit, no worktree deletion. Concurrent Nessie research and untracked web tooling preserved.

## 2026-10-24 01:30 Micah (Codex, P4)
- Done: assembled the company workspace with reactive Convex reports, history, constraints, ranked risks, branches and selected-branch fixes. Exact risk combinations select matching event branches; unsaved combinations show honest empty states. Fix cards display backend scores and saved simulations, require confirmation, and persist approvals through the existing mutation. Browser checked cancel/confirm, persisted Approved after reload, proof, preview toggle and selection; phone sample layout at 390 px has no page overflow. All 67 tests, typecheck and lint pass; production build checked before merge.
- Next: P5 implements branch detail and full connection/event/week flows. E7 replaces internal action placeholders, then enables the corresponding readiness flags in LiveCompany.tsx. Demo shortcut can use NEXT_PUBLIC_DEMO_COMPANY_ID with the actual seed company document ID.
- Watch out: approval saves a decision only; anonymous demo decisions are explicitly unverified. One local seed fix was approved during QA and remains recorded. /c/kestrel is labeled sample data unless a demo company ID is configured. New simulations/events/weeks stay disabled. Computed chain steps without attached evidence say so. Screenshots: /tmp/domino-p4-desktop.png and /tmp/domino-p4-mobile.png.

## 2026-10-24 01:21 Codex brain (integration complete, C1 ready)
- Done: E1a/E6a integrated on main at 5762475/63366ae; combined 81 tests, typechecks, lint, summary CLI and production build passed. Prepared C1 f80401d in its own contracts-only worktree; independent Astra review and lead's full 103-test check passed. Proposal, review and task Result recorded.
- Next: Jayden/Micah review C1 before shared-contract merge. Claude remains on E3a repairs. E3b then consumes explicit invoice links and calculation contexts; E4 uses targeted fixes and common rule evaluation.
- Watch out: C1 does not implement engine enforcement or backfill existing seeded payloads. Original Kestrel guard remains until engine adoption. No push, deployment, data reset or E3a worktree change. Untracked web tooling files were preserved.

## 2026-10-24 01:20 Micah (Codex, P3)
- Done: custom SVG history/futures with D3 and Motion, probability opacity, break/survival markers, keyboard future selection, event details, and fix comparison matched by risk IDs with stable axes. Chrome verified 64% to 93%, selection across toggle, recorded events and 390 px layout without page overflow. Reduced-motion server render and 30-future geometry regression coverage added. All 61 tests, typecheck, lint and production build pass. Screenshot: `/tmp/domino-p3.png`.
- Next: P4 wires reviewed props-only components to live Convex queries. Pass comparisonReport to preserve the vertical scale across fix previews.
- Watch out: IAB preview did not hydrate in the earlier session; Chrome verification passed. Reduced-motion skip is verified through a mocked preference server-render test; OS preference was not changed. Thirty-future geometry passes; 60 fps GPU performance has not been measured.

## 2026-10-24 01:14 Codex brain (integration and C1 preparation)
- Done: integrated latest product work, preserving both sides of knowledge-base insert conflicts; merged E1a at 5762475 and E6a at 63366ae under user authorization. Checks passed after each merge; final main has 81 tests plus typechecks/lint, production build and sim summary passing under Node 24.
- Next: build_contract_c1 prepares the contracts-only patch in domino-contract-engine-context; review_contract_design audits it. Proposal and card are in kb/spec and kb/tasks. Review before shared-contract merge.
- Watch out: Claude's E3a branch was not touched. Existing untracked web tooling files were preserved. No deployment, seed reset, push or team message. Old seeded payloads need a later safe backfill; C1 preparation does not make the engine consume the new fields.

## 2026-10-24 01:10 Micah / Codex — revised theme
- Done: Changed the base to near-black brown, green primary, pink warnings and orange history accents. Logo retained from calhacks-2026.
- Next: Finish P3, then P4.
- Watch out: This replaces the earlier green background direction.

## 2026-10-24 01:10 Micah (Codex, CREAO agents and environment)
- Done: created three private Domino agents in Chrome, saved the shared local key and all three IDs in ignored root `.env`, and completed mock API runs for every job. Mapping JSON and corrected constraint content pass contract validators; brief content cites the supplied grade/model. All agents have Ask first autonomy, no connectors and no schedules. `pnpm check` passes (35 tests, typecheck, lint).
- Next: E6 implements the adapter using the endpoint and response-format findings in `kb/research/sponsors.md`. Public judging share links remain outstanding; owner-access test runs are linked there.
- Watch out: `result.text` contains memory metadata. Actual outputs vary between JSON attachments and narrated `chatText`, so strict raw output is not reliable. The corrected Constraint Reader v1.1.0 keeps the same ID and uses the literal source category `document`. Other S0 account/integration access remains unverified.

## 2026-10-24 01:07 Micah (Codex, dark theme and logo)
- Done: applied the supplied mint/clay/rose/green/brown palette as the default dark theme, with readable off-white text and accessible warning text. Reused the original two-tile Domino SVG from calhacks-2026 for the header and favicon; preserved geometry and wordmark dot. Checks (56 tests), build and desktop screenshot review pass.
- Next: P3 and P4 use these semantic tokens; continue sequential worktrees and merge each task.
- Watch out: mint is both selection and survival, so chart labels and outcome symbols must distinguish them. Rose fills/strokes stay #BA6A68; small warning text uses a lighter derived shade for contrast.

## 2026-10-24 01:03 Codex brain (E1a/E6a complete)
- Done: E1a 2540e74 and E6a d16ece3 completed on isolated branches, each independently reviewed by GPT-6.1 Sol with no blockers. Lead reran forced checks: E1a 5 sim + 13 contract tests and CLI; E6a 20 routing + 13 contract tests; both typechecks/lint passed. Reports and worker Results recorded in main.
- Next: human glances at both diffs; integrate reviewed branches with fresh combined checks and resolve newer origin/main work without rewriting history. Full E1/E6 follow-up slices remain open. Claude owns E3a repairs.
- Watch out: no merge or push performed. Data is synthetic; agent tests use injected providers, not live integrations. Concurrent sponsors.md/nessie-api.md changes were preserved and not staged. origin/main advanced two commits during work; branch checks predate integration with them.

## 2026-10-24 00:57 Micah (Codex, P1 merge/P2)
- Done: merged P1 with the latest mocks-only main and pushed merge `20ba4ed`. P2 adds all 14 tables and query functions, five mutations, contract parsing, transactional approvals, action placeholders, and `pnpm convex:fixtures`. 21 new backend/parser tests; `pnpm check` (56 total), `pnpm build`, frozen install and all 14 live local queries pass. Seed rerun creates no duplicates and preserves decisions. Kestrel is visible as ready in the local Convex dashboard.
- Next: P3 builds the hero; P4 wires screens to these queries. Use the company ID returned by the seed, not the literal route stub `kestrel`. Jayden replaces the internal action placeholders in E5/E7; see `kb/spec/convex-api.md` and `apps/web/convex/README.md`. P2 is on `codex/p2-convex`.
- Watch out: `sources.lastPull` is null until an actual pull. Fixture tie-outs are pending; approvals/grades/explanations stay empty until real results. Action placeholders throw `not built`; no money moves. Anonymous demo decisions are labeled unverified; production company access controls remain outside this demo. P2 changes are isolated from unrelated local edits in the primary checkout.

## 2026-10-24 00:56 Micah (Codex, CREAO environment)
- Done: inspected CREAO in Chrome and populated only `CREAO_API_BASE_URL` in ignored root `.env` with the documented app API prefix, `https://agent.creao.ai/api/v1`. `pnpm check` passes (35 tests, typecheck, lint).
- Next: confirm creation of a new local API key and the three Domino job agents; then save the key and their IDs locally. Existing keys are not revealable and only Forecast Lab Worker exists.
- Watch out: app-scoped keys run only one agent. Developer Console `/v2` is a separate USD-billed product with zero balance; do not mix its keys or hosted agent IDs with chat API/CLI `/v1`. No keys or agents were created.

## 2026-10-24 00:55 Codex brain (E3a review)
- Done: reconciled Claude's E3a f9b5ad2 with the prepared worktree; fresh Node 24 pnpm check passed 26 engine and 13 contract tests plus typechecks/lint. Independent GPT-6 Astra review found two valid-input defects; review and repair card saved. No feature code, merge or push.
- Next: Claude continues E3a-r1 in existing domino-E3a: exclude historical hiring savings and fix exact cent rounding. New Result belongs in that worktree's card. Re-review before merge; E1a/E6a remain prepared.
- Watch out: tests passed despite the two bugs. Raw fixture ambiguity is the brain's intentional temporary guard and needs a separate shared-contract decision. The original E3a Result was modified in main, not included in f9b5ad2; it is preserved with a reconciliation note.

## 2026-10-24 00:55 Codex brain (E1a/E6a dispatch)
- Done: user authorized launch; synchronized the two clean worktrees to 9830b93 and dispatched build_e1a and build_e6a on GPT-6 Sol/high. E3a remains with Claude.
- Next: workers implement their cards, verify, fill their own Results and commit locally; brain reviews and records outcomes.
- Watch out: no duplicate writers, no root manifests/lockfile/shared contracts, no live paid provider calls, no merge or push. Thirty-minute headless checkpoint.

## 2026-10-24 00:45 Codex brain (launch preparation)
- Done: wrote E3a/E1a/E6a cards and the launch plan; reserved separate branches/worktrees. Forced-cache-bypass pnpm check passed with Node 24: typechecks, 13 contract tests, lint. No feature code or implementation worker launched. Preserved the prior local orchestration commit.
- Next: Jayden launches E3a with Codex GPT-6.1 Sol/high, then E1a and E6a with GPT-6 Sol/high. Full setup credentials are separate from the offline task gate.
- Watch out: default shell picks Node 19; use installed Node 24. Acme's extra 45 days stays inside the horizon; illustrative forecasts are not test oracles. Contract gaps and temporary forecast guards are in kb/requests.md and the launch plan.

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
