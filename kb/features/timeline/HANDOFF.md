# Timeline handoff

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
