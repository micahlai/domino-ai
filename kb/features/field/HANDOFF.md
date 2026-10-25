# Field lane handoff (Claude lead -> Codex), Oct 25

## Codex takeover, Oct 25
- User authorized Codex as Field lead to finish and integrate this wave. Fresh integration checkout: `../domino-merge`, branch `merge/field-codex-20261025`, based on `field/main` at `8dbba79`. Main remains untouched.
- Inspected all five worktrees: convex-depth clean and already merged; worker-page clean at `e9b2e0b`; swarms at `8857294` with unfinished backend changes; judge-simple and timeline-ux have unfinished changes based on `95d646d`.
- Claude PID 78153 still owns running swarms and Timeline test commands. Leave those checkouts alone until the commands and worker activity finish. No active judge or worker-page process found.
- Active owners: Codex builder `swarms` finishes `field/swarms`; builder `timeline` reviews Claude commit `3753241` on `field/timeline-ux`; lead finishes judge and worker-page acceptance, integrations, docs, demo. Read-only safety reviewer audits swarm money/isolation/caps. User invoked orchestrator and requested five subagents; saved global Codex cap 5, current session still exposes three worker slots.
- Judge: web/Convex tsc and changed-file Biome pass; full web Vitest 1,143 tests pass. Isolated backend3290/3291 and UI3130 ready. Browser verified three steps, map growth, engine At risk, unexpected bill ingest lowering cash, Play advancing days, Pause. Screenshot `/tmp/field-judge-smoke.png`. Fixed missing source requirements for surprises; focused rerun pending. Default build font fetch hit sandbox network; network-enabled rerun pending.
- Worker page: fixed actual swarm API effect fields and company-scoped decision arguments; CREAO attribution now appears only with a saved CREAO recommendation. Focused23 tests, both tsc and Biome pass. Full web tests/build pending.
- Ready commits: worker-page `3c8ee04` plus final copy followups (cash/payment checks); judge-simple `7547fae`; timeline-ux `3753241` + `9088bec`. Judge21 focused tests and webpack build passed after its guard fix. Worker full1,160 tests and webpack build passed; final23 focused tests and tsc passed after version tokens.
- Swarms safety review cleared repaired source: durable audit retry with exact inputs and serialized commits, run/snapshot guards on advisor writes/decisions, company/actor/URL website cache. Builder final full tests/build/commit are pending. New CREAO advisor profile remains unverified and gated; engine suggestions still work. Do not add a verified profile without testing it.
- Next: wait for swarms final acceptance, then merge swarms, worker-page, judge-simple, timeline-ux in order. Combined validation and live fast-forward/push/restart remain pending.
- Live listeners confirmed: Next 3114 PID 68925; Convex 3260/3261 PID 55917. Do not touch protected ports.

## State
- Integrated product branch: `field/main` (pushed; worktree `../domino-field`). Includes Field (ingestion, connectors incl. real Nessie bank, audit, CREAO-first AI with Claude fallback, real Apify, sim clock, brain map, dashboard, judge v1, 2U rewind) + Timeline TL7/TL9 integrated (joint seam "Open in Timeline", TL6 dashboard data). Latest: 95d646d. Tests: web 1137, engine 376 pass; lint clean.
- Live demo (keep running): Next dev `http://127.0.0.1:3114` and local Convex `3260/3261`, both started from `../domino-field/apps/web`. Env on that Convex: ANTHROPIC_API_KEY, CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID/_API_KEY, DOMINO_CREAO_VERIFIED_PROFILES (evidence_analyst + 4 field_* roles), NESSIE_API_KEY/BASE_URL, APIFY_TOKEN. Never print values. Never touch ports 3102/3210/3214 (other apps) or the friend's 3107/3240/3241.
- Merge rule (learned the hard way): never merge into `../domino-field` directly. Merge in `../domino-merge` (new branch from field/main), run checks, then `git merge --ff-only` in `../domino-field`, push, then restart Next (`pkill -f "next dev --hostname 127.0.0.1 --port 3114"; rm -rf .next; npx next dev --hostname 127.0.0.1 --port 3114`) because Turbopack's watcher gets stuck after big merges (reload loop). If convex dev fails to load a new dependency, restart it from apps/web: `CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3260 --local-site-port 3261 --tail-logs disable`.
- If CREAO job prompts change, profile versions change: add `<appId>/<role>@creao-<hash>` to DOMINO_CREAO_VERIFIED_PROFILES on 3260 (compose in-shell from the app id env var).

## In flight (Claude workers; may stop when usage ends; finish from the worktree)
| Branch / worktree | Scope | Status at handoff |
|---|---|---|
| field/timeline-ux `../domino-field-timeline-ux` | Timeline page cleanup: clear primary flow, calmer chart, chat sidebar fit, empty state "Bring in latest books" | in progress |
| field/swarms `../domino-field-swarms` | Audit swarm (parallel checkers), forecasting swarm, advisor only on breach -> `fieldSuggestions.list/decide`, growing Apify toolbox (Store search -> tools table) | in progress |
| field/judge-simple `../domino-field-judge-simple` | /judge 3 steps: pick company health -> pick sources -> watch map grow + Play + 3 surprise presets | in progress |
| field/worker-page `../domino-field-worker-page` | /field: Suggestions (accept/decline, records only) -> Risks we're watching -> Flags to review | in progress |
| field/convex-depth `../domino-field-convex` | Signed vendor webhooks via httpAction -> immediate ingestion; optimistic confirm/dismiss. Presence and Cmd-K were scrapped. | MERGED into field/main (dff349e) |
Each brief's acceptance: tsc (web + `-p convex`), vitest, biome on changed files, `pnpm --filter @domino/web build`, isolated local Convex on free ports for smoke, screenshots in the Claude scratchpad. Commit with a Co-Authored-By trailer.

## Merge order after they finish
(convex-depth done) swarms -> worker-page (consumes fieldSuggestions) -> judge-simple -> timeline-ux. Resolve schema table-count test, api.d.ts registrations (let convex dev regenerate), AppShell/nav.

## Next queue
- Convex priority 2: Workpool for swarms (if not done), rate-limiter + action-cache components replacing hand-rolled AI budget/Apify cache; priority 3 Workflow component for the ingest pipeline.
- Osprey storyline: start OK and flip to At risk on day 9 (user may want).
- TL8 branch rejoin (friend's lane).
- CRS: hold until Jayden says. Mana: Jayden makes the demo video.
- Tracks: Hyphenate (primary), Convex, CREAO, Apify, Capital One (Nessie). Anthropic public-benefit and Coinbase skipped.

## Rules
Integer cents; engine pure; agents never compute money; a person approves every action; Domino never moves money; no secrets printed or committed; never touch main; no destructive git without asking Jayden.

## Gotchas
- The live convex dev regenerates apps/web/convex/_generated/api.d.ts (formatting differs from hand merges). Before `git merge --ff-only` in ../domino-field, commit or `git checkout --` that file.
- Full vitest can time out a few convex tests while other workers run tests in parallel; rerun the failing files alone before treating them as real.
