# Remaining project stages and overnight scope

User direction: prepare a fresh Claude orchestrator with evidence/backend subagents and a UI subagent on this same computer, then scope an overnight run. This document supersedes the assessment-only launch hold. It does not authorize main merges or production deployment. Launch prompts are prompts/shared/H0-overnight-orchestrator.md and prompts/product/H3-historical-ui.md.

## Call

Aim to wake up to one reviewable historical journey on a preview branch: curated case, frozen forecast, later disclosure reveal, honest comparison and one costed alternative. Three concurrent implementation workers total on this computer: evidence, backend, UI. Claude coordinates implementation; Codex performs the independent morning audit and final integration.

Counterargument: more agents could produce more screens, but evidence and shared contracts are the limiting dependencies. A smaller validated journey is more useful than a large demo with invented history. The separate agent canvas is a later stage, not an overnight gate.

## Stages and exit gates

| Stage | Deliverable | Owner / parallel work | Exit gate |
| --- | --- | --- | --- |
| 0. Launch and ownership | Latest integration branch, isolated worker branches, start time and checkpoints | Claude lead; UI subagent in its own worktree | Exact base SHA and file ownership recorded, no duplicate writers |
| 1. Evidence and contract freeze | One company/cutoff, source/fact/assumption manifest, separate later observations, API/contract packet | Evidence research and backend contracts overlap; UI builds presentation previews | Source availability and cash definitions checked; versioned contracts and example payloads published |
| 2. Financial replay backend | Deterministic period model, immutable runs, reveal, comparison and one intervention | Backend, consuming reviewed evidence; UI continues on frozen contracts | Leakage/money/period tests pass; no held-out data enters forecast path; stored forecast unchanged by reveal |
| 3. Historical UI | Load, save, reveal, compare, simulate, proof | UI subagent in its own worktree | Financial chart preserved; dates/units/labels correct; keyboard/mobile/reduced-motion checks; no fake successful network actions |
| 4. Preview assembly | Evidence + backend + UI on preview/historical-overnight | Claude lead merges exact checked commits, routes fixes to owners | Full checks/build and local browser journey pass; reload preserves saved forecast/reveal state; sources and costs inspectable |
| 5. Independent audit and stabilization | Codex checks money, sources, leakage and browser flow | Morning, before main integration | Material findings resolved; limitations visible; user can review result |
| 6. Demo reliability and deployment | Short demo script, repeatable new-run/fixture mode, rehearsal, approved deployment | After core audit | One clean rehearsal, no live-provider dependency for core, production only with authorization |
| 7. Agent page, optional | Separate pan/zoom agent/source/tool graph and persistent conversation | After core is defensible | Actual operations drive status/animation; evidence and outputs open; no fabricated activity |
| 8. Submission | Video/screenshots, README, attribution and limitations, final rehearsal | Product + engineering | Claims match verified behavior; startup/recovery steps work; no secrets in artifacts |

Do not promise a time estimate for each stage. The overnight target is stages 0-4, conditional on evidence and integration gates. Stages 5-8 are the rest of the project, not automatic scope expansion when a worker finishes early. No second company, broad disaster scenarios, arbitrary tool generation, unlimited agents or synthetic weekly learning pipeline.

## Parallel dependency plan

Start evidence and backend agents together. Backend first builds the additive historical schemas and validators using clearly synthetic unit fixtures, then freezes the packet. It must wait for checked evidence before choosing real-case forecast parameters or claiming a historical result. UI can immediately build props-only presentation and explicit preview states; it must wait for the packet before API wiring. This permits real overlap without inventing independent interfaces.

Backend works sequentially through contracts, pure engine and persistence cards. One agent owns all three phases, so there are exactly three implementation workers: evidence, backend and UI. UI owns no contracts, schema or generated API files. Backend owns no app routes or visual components. Reviewers may be read-only; they do not become extra writers.

2U is the default candidate. Evidence may select Appgate or WeWork if 2U cannot support a coherent cutoff and costed intervention, documenting why. Do not select by whichever held-out result looks best. Do not stall all work on company choice: generic contracts and UI presentation remain useful. Preserve all P5 interfaces; original connect/week actions stay gated and historical operations use separate entry points.

## Overnight boundaries and recovery

- Default maximum run: six hours from launch, or stop earlier when stages 0-4 pass. This is a ceiling, not a completion estimate. Record a local start timestamp and deadline. Finish the current safe checkpoint at the limit; do not begin another repair cycle.
- Every 30 minutes and after each meaningful phase, record actual commit SHA, checks, blocker, process ownership and next step. Commit only owned coherent work. A running process or optimistic log is not evidence of completion.
- At most two repair attempts for the same failing gate before parking that lane with reproductions. Continue independent work. Never weaken tests or invent data to clear a gate. If a dependency cannot be validated, stop dependent work at a clean checkpoint.
- Push only assigned feature, coordination and preview branches, using normal non-force pushes. No main push, rewrite, reset, stash, deletion of others' work or production deployment. An unavailable credential becomes a documented blocker; do not hunt auth files or leak values.
- Shared cloud Convex/database accounts are not isolated by worktrees. Do not run convex dev/deploy against the shared deployment or reseed it overnight. Use existing test infrastructure and isolated local development when supported. If local runtime needs unavailable setup, finish tests/build/presentation and report the missing live gate.
- Single-machine resource limit: serialize dependency installs, full checks, production builds and browser verification. Focused worker tests may overlap. One owned preview server/local backend only, on an available port; preserve unrelated processes. Do not interpret idle time waiting for this resource as a blocked implementation.
- No new paid external AI loops or live connector calls. Core forecasting is deterministic. Existing Claude subagent usage is the implementation work; source reads use public primary documents. Avoid installing new dependencies unless the scoped task demonstrably requires one and the coordinator records it.
- On macOS use AC power/open lid and optionally launch interactive Claude with caffeinate -i claude. This prevents idle sleep only; do not change system sleep settings. Record owned servers and stop only those processes at the end if no preview is needed.
- If one worker finishes first, publish its stable commit and Result, not a merge into main. The lead consumes exact local commit checkpoints and messages at phase boundaries; remote pushes preserve reviewable backups. If UI has not arrived by the deadline, deliver backend plus the UI-ready contract packet and state that assembly is incomplete.

## Morning report

Publish kb/coordination/historical/overnight-result.md on the preview branch (or coordination branch if assembly blocked): branch/commit SHAs; selected case and cutoff; tested demo URL/steps; tests/build/browser results; unverified gates; known defects; actual versus synthetic evidence; remaining exact task; owned server PIDs/ports; and source links. Include diff base and whether any dependency commits were adopted. Keep feature branches intact for Codex review.
