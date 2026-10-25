# Field lane handoff (Claude lead -> Codex), Oct 25

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
