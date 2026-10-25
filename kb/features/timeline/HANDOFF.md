# Timeline handoff

## 2026-10-25: TL11 page-filling timeline and branch focus

- Done: all session UI changes are consolidated on `claude-timeline-chat`: full-window chart, collapsible/widenable scenario rail with visible Build on and closed metadata, collapsible draft-preserving chat, collapsed bottom financial tray, vertical top-left chart key, continuous horizontal pan and date-anchored grid, exact-time branch-aware focus. See [layout scope](TL11-layout.md) and [task](../../tasks/TL11-page-filling-timeline.md).
- Browser: actual saved Kestrel timeline checked at 1440×900, 1024×768 and 390×844. Confirmed rail/dropdown actions, parent-first comparisons, unsent chat draft retention, bottom saved values, keyboard scrollers/week selection, fractional pan and moving grid. Clicked a fractional position on Driftwood's curve: focus retained its run ID; keyboard week movement kept the branch and Build on stayed on base. Uncheck falls back to base, recheck restores focus. Screenshot `/tmp/domino-tl11-final.png`.
- Runtime: preview http://127.0.0.1:3116/c/kestrel/timeline in `../domino-claude-chat`, reusing the existing `../domino-unified-chat` local backend on3212/3213 and its saved data. Restarted those stopped services after interruption; no data/env copying. Main unchanged. No production build/provider calls/new financial writes in this UI acceptance.
- Checks: final `pnpm check` passes typechecks, 2,520 tests (1,218 web) and Biome649 files. Source audit found no blockers; no backend/schema/contracts/engine/global-style edits. User explicitly authorized pushing all consolidated session changes to `claude-timeline-chat`; no main merge.

## 2026-10-25: TL10 Claude chat, scenario branches and timeline controls

- Done: Claude-backed "Ask Domino" chat (questions with sources and what-ifs in one thread, choices), color-coded scenario branches with start dates and a parent-first visibility rule, branch tree rail, time and cash scrollers, branch confirmation flash. Branch `claude-timeline-chat` pushed at `bae9a8e`; main untouched.
- Checks: `pnpm check` (1,209 web tests); live API checks. No browser check yet.
- Next: [TL10 handoff](TL10-claude-chat-handoff.md): browser pass, Phase 3 solution scenarios, task cards/decisions/spec, then PR.

## 2026-10-25: TL9 sidebar ready for push

- Done: durable typed clarification chat beside the timeline; exact reviewed scenario/rule save, transcript/history, source-pinned context and legacy link redirect. Phone remains on the timeline page. Independent review accepted final UI/backend; live initialization and repeated-payment issues repaired.
- Checks:2,028 tests, five typechecks, lint408, separate Convex typecheck/build;21 core live API checks plus six nested-payment checks; actual desktop/phone sidebar flow. [Acceptance](TL9-acceptance.md).
- Next: user may push TL9-chat-checkpoint as a separate branch. No TL9 push or merge into published TL7 performed; TL7 stays1140c26. TL8 and Field adoption remain separate.

## 2026-10-25: separate chat implementation

- User requests conversational rule/scenario creation with back-and-forth clarification in a separate worktree. TL9-chat-checkpoint owns integration, TL9-chat-backend/TL9-chat-ui workers are scoped by fixed interface/cards. No shared math/contracts/root schema/dashboard/Field edits.
- New isolated3109/3260/3261 local backend/app uses explicitly reviewed labelled synthetic Kestrel neutral seed. No copied env/provider keys/database. [Pending acceptance](TL9-acceptance.md). Messages build typed pending fields; explicit reviewed confirmation alone saves through existing workspace.
- Published origin/TL7-checkpoint1140c26 and3107 smoke data remain unchanged. No TL9 merge/push authorized or performed. TL8 rejoin remains separate.

## 2026-10-25: published checkpoint renamed TL7

- User requested a clear name reflecting completedTL7 scope. Published merge branch is now TL7-checkpoint; partner should fetch/merge origin/TL7-checkpoint. Former remote TL5-checkpoint is superseded. Stable checkout remains ../domino-timeline with unchanged3107/3240 data.
- Earlier isolated TL7 worktree branch renamed TL7-isolated-checkpoint to free the local name. This is only a branch-label change; accepted source and smoke behavior unchanged. Chat work stays separate.

## 2026-10-25: publish partner merge checkpoint

- User authorizes pushing the accepted Timeline work for partner merge on another computer. Publish TL5-checkpoint, with source0db7f2d and [partner pickup](PARTNER-PICKUP.md). No main/Field merge.
- Stable preview remains3107/3240 with existing data. Chat-based rule/scenario clarification starts separately after this checkpoint; it will not change the published smoke preview.

## 2026-10-25: timeline scales and inline scenario editor

- Done: integrated scales217b957 and contextual editorcb7f094 on TL5-checkpoint (196d154). Existing3107/3240 runtime restarted, data retained. Source-reviewed UI uses selected week for new cash dates, retains entered/queued events when navigating/hiding, and confirms exact queued events before saving.
- Checks: full1963 tests, five typechecks, lint391 and production build pass; lead15 focused tests pass. Original Atlas Legal backend output remains$2,609,000 low/$41,000 shortfall. [Acceptance](TL7XC-acceptance.md) records remaining live browser gate.
- Completed browser gate: user reloaded in Chrome; desktop1512/phone390 selected-date/draft/queue/review/save/reload pass, final console clean. Exact$100 expense onDec23 saved asaca904d0ddd1a388af53fb1a99a09af81b79fd98 with parent effects once and unchanged old run. Fixed mobile Remove wrap/button height; repeated1963check/build passes. Chrome left open with editor ready. No main/Field/push or backend financial changes.

## 2026-10-25: user-authorized merge into TL5

- Done: user explicitly requested merging TL6/TL7/sidebar into TL5 and launching its smoke test. TL7-checkpoint1ee3bdb merged into TL5-checkpoint at4ce834b. Existing3107/3240 services applied the additive analysis table/functions; saved TL5 data was retained.
- Checks: full1948 tests/five typechecks/lint385, production build and separate Convex typecheck pass. Browser reload preserves the Atlas Legal low point$2,609,000 and$41,000 rule shortfall, and new saved comparison controls work. Actual output:get returns exact existing financial values/health; analysis:list reads successfully on3240. Baseline analysis review screen is open in a second3107 tab; no analysis was auto-started.
- Authority: this supersedes older instructions below to hold TL5 at597fcc0. Main/lane-main and Field remain untouched; no push. The separate3108 sandbox remains available. New request: add horizontal date/vertical cash scales to chart on a checkpoint branch.

## 2026-10-24: saved scenario sidebar and chart comparisons

- Done: user-requested saved-scenario sidebar, family search/current nesting, mobile picker and up to three optional real saved chart curves; open/compare controls are separate. Integrated only on TL7-checkpoint. [Acceptance](TL7S-acceptance.md) and screenshots record1948 tests, five typechecks, lint385, production build, independent49+5 probes and actual desktop/mobile flow.
- Fixed: live browser caught unstable Convex comparison subscriptions; memoized primitive selection IDs repair is verified through actual connected navigation, keyboard comparison and clearing.
- Preserved: TL5 remains597fcc0 on3107/3240 with smoke tab open. New preview3108 in separate tab. No TL5/main/lane-main merge, push, dashboard/backend/shared/engine changes. Field adoption and TL8 remain separate.

## 2026-10-24: TL6–TL7 isolated background work

- User requests TL6/TL7 while keeping TL5 smoke test open, then explicitly forbids merging into TL5 until told. TL5 stays597fcc0 in ../domino-timeline with its existing3107/3240 preview.
- New integration TL7-checkpoint; separate TL6-handoff, TL7-analysis-backend and TL7-analysis-ui workers. Codex only; capped3 implementation workers. Interface/cards committed before launch. No dashboard/shared-contract/root-schema/engine/peer edits.
- Proposed TL6 versioned financial JSON read interface does not change WeeklyResultRefV1. Field adoption remains a joint gate. TL7 initially analyzes baseline/rule-only runs without cumulative events, because shared stressTest lacks ancestor input. Ambiguous/synthetic risk chances remain labelled assumptions.
- Verification and new writes use separate3108/3250/3251 services/data; never TL5. TL6/TL7 accepted locally: 1,942 tests, five typechecks, lint381, Convex typecheck/build, independent backend10 probes, actual API22 checks and browser/phone flow pass. [Acceptance](TL7-acceptance.md) records scope, limits and screenshots. Field adoption remains separate; TL8 not started.

## 2026-10-24: TL5 accepted locally

- Done: TL1C–TL5 integrated on TL5-checkpoint. Codex repaired/reviewed backend, UI and questions in parallel; immutable constraints/events, evidence questions, confirmed language proposals, nested scenarios and saved catalog work. [Acceptance](TL5-acceptance.md) records exact scope and evidence; [smoke guide](SMOKE-TESTS.md) has working links.
- Checks: 1,877 combined tests, five package typechecks, lint359, separate Convex typecheck and production build pass. Independent backend19 and question14 probes passed. Live API31 checks plus three rule checks; actual provider intent path; actual browser question/event/rule/nested/catalog/reload flow. Desktop1280 and phone390 screenshots saved in evidence/; no page overflow, final console error list empty.
- Runtime: own Next3107 and anonymous Convex3240/3241 remain running. Optional language intent reader configured using existing intended backend key; no key in source or output. Shared navigation still opens the older prototype; use the weekly route/links in the smoke guide.
- Decisions: ambiguous amount/direction/count/unsupported rule semantics clarify rather than reinterpret. Rule-only proposals use immutable rule revisions; event+rule proposals save atomically. Cash minima check Sunday close; multi-action receipts describe group attribution. All Timeline work uses Codex under user's explicit override.
- Next: delivery through TL5 complete. TL6 health/risk/chart handoff needs a new scoped card and agreed seam with Field; TL7 automatic analysis and TL8 rejoin remain follow-on. Real Field export and production authorization remain separate gates.
- Preserved: main, timeline/main, peer services/data, Dashboard.tsx, shared contracts/root schema/engine/styles. No push/PR/main merge. CLI-installed untracked helper guides remain local; do not accidentally commit them. Worker worktrees retained for review.

## 2026-10-24: Codex owns all Timeline work

- Latest explicit user direction: "use codex for all of the timeline stuff." This overrides the earlier Claude-implementation/Codex-audit split for this lane. Codex now implements, audits and integrates Timeline; Field ownership is unchanged.
- Claude original passes are committed. Its repair attempts hit a session cap; preserve partial backend/UI edits. Three Codex workers now finish TL2B-R1, TL2U-R1 and TL3Q-R1 in their existing separate checkpoint worktrees. Lead stays on TL5-checkpoint and verifies combined code/runtime/browser.
- All core acceptance remains pending. See TL5-acceptance.md and /tmp/tl5-audit/review.md for reproduced boundary/meaning issues under repair.

## 2026-10-24: delivery extended through TL5

- User authorizes implementation through TL5 and parallel workers. Lead integration uses TL5-checkpoint; three separate Claude worktrees implement backend, UI and questions. Codex audits/integrates; main and timeline/main unchanged.
- Cards: TL2B-workspace-backend, TL2U-workspace-screen, TL3Q-timeline-questions. Fixed local API: TL2-TL5-interface.md. Acceptance remains pending in TL5-acceptance.md.
- Own local services resumed on 3240/3241 and 3107. Existing saved TL1 baseline still reads 13 points. No peer ports/data reset or dashboard changes.

## 2026-10-24: TL1 ready for local smoke test

- Done: backend e9e3f3c independently accepted after three boundary repairs; UI d1b8a37 reviewed; combined on TL1-checkpoint. Actual browser save/reload and API retry/tamper checks pass. 1,661 combined tests, typechecks/lint/production build pass. [Acceptance evidence](TL1-acceptance.md).
- Try: http://127.0.0.1:3107/playground/timeline-seam -> load Kestrel weekly seed -> review assumptions -> Save forecast -> reload saved link. Thirteen saved weekly values remain identical. Load tampered copy to verify rejection. [All smoke gates](SMOKE-TESTS.md).
- Next: TL1C constraints on its own named checkpoint branch, then TL2 event/chart integration. User confirmed current delivery through TL1 first. Field owns dashboard; skip its component.
- Watch out: explicit neutral assumptions, not the old learned-model prototype; imported unsupported forward fields reject rather than silently miscalculate. Browser checked at 719px, no separate phone viewport claim. Local services left running; no push/main/lane-main merge/provider call. CLI-generated api.d.ts updated; installed local AI guides/skills stay untracked.

## 2026-10-24: dashboard transferred to Field

- Latest user direction: Field owns dashboard content and `apps/web/components/timeline/dashboard/Dashboard.tsx`. Timeline must skip this file. Earlier content ownership is superseded.
- Timeline still owns computed health, risk scenarios and saved 13-week chart data, delivered through the agreed seam at integration. Current WeeklyResultRefV1 has health/branchIds/route, not embedded chart arrays or detailed scenarios; interface extension/read-access design recorded in boundary-requests.md. No shared contract edit made.
- TL1 backend/UI scope is unchanged; its smoke UI is the Timeline playground. Lead continues auditing/combining workers on TL1-checkpoint; no main/lane-main merge.

## 2026-10-24: checkpoint branch names

- User requests branch names by checkpoint. Preview/review checkout now uses TL1-checkpoint; implementation worker branch renamed TL1-saved-baseline in ../domino-TL1. Repository main remains untouched; no TL1 feature code is written on timeline/main.
- Next milestones use TL1C-constraints, TL2-events, TL3-questions and TL4-catalog-style checkpoint names. Do not silently merge into repository or lane main.

## 2026-10-24: local backend running and shared shell merged

- Done: `origin/shared/shell` published and fast-forward merged at f20f0c4. Repeated fetch/merge at user's request: already up to date. Dashboard slot is available; content remains its placeholder.
- Runtime: own anonymous local Convex 3240/3241, Next 3107, both running from this worktree. Browser verified seam `historical.getCase` returning 2U/7 facts and the live `/c/kestrel` computed company with 11 scenarios. Existing computed seed created synthetic inputs/engine outputs; second invocation returns created:false. Capabilities addEvent/simulate true, nextWeek false. See [LOCAL.md](LOCAL.md) for URLs/restart.
- Checks: pnpm check passes 1,610 tests (web fresh 467; four other packages cached), five package typechecks/lint 313 files; separate Convex typecheck and lane import inventory pass (18 legacy, zero harness). Tracked generated bindings unchanged. Browser/runtime success is for existing prototype/seam, not the new weekly conversational feature.
- Files: ignored local deployment/environment plus CLI-installed untracked Convex AI guides/skills. No secrets printed or copied from peer, no provider calls, no schema/source edits beyond the authorized shell merge, no push or main/peer merge. Existing services on 3210/3230 preserved. Planning changes remain local/uncommitted.

## 2026-10-24: user-defined constraints added to core scope

- Done: added TL1C and CONSTRAINTS.md for prompt-defined or later-edited rules, confirmation/clarification, immutable versions and explicit action/rule/date/value violation explanations. TL2-TL5 acceptance now includes rules and preserves old runs after edits.
- Reuse: engine already evaluates minimum usable cash, minimum runway and targeted bill deadlines. Missing: user authoring, versioned Timeline persistence, conversational extraction and structured violation presentation. New constraint kinds and shared evaluator access require the shared checkpoint.
- Watch out: cash minimum currently checks weekly close; a baseline breach must not be falsely attributed to the new action. Unsupported/outside-horizon rules are not passing rules. No implementation or separate project/chat created; this request is recorded within the existing Timeline feature.

## 2026-10-24: shared shell pickup pending publication

- User directs merging `origin/shared/shell` into the Timeline worktree and assigns `apps/web/components/timeline/dashboard/Dashboard.tsx` content to Timeline.
- Fetched origin and checked remote heads directly: `shared/shell` is absent. No merge or dashboard replacement attempted; existing local planning changes preserved. Retry the authorized merge after the branch is published.
- Roadmap and boundary ownership record updated. This resolves dashboard ownership, not the unpublished branch dependency or missing health backend.

## 2026-10-24: roadmap aligned to interactive timeline

- Done: user clarified the primary experience as existing data -> questions/events -> calculated effects, including future events. Updated BRIEF and ROADMAP with TL1-TL5 core delivery, concrete acceptance and TL6-TL8 follow-on dashboard/auto-analysis/rejoin scope.
- Next: TL1 input provenance decision and scoped backend/schema cards, then saved baseline. Structured event simulation precedes natural-language orchestration; both use one engine path. No implementation or worker launched by this planning pass.
- Watch out: observed history remains fixed; ambiguous events clarify required inputs; answers cite the selected run's evidence. Final real Field exchange is a separate gate. Fetched origin; HEAD still matches origin/timeline/main at ffdb603. Documentation is local and uncommitted, not yet published to the other computer.

## 2026-10-24: local split pickup and backend inventory

- Branch/worktree: `timeline/main`, `/Users/micahlai/code/domino-timeline`, tracking `origin/timeline/main`. Fetched and pulled; both remote lanes were `ffdb603`, the published common base. No push was needed to obtain the split. Local primary checkout and its uncommitted work were preserved.
- Scope: weekly dashboard, 13-week timeline, scheduled items, nested scenarios/rejoin/failure, automatic analysis and a saved weekly simulation catalog. Follow `prompts/shared/friend-timeline-feature-owner.md` and the weekly BRIEF; older quarterly/P0-blocked roadmap prose is stale. [ROADMAP.md](ROADMAP.md) now records the source-backed inventory and queue.
- Done: source/contract/schema/release inspection, frozen dependency install, full uncached `pnpm check` on Node 26.3.1 (contracts 496 + engine 344 + sim 5 + agents 298 + web 466 = 1,609 tests; five typechecks; lint 307 files), and separate `tsc --noEmit -p convex`. Import inventory: 18 legacy cross-lane imports, zero in seam harness files. The script fails for harness crossings only; inspect its inventory for any new non-harness crossing too.
- Next: TL1 scoped implementation card, after resolving the model/rule provenance and independent persistence identities in [boundary-requests.md](boundary-requests.md). Existing engine and chart are reusable; the weekly harness only verifies/displays seeds. No weekly seed persistence, health service, background analysis job or weekly catalog implemented by this pickup.
- Runtime: no local backend or app server started for this worktree, no copied environment, no provider calls/data migration. Use free isolated ports and the setup in `../SEAM-HARNESS.md`; preserve 3102/3210/3214 and all other occupied ports. NVM setup in that guide does not exist on this machine; current installed Node/pnpm worked for checks.
- Limits: no new build/browser/live-database acceptance. Release file records earlier lead checks, not fresh runtime evidence here. No feature code, schema/shared-contract changes, main merge, peer merge or worker dispatch. Graphify skill was read; no graph exists in this checkout, so inventory came from direct source inspection.
- Ownership: keep updates feature-local. Shared contracts, root schema, shared engine math/styles and peer-private code require a joint checkpoint. Legacy computed helpers depend on Field-owned inputs/log and cannot be treated as a ready independent weekly backend.
