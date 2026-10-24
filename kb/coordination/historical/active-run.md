# Active overnight run

Updated: 2026-10-24 08:02 PDT. Codex supervises thread 01a16cd6-e1f1-7823-bf13-da8417c64bcd. Inspect actual commits/processes before dispatching. Do not duplicate workers. Earlier audit history remains in Git and kb/reviews.

## Limits and ownership

- Entry: prompts/shared/C0-codex-supervisor.md. Claude implements, Codex audits/checks/integrates. H0 inactive. At most three writers, one UI owner. Sonnet for UI/evidence, Opus for backend. Fresh bounded phases, 30-minute target, at most two repairs per gate. Stop retry storms and paid fallbacks.
- Deadline: October24 11:15 PDT /18:15 UTC. Stop dispatching then preserve safe checkpoints. Main694ab2a and unrelated work remain untouched. No main merge/push, production deployment, shared cloud writes or destructive reset.
- Coordination: domino-case-study / integration/historical-case-study. Final branch preview/historical-overnight remains reserved. All worktrees under /Users/jaydenl/Dev/Hackathon/CalHacks 26.
- Serialize full checks, installs, builds and browser work. Node24 at /Users/jaydenl/.nvm/versions/node/v24.11.1/bin. Full check TURBO_FORCE=true pnpm check. Slot currently free. Reuse existing packages, primitives and Motion. No secrets in output/commits or billable Apify Actors.

## Accepted checkpoints

- Evidence H1 a4e49e0: normalized raw-backed 2U cash-only case. S7 Q3 and S8 Q4 issuer releases verified with hashes/publication dates; 13 validation tests. Archived research remains excluded from runtime. Debt/covenant/going-concern claims are unverified and unused.
- Contracts442d23b, enginea75406d and real-case41d04e7 accepted after independent reviews. Exact case gate passed713tests. Baseline misses actual year-end cash by$37.58M. Retrospective with outcome known, not a bankruptcy warning or prospective accuracy claim. Response is cost-only sensitivity; A1-DOWNSIDE is an explicit unmodeled limitation, not zero.
- H2c code8389326, full dependency/acceptance66b2d2a, pushed H2-historical-backend. Independent Astra approval after two bounded repairs. Full726tests/typechecks/lint passed; /tmp/domino-H2c-r2-check.log. Local runtime passed concurrent save/reveal retries, distinct-key receipts/conflicts, wrong-case rejection, exact comparison and immutable input snapshots. Generated bindings included. Browser integration remains separate.
- H2c API semantics: getRun.inputSnapshot is authoritative for saved input sources/facts/assumptions. getCase.case is available or frozen revealed evidence. Never substitute current inputs for a saved forecast or mix older basis facts into newer observation derivations. Run-scoped method/origin/cutoff use the saved run. Historical comparison is baseline only; alternative is never scored against actuals.
- H3 presentation97925fd and H4 style/activity presentation436878e accepted/pushed. Four shared-component themes, truthful unavailable activity and labelled simulation. H4 full728tests/build plus desktop/mobile browser passed. Projected line dashes repaired. Reference colors checked; Ramp/Hyphenate layout/fonts inferred, not exact private app copies.
- Accepted H2c66b2d2a merged into H4 at45d767d. UI card5b7076a narrowed to core wiring at4eb0ddc. Combined772tests/typechecks/lint passed, /tmp/domino-H4-h2c-merge-check.log. No feature conflicts. This integration is local until the next checked UI checkpoint.

## Current workers

| Phase | Worktree / branch | Model | Exec / verified PID | Log | Status |
| --- | --- | --- | --- | --- | --- |
| H2d real activity | domino-H2 / H2-historical-backend | Opus high | 65651 / finished | /tmp/domino-H2d-claude.log | Accepted code6498b75, full backend4795d51 pushed |
| H4c core repair1 | domino-H4 / H4-ui-styles-motion | Sonnet high | 63601 / 23935 | /tmp/domino-H4c-r1-claude.log | Running from594b185; render loop, stale navigation and error handling |

UI repair process/cwd verified08:02. Core worker completed594b185; repair1 is the only writer. H2d completed and accepted; H1 and all earlier writers stopped. Current prompt /tmp/domino-H4c-r1-prompt.txt; earlier prompts /tmp/domino-H2d-prompt.txt and /tmp/domino-H4c-core-prompt.txt. Each owns its task Result, not shared board/HANDOFF. No nested workers.

## Next exact steps

1. H2d gate complete: code6498b75 independently approved; full734tests/typechecks/lint and live separate-client concurrency/isolation checks passed. Complete accepted backend4795d51 is pushed. Preserve it until the UI worker reaches a clean checkpoint.
2. Collect H4c repair1. Core594b185 passed792tests/build but browser crashed with React301 and independent audit found navigation/error defects. Re-review the repairs, full check/build and local browser journey. Verify save/reveal/alternative/reload, no future-data client import, authoritative frozen input evidence, retrospective copy, unknown benefit/downside, keyboard/mobile and style-state preservation. It must not call a guessed H2d API.
3. After the core UI checkpoint, merge accepted H2d4795d51 into H4 and launch a small activity wiring phase. First history load quiet; real new events animate once. Agent/tool simulations remain labelled playground only.
4. Assemble preview/historical-overnight, combined checks/build/browser and reviewable morning result. Preserve main. If another repair fails beyond its two attempts, park that gate with evidence instead of repeated retries.

Core UI now runs in parallel with H2d because its persistence dependency is accepted. This supersedes the earlier plan to wait for activity before any live UI work. Activity remains explicitly unavailable until tested H2d adoption.

## Owned runtime and monitoring

- Automation domino-overnight-audit ACTIVE every20minutes; quiet when unchanged. Stop on completion/user stop/deadline. Awake guard exec88844/PID14212, bounded caffeinate from05:20. Keep app open, AC connected, lid open. Do not touch unrelated processes.
- Isolated anonymous local Convex from domino-H2/apps/web, localhost3210 and site3211. exec80763/backendPID38093, /tmp/domino-H2-local-convex.log. Project-local state/environment only, no shared cloud. Watcher rebundles H2 changes and generates bindings. Never print credentials/env. Pre-repair smoke reveal rows lack frozen evidence and fail closed; use fresh runs, do not reset data.
- Main server3000 untouched. H3 preview3100 exec68463 serves97925fd, /tmp/domino-H3-preview.log.
- H4 preview3101 exec58933/PID16110 serves594b185, /tmp/domino-H4c-preview.log. Its historical route currently crashes with React301; it does not serve the pending repair. Old owned PID86135 was stopped after cwd verification. Build with NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 for the integrated local journey, then restart only verified owned server. Do not run a second Convex watcher in H4.
- CUA IAB tab6 styleAuditTab retained, browser styleBrowser. Viewport capability mobileViewport was reset. After compaction call cua.rewriteDocumentation before browser work. Prior screenshots /tmp/domino-H4a-{original,ramp,hyphenate,shadcn}-{desktop,mobile}.png and /tmp/domino-H4b-r1-mobile-activity.png. Reduced-motion runtime emulation and final live browser journey remain unverified.

## Reviewers

- audit_e3b_rules: Astra, approved H2c8389326 and H2d6498b75. Independent probes /tmp/h2c-independent-audit.ts, /tmp/h2c-r1-independent-audit.ts, /tmp/h2c-r2-independent-audit.ts.
- audit_ui_integration: Sol6.1, approved presentation436878e, reuse for live core/activity.
- audit_e3b_causality: Sol6.1, accepted normalized evidence, no further research required for this narrow case.

## Backend complete, 07:46 PDT

- H2d actual query getActivity({caseId, baselineRunId}) returns latest50 events oldest first. Same-transaction emission only for successful save/reveal/alternative operations. No fake starts, agent/tools or failure records. Distinct concurrent alternatives have unique sequence; retries and extra reveal keys do not duplicate outcomes/events. Another baseline never receives revealed metadata.
- Independent review approved code6498b75, probe /tmp/h2d-independent-audit.ts. Lead full734tests/typechecks/lint passed at /tmp/domino-H2d-check.log and live concurrent HTTP probe passed. Acceptance4795d51 pushed. No H2 writer remains.
- UI activity handoff: reset/key feed state by baselineRunId but filter events by caseId, because alternative events carry their own runId. Initial history must be quiet. H4c core is still running against accepted H2c only; do not merge into its active checkout until a clean checkpoint.

## Live UI audit, 08:02 PDT

- Candidate594b185 adds /historical with existing four-style chart/replay, frozen input provenance, save/reveal/alternative and reload. Full792tests/typechecks/lint and production build passed (/tmp/domino-H4c-check.log, /tmp/domino-H4c-build.log). Candidate not accepted.
- Actual browser failed immediately with React301: Session recreates useQueries map each render, changing Convex subscription callbacks and causing render-phase state updates. HTTP200 and static tests did not detect it. Source behavior verified in installed Convex use_queries.ts/use_subscription.ts. Screenshot /tmp/domino-H4c-render-crash.png, tab6 retained.
- Independent Sol review additionally found incorrect certainty after unknown network mutation outcome, stale search params/navigation after an in-flight mutation, invalid alternative response leaving permanent Done state, and inherited Kestrel sidebar context. Financial mapping and pre-reveal filtering had no additional blocker.
- Claude Sonnet repair1 launched exec63601/PID23935; verified cwd domino-H4. Fix memoized query map, honest uncertainty, current URL plus unmount guard, retryable invalid responses and historical context label. No H2d adoption or extra feature work yet.
- Next: collect repair1, reuse audit_ui_integration, rerun checks/build then browser on the repaired preview. Do not call live UI verified from unit tests. After core acceptance, merge backend4795d51 and wire activity in a separate bounded phase.
