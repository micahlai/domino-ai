# Field lane handoff, Oct 25

## Completed map stability fix
- Branch `merge/field-map-stability-20261025` in `../domino-merge`, base `aac6de6`; current field/main was already pushed.
- Reproduced with existing scripted agent updates in frontend-only preview3138: latest summary24/48/24px causes map top326/350/326px. scrollY remains0; map height478px and camera unchanged. Trace `/tmp/field-map-before.json`.
- Implemented only in BrainMap.tsx: reserve two activity lines, clamp longer summaries, retain full text in DOM and hover title. Browser regression now passes80 samples/7 messages at map top350px, summary48px, scrollY0. Independent read-only review found no blocker.63 focused map tests, web tsc, changed-file Biome and production webpack build pass. No full-suite rerun.
- Code `b07c8c5` was fast-forwarded and pushed to field/main. Live3114 map verified connected with fixed48px activity space and full message preserved. The existing Next process remained running. Frontend-only preview3138 is being stopped. Evidence: `/tmp/field-map-before.json`, `/tmp/field-map-after.json`, `/tmp/field-map-assert.cjs`, `/tmp/field-map-fixed-preview.png`, `/tmp/field-map-fixed-live.png`.

## State
- Lead: Codex, taking over from Claude under Jayden's explicit authorization. This wave is finished and pushed to `field/main` in `../domino-field`. Integration happened only in `../domino-merge`, branch `merge/field-codex-20261025`, starting from `8dbba79`. Main remains `694ab2a`.
- Release code: `b07c8c5` includes all four feature merges, hydration repair and reproduced map stability fix. Documentation commits may follow it.
- Live demo: `http://127.0.0.1:3114`, local Convex3260/3261, both from `../domino-field/apps/web`. Next PID30980, persistent terminal session16152, log `/tmp/domino-field-next-3114.log`. Original Convex PID55917 remains running. The initial detached Next launch exited before binding; the persistent launch is confirmed listening.
- Next was restarted with a fresh `.next` after the large fast-forward. Live verification passed: `/field`, `/judge`, `/c/kestrel/timeline` HTTP200; suggestions and toolbox queries respond on3260. The live browser renders connected data; the hydration repair enables Open in timeline with no new console errors. Screenshot `/tmp/field-live-release.png`.
- Isolated judge3130/3290/3291, Timeline3140/3294/3295, and integration3138/3298/3299 test servers were stopped. Their data was preserved. Never touch3102/3210/3214 or the friend's3107/3240/3241.

## Completed worktrees and merge order
| Branch / worktree | Result | Merge |
| --- | --- | --- |
| `field/convex-depth`, `../domino-field-convex` | Signed vendor webhooks and optimistic decisions were already merged before takeover | `dff349e` |
| `field/swarms`, `../domino-field-swarms` | Parallel audit checks, bounded forecasters, engine advisors on cash breach, growing capped Apify toolbox; finished `e6747b9` | `b820883` |
| `field/worker-page`, `../domino-field-worker-page` | Suggestions, risks, flags; real API adapter and versioned decision requests; final `d6a80be` | `e394c7f` |
| `field/judge-simple`, `../domino-field-judge-simple` | Health, sources, live map; Play/Pause; three source-aware surprise presets; `7547fae` | `1f3b536` |
| `field/timeline-ux`, `../domino-field-timeline-ux` | Clearer flow, calmer chart, mobile assistant and focus, latest-books empty state; `3753241` + `9088bec` | `d6e85b0` |
- All five worktrees were inspected. Existing Claude-owned test commands were left alone until they ended. No worker is still assigned from this takeover.
- Conflicts resolved: generated Convex API regenerated, composed schema46 tables, Timeline isolation count28 Field tables, optimistic error handling transferred into the moved FlagsSection. Webhook tests wait for the actual bounded analyst completion before asserting rejected deliveries write nothing.
- Independent safety review cleared durable audit recovery, stale advisor writes/decisions, company/actor/URL cache isolation and record-only approvals. Advisor writes and decisions require the correct run/snapshot. A failed audit retains exact inputs and blocks a newer snapshot until audit/recompute complete.

## Verification evidence
- Combined release at `2a47ac9`: web1,187 tests, engine385, agents329 (1,901 total); web/Convex/engine/agents TypeScript checks; root Biome636 files; `pnpm --filter @domino/web build --webpack`. All passed. Integration regressions46 tests passed.
- Default Turbopack production builds were attempted and failed on an internal worker port permission; webpack is the supported checked fallback. No dependency or font workaround was introduced.
- The live browser found a new hydration mismatch that could leave Open in timeline disabled. Final `92ac4ac` adds a hydration guard. Web tsc, focused23 worker tests, changed-file Biome and the production webpack build passed after that fix; fresh live browser showed an enabled button and no new errors. Full suites were reused per Jayden's latest instruction.
- Isolated integrated smoke: audit lifecycle recorded, three engine suggestions created, stale decision rejected, decline saved, projected cash unchanged, repeat decision rejected. Browser accepted a second suggestion and saved its note. `/tmp/field-integrated-smoke.log`, `/tmp/field-integrated-worker-smoke.png`.
- Judge smoke: own cash-crunch company, map populated, real engine At risk verdict, unexpected bill re-ingested and lowered cash, Play advanced days, Pause stopped it. `/tmp/field-judge-smoke.png`.
- Timeline smoke: latest-books empty state, real fixture comparison curve,390px no overflow, mobile question field focus. `/tmp/domino-timeline-ux-desktop-full.png`, `/tmp/domino-timeline-ux-mobile-full.png`, `/tmp/domino-timeline-ux-mobile-assistant.png`.
- Detailed branch evidence: `TAKEOVER-SWARMS.md`, `TAKEOVER-WORKER.md`, `TAKEOVER-JUDGE.md`, `TAKEOVER-TIMELINE.md`. Logs remain in `/tmp/field-*`.

## CREAO and credentials
- Existing live env remains configured for Anthropic fallback, the CREAO evidence app, Nessie and Apify. Never print keys, token files, `.env.local`, or auth files.
- One real synthetic advisor request validated supplied fix ID selection and sanitized rationale for `field_advisor@creao-3e8215ca6876`. Source identity matched the release.
- Auto-review initially rejected enabling that new profile due future company-derived data sent to CREAO. Jayden explicitly approved the scenario summaries and precomputed fix effects going to the existing CREAO app. The exact tested app/profile pair is now enabled on3260; previous verified profiles were preserved. Credentials and existing profile values stayed in process memory and stdin, never logs/files/arguments.
- Changed CREAO prompts change their profile version. Validate a new version before adding its configured app/profile pair; compose values in memory and pass env updates through stdin. Never silently verify an untested profile.

## Merge and runtime rules
- Never merge feature branches directly in `../domino-field`, never touch main. Use a fresh integration branch in `../domino-merge`; check it; `git merge --ff-only` in `../domino-field`; push `field/main`.
- After large code merges, restart only Next3114 from `apps/web`: stop its verified process, clear `.next`, then `npx next dev --hostname 127.0.0.1 --port 3114`. Keep the long-running terminal session alive. Preserve Convex data.
- If Convex needs a dependency restart, from the live apps/web only: `CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3260 --local-site-port 3261 --tail-logs disable`.
- Live Convex can regenerate `convex/_generated/api.d.ts`. Inspect it before fast-forwarding; commit meaningful generation through integration or restore only generated churn.
- Reuse passing checks. Rerun full suites only when code changes or a new failure justify them. Documentation-only synchronization needs no suite/build restart.
- Integer cents; pure engine; AI never computes money; a person approves actions; Domino never moves money. No secrets printed/committed, no destructive Git or data operations without asking Jayden.

## Next exact step and queue
1. Convex priority2: Workpool for swarms, rate-limiter and action-cache components; priority3 Workflow for ingestion. Current swarms use bounded app scheduling, not those components.
2. Osprey storyline: possible request to start OK and flip At risk on day9. TL8 rejoin stays the friend's lane.
3. CRS stays on hold. Mana: Jayden makes the demo video. Tracks: Hyphenate, Convex, CREAO, Apify, Capital One Nessie; Anthropic public-benefit and Coinbase skipped.
- User requested orchestrator mode. Global Codex subagent cap5 was saved in `~/.codex/config.toml`; the active session still exposed three worker slots. No Codex restart was performed.
