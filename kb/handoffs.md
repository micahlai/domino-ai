# Handoffs

Newest first. One short entry at the end of every task or work session.
Format: `## YYYY-MM-DD HH:MM Name` then three lines: Done / Next / Watch out.

## 2026-10-24 12:42 Micah (Codex, particle visibility)
- Done: Hide particles clears the Canvas and stops its drawing loop instead of retaining frozen particles. Show particles resumes emission; chart transitions remain independent. All 83 tests, typecheck, lint and production build pass. Browser verified hidden particles stay absent through scenario, cash-scale and fix-preview changes, then resume when enabled; console clean. Screenshot: /tmp/domino-particles-hidden.png.
- Next: review at http://127.0.0.1:3007/c/kestrel in codex/p5-p6-flows.
- Watch out: committed locally in the existing P5/P6 worktree; main and the separate timeline-controls worktree remain unchanged.

## 2026-10-24 04:01 Micah (Codex, combined product preview)
- Done: reviewed and integrated V3 commit 7ddfc9c from its separate timeline-controls worktree into codex/p5-p6-flows after the P5 and P6 commits. No code conflicts; retained both knowledge-base histories and P6 phone-dialog sizing. Combined checks pass with 83 tests and production build. Port 3007 production browser verified independent scales/reset, removed dial, clicked event details, learning/record routes, illustrative accuracy chart and landing, without console errors. Screenshots: /tmp/domino-p5-p6-event.png and /tmp/domino-p6-record.png.
- Next: review the combined preview at http://127.0.0.1:3007/c/kestrel. The separate timeline-only preview remains on port 3008. P5 remains review pending E5/E7 processing and credit-line contract support.
- Watch out: primary main was not changed by this work. P5/P6 use isolated Convex port 3220 and the original timeline-only preview uses port 3210. Changes are committed locally in both managed worktrees; no merge to main or remote push was performed.

## 2026-10-24 03:57 Micah (Codex, P6)
- Done: live/sample learning and decision-record routes, measured accuracy Recharts/table, saved rules/proof, validated weekly brief storage with one-per-company/week upsert, and new-brief notification. Added the landing sentence/connect action and R/Reload saved results fallback; shortcut ignores forms and dialogs. Browser verified rule proof, saved approval appearing after reload, reference links, weekly notification, R resetting a fix preview without affecting form typing, and 390 px dialogs/tables without page overflow. All 82 tests, typecheck, lint and production build pass.
- Next: integrate the independently committed timeline controls into this preview, then review P7 usability/demo materials once E5/E7 processing is ready.
- Watch out: actual company grades/briefs stay empty until E7 supplies them. Illustrative playground rows/accuracy chart and notification are explicitly labeled. One unverified demo approval was saved in the isolated port-3220 Kestrel database for verification; nothing was executed. P5 remains review because scheduled services and credit-line contract support are missing.

## 2026-10-24 03:49 Micah (Codex, P5)
- Done: separate managed worktree codex/p5-p6-flows from the current timeline branch. Added company create/progress/resume, company-scoped branch comparison with Recharts and weekly table, saved explanations/fixes/proof, configured event review with exact cent parsing, and next-week confirmation/pending states. Added backend readiness and validated event choices plus a scoped explanation request bridge. Browser checked creation/reload, scenario data, supported/unsupported event review and confirmation. All 80 tests, typecheck, lint and production build pass.
- Next: P6 learning/record screens and weekly brief storage; E5/E7 must implement the scheduled actions before the full P5 demo can run.
- Watch out: capabilities remain false while actions throw not built. Credit-line changes have no supported Change kind. No forecasts, explanations or connection results were invented. One Flow QA company was created in isolated local Convex port 3220, with pending source processing. Main and the primary checkout remain unchanged.

## 2026-10-24 03:45 Micah (Codex, timeline controls)
- Done: removed Inspect week slider, added independent Time/Cash decrease/increase controls and reset, with bounded two-direction chart scrolling. Recorded marker clicks and keyboard activation open full date, exact cash effect and attached source evidence in an accessible dismissible dialog, with focus return. Retained pointer-only crosshairs tied to the selected scenario, curve-click selection, keyboard/touch weekly readouts and particle caps. All 76 tests, typecheck, lint and build pass; company/playground, scale limits/reset, hover lock, popup dismissal, 390 px overflow and production rendering reviewed.
- Next: review codex/timeline-controls; work is isolated from P5/P6 and main.
- Watch out: scale controls change pixel spacing, never the supplied date/cash domains or financial values. Expanded views scroll within a 390 px viewport; keyboard inspection reveals its point in both directions. Local max-zoom particle drawing was about 0.37 ms/frame with the existing 720-particle cap. Screenshots: /tmp/domino-timeline-event.png and /tmp/domino-timeline-event-mobile.png.

## 2026-10-24 02:21 Micah (Codex, weekly inspection)
- Done: added dotted date/value crosshairs tied to the selected forecast, with full year and exact cash to the cent. Guides appear only while the pointer is inside the plot; hovering another curve does not change the inspected scenario, while clicking still selects it. The last weekly readout remains available outside the plot. Inspect week supports arrows, Home/End and touch; narrow charts reveal the chosen position. Verified hover lock, pointer exit, click selection, history, fix comparison, playground, mobile overflow and production rendering. All 75 tests, typecheck, lint and build pass.
- Next: review codex/timeline-particles at port 3005; main remains unchanged.
- Watch out: values snap to supplied weekly records/forecast points. No interpolated cash or synthetic Today values. Keyboard/touch changes the readout without showing pointer-only guides. Screenshot: /tmp/domino-timeline-inspection.png.

## 2026-10-24 02:12 Micah (Codex, full-line emission)
- Done: replaced traveling beads with soft particles born across entire curves, drifting outward and fading. Forecast counts follow supplied probabilities with equal lifetimes; stratified origins cover each path. Hard cap is 720 particles/32 tracks, with 234 particles at 390 px. The 30-path desktop playground drew about 0.24 ms/frame at roughly 60 fps; offscreen canvases stop. Pause/resume, scenario selection, fix comparison, clean console and phone overflow checked. All 72 tests and production build pass.
- Next: review codex/timeline-particles at the port 3005 preview; main remains unchanged.
- Watch out: density represents relative supplied probabilities within a shared visual budget, with integer rounding. History uses a fixed baseline. Browser timings are local measurements. Reduced-motion safeguards and accessible SVG remain in place. Screenshot: /tmp/domino-emission.png.

## 2026-10-24 02:00 Micah (Codex, particle experiment)
- Done: created codex/timeline-particles in the primary checkout, without a new worktree. Added a Canvas particle layer following cached D3 curve samples, quiet trails, selected-path glints, and continuous fix morphs. One animation loop, at most 144 particles/32 tracks, pixel ratio capped at 1.5; stops offscreen/hidden/paused and respects reduced motion, with 30 fps on coarse pointers and adaptive backoff. Added a clearly labeled 30-copy playground stress preview. Browser measured roughly 0.14–0.29 ms drawing per frame near 60 fps in that desktop preview; 390 px layout has no page overflow and reduces the field to 31 particles. Pause/resume, selection, fix comparison and clean hydration checked. All 71 tests and production build pass.
- Next: review the experimental branch at the local port 3005 preview before merging. Main is unchanged.
- Watch out: particles are display-only and do not represent extra financial values or uncertainty. Timing is from this desktop browser, not a device-wide performance guarantee. Reduced-motion initial rendering is regression tested; no OS preferences were changed. The Button helper import is relative so the existing SSR test can resolve it without adding test configuration. Screenshot: /tmp/domino-particles.png.

## 2026-10-24 01:45 Micah (Codex, plain timeline copy)
- Done: ran humanizer and taste on timeline copy. Replaced future/survival/break metaphors with cash forecasts, scenarios, cash requirements and projected impact; updated navigation, page title, accessibility text, empty states and playground descriptions. Renamed Apply fixes to Preview fixes and explained score weighting. Browser verified revised labels and the 7-to-9 scenario preview; checks and production build pass.
- Next: use the updated design-spec wording table for P5/P6.
- Watch out: contract identifiers, chart geometry, financial values and calculation behavior are unchanged. The score is a weighted share of tested scenarios, not an unconditional likelihood. Screenshot: /tmp/domino-plain-copy.png.

## 2026-10-24 01:30 Micah (Codex, P4)
- Done: assembled the company workspace with reactive Convex reports, history, constraints, ranked risks, branches and selected-branch fixes. Exact risk combinations select matching event branches; unsaved combinations show honest empty states. Fix cards display backend scores and saved simulations, require confirmation, and persist approvals through the existing mutation. Browser checked cancel/confirm, persisted Approved after reload, proof, preview toggle and selection; phone sample layout at 390 px has no page overflow. All 67 tests, typecheck and lint pass; production build checked before merge.
- Next: P5 implements branch detail and full connection/event/week flows. E7 replaces internal action placeholders, then enables the corresponding readiness flags in LiveCompany.tsx. Demo shortcut can use NEXT_PUBLIC_DEMO_COMPANY_ID with the actual seed company document ID.
- Watch out: approval saves a decision only; anonymous demo decisions are explicitly unverified. One local seed fix was approved during QA and remains recorded. /c/kestrel is labeled sample data unless a demo company ID is configured. New simulations/events/weeks stay disabled. Computed chain steps without attached evidence say so. Screenshots: /tmp/domino-p4-desktop.png and /tmp/domino-p4-mobile.png.

## 2026-10-24 01:20 Micah (Codex, P3)
- Done: custom SVG history/futures with D3 and Motion, probability opacity, break/survival markers, keyboard future selection, event details, and fix comparison matched by risk IDs with stable axes. Chrome verified 64% to 93%, selection across toggle, recorded events and 390 px layout without page overflow. Reduced-motion server render and 30-future geometry regression coverage added. All 61 tests, typecheck, lint and production build pass. Screenshot: `/tmp/domino-p3.png`.
- Next: P4 wires reviewed props-only components to live Convex queries. Pass comparisonReport to preserve the vertical scale across fix previews.
- Watch out: IAB preview did not hydrate in the earlier session; Chrome verification passed. Reduced-motion skip is verified through a mocked preference server-render test; OS preference was not changed. Thirty-future geometry passes; 60 fps GPU performance has not been measured.

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

## 2026-10-24 00:57 Micah (Codex, P1 merge/P2)
- Done: merged P1 with the latest mocks-only main and pushed merge `20ba4ed`. P2 adds all 14 tables and query functions, five mutations, contract parsing, transactional approvals, action placeholders, and `pnpm convex:fixtures`. 21 new backend/parser tests; `pnpm check` (56 total), `pnpm build`, frozen install and all 14 live local queries pass. Seed rerun creates no duplicates and preserves decisions. Kestrel is visible as ready in the local Convex dashboard.
- Next: P3 builds the hero; P4 wires screens to these queries. Use the company ID returned by the seed, not the literal route stub `kestrel`. Jayden replaces the internal action placeholders in E5/E7; see `kb/spec/convex-api.md` and `apps/web/convex/README.md`. P2 is on `codex/p2-convex`.
- Watch out: `sources.lastPull` is null until an actual pull. Fixture tie-outs are pending; approvals/grades/explanations stay empty until real results. Action placeholders throw `not built`; no money moves. Anonymous demo decisions are labeled unverified; production company access controls remain outside this demo. P2 changes are isolated from unrelated local edits in the primary checkout.

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
