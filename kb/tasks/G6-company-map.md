# G6: grouped company map visual checkpoint

- **Goal:** a readable spatial company map with Sources and Toolbox groups, distinct Domino/agent/tool/source/output forms and truthful event pulses.
- **Ownership:** local sole UI writer, branch G6-company-map in domino-G6. Only apps/web/components/investigate/**, apps/web/app/playground/agent-canvas/** and this Result. No shell, lib/knowledge, backend, contracts, global styles, dependency or shared coordination edits.
- **Read:** AGENTS.md, HANDOFF.md, kb/spec/company-map-2026-10-24.md, canvas-ui-packet and investigation-api in kb/coordination/historical. User explicitly permits Claude implementation. /orchestrator and /ponytail full, skills/taste/SKILL.md, /Users/jaydenl/.agents/skills/ui-ux-pro-max/SKILL.md. No children for this bounded checkpoint.
- **Implement:** spec sections Call/boundary and Truthful motion. Company knowledge is a presentation view of existing saved evidence, distinct from Domino; provide a small optional knowledge-detail render slot for G8, no fabricated facts/learnings or new API. Containers group actual node records, not invented executions. Keep actual edges; any group membership connectors must be visibly distinct from operation dependencies and never pulse. Preserve financial output, instructions, conversation, retry/reload and keyboard accessibility.
- **Motion contract:** dependency pulses represent new observed operation activity, not byte transfer. Deduplicate across unchanged snapshots; no animation on initial history/reconnect. No looping traffic. Reduced-motion disables travel/pop. Do not infer hidden tools/subagents. Preserve moved nodes, fit all group bounds, no overlapping labels or click-blocking group layers.
- **Acceptance:** focused tests for group membership/topology, event pulse dedup/quiet restore, reduced motion and retained drag/selection. Existing investigate focused suite, typecheck and touched-file lint pass. Clearly labelled manual fixture exercises multiple groups, failure and unknown provider. Codex owns fullsuite/build/browser and visual acceptance; do not claim those yourself.
- **Budget:** Sonnet/high, single process, checkpoint within 35 minutes. No live provider, browser, server, full suite/build, secrets, push/merge, purchases or fallback. You are not alone: friend owns new lib/investigation-knowledge files. Preserve others' work. Commit own files and Result, then stop.

## Result
Status: implemented, committed locally on G6-company-map. Not merged, not pushed. Codex still owns full suite, build, browser and visual acceptance.

**What changed** (only `apps/web/components/investigate/**`, `apps/web/app/playground/agent-canvas/**`, this Result)
- `graph.ts`: `layout(nodes)` is now a deterministic company map keyed on kind and arrival order, not edges. Domino centre, Sources left, Toolbox right, specialists above, Company knowledge just below Domino, results below that. A node's slot never depends on later arrivals, so moved nodes stay put. `zones()` frames real Sources and Toolbox members (bounding box, count; an empty group shows "none yet"; nothing for a lone idle Domino). `withKnowledge()` derives the Company knowledge view only from evidence already on source nodes. `pulsesFor()` and `isHistory()` implement pulse dedup and quiet restore.
- `MapParts.tsx` (new): `ZoneView` (light dashed frame, pointer-events none, not focusable) and `FlowEdge` (the real dependency line plus one dot that travels once, no repeat, none under reduced motion).
- `InvestigateWorkspace.tsx`: per-kind shapes and tints (Domino circle with logo, rounded agent tile, portrait source card, small tool tile, wide result card, rounded data-stack knowledge node). Failed and running outlines still win over kind colour. Knowledge details: saved sources, optional `renderKnowledge` slot (new optional prop, for G8), and "No validated learnings are recorded." A dashed Domino-to-knowledge link marks it as a view, never pulses. Caption: "A dot on a line marks newly recorded step activity, not data moved."
- `types.ts`: kind `knowledge`, prop `renderKnowledge`. No contracts, shell, lib, backend or dependency changes. Live adapter output is untouched.
- Fixtures: new "New company map session (fixture)" button: 4 sources (1 failed), a specialist with no recorded provider or model, 1 good and 1 failed tool, 2 results, and a knowledge slot placeholder. Labelled as fixtures.

**Truthful motion**
- A pulse fires only when a node is first seen running or succeeded in a live delivery, along existing dependency edges that point at it. Keyed by node id plus status, so unchanged polls repeat nothing. A step that finished between polls pulses once without a made-up running interval. Failed and queued work never pulse.
- Restore, loading, offline, unavailable and the delivery right after them are quiet (this widens the old loading-only rule for node entrances too). Reduced motion removes the pulse dot and the pop.
- No membership connectors exist, so none can pulse.

**Verified** (run from `apps/web` unless noted)
- `npx vitest run components/investigate`: 5 files, 97 tests pass (was 484-line suite; graph tests rewritten for the new layout, new tests for slots, groups and topology, knowledge, shapes, pulse dedup and quiet restore, reduced motion, retained drag and selection).
- `npx tsc --noEmit`: clean.
- `npx biome check apps/web/components/investigate apps/web/app/playground/agent-canvas` (repo root): clean after `--write` formatting of those same files.

**Not verified**
- No browser, server, full suite or build. Zone frames and the dot rely on xyflow honouring explicit node `width`/`height`, `zIndex -1` under other nodes, and SVG circle animation. Please check these first.
- Fit includes the frames only through xyflow's own node bounds. Not seen on screen.
- Straight dependency lines can cross Domino or other nodes (e.g. a left source to a right tool). The Workspace effect wiring (not the pure helpers) has no DOM test.
- The quiet-delivery change to `isHistory` also affects node entrances and the fit duration; reviewer may want to confirm that is wanted.

**API changes inside the folder:** `layout(nodes)`, `toFlowNodes(current, incoming, quiet)` and `deliver(current, incoming, options)` no longer take `edges`.

## Repair 1 requested by independent Codex audit
- Reconnect catch-up must stay quiet: offline/queued -> live/cached queued -> live/catch-up succeeded currently pulses historical work. Convex reports socket connected before query catch-up. Use a recovery latch keyed by content fingerprint (IDs/statuses), not parsed array identity; consume it only when a changed snapshot arrives, update seen quietly. Without an authoritative freshness marker, conservatively suppress that first changed snapshot and document this tradeoff. Test this exact multi-render sequence, including repeated unchanged cached snapshots and subsequent true live transitions. No backend changes.
- Group captions claim queued records already ran: Tools this run used and Saved documents loaded for this run. Use neutral concise descriptions of recorded tool/source steps. Counts remain recorded node counts, not connected systems/documents.
- Preserve the visual design. Parent browser observed the saved graph, frames and knowledge node after restoring3214. Source caption wraps into header space; concise neutral wording must fit without overlapping children. No shell edits yet.
- Focused tests/typecheck/lint, append Result and commit. No fullsuite/build/browser/provider/push. Codex will rerun acceptance.

## Result: Repair 1
Status: implemented, committed locally on G6-company-map. Not pushed. Codex still owns full suite, build, browser and visual acceptance.

- **Reconnect latch** (`graph.ts` `settle`, `fingerprint`, `Recovery`; wired in `InvestigateWorkspace.tsx`). Replaces `isHistory`. Loading, offline and unavailable hold the latch. After the connection returns, unchanged snapshots (compared by id:status fingerprint, not array identity) stay quiet and keep it held; the first changed snapshot (catch-up) is also quiet, updates `seen`, and releases it. Later changes pulse normally. Node entrances and fit stay quiet on the same signal.
- **Conservative tradeoff:** there is no authoritative freshness marker (Convex reports the socket connected before the query catches up), so a genuine live step that is the first change after a reconnect also shows without motion. A missed pulse is preferred over replaying old work as new. Documented in the `settle` comment. No backend change.
- **Captions** (`MapParts.tsx`): "Recorded source steps" and "Recorded tool steps"; empty groups say "None recorded yet". Counts are recorded node counts. Shorter than before, so the caption should stay on one line in the frame header. Visual design, layout and financial output unchanged.
- **Tests:** new "reconnect recovery latch" suite runs the offline -> cached queued -> same-content new array -> catch-up -> true live transition sequence through `settle` plus `pulsesFor`; repeated unchanged cached snapshots; away states never release; plain live is not held. Caption test asserts neutral wording.
- **Verified:** `npx vitest run components/investigate` (apps/web): 5 files, 101 tests pass. `npx tsc --noEmit`: clean. `npx biome check --write` on the two owned folders: clean.
- **Not verified:** no browser, so caption fit in the frame is unseen. The Workspace effect wiring of `settle` has no DOM test; the pure sequence is tested.

## Repair 2 requested by parent browser check
- At 390x844 after FitView, the absolute brand/title/status and pulse caption overlapped the Sources group. Reserve compact space on small screens instead of covering the graph.

## Result: Repair 2
Status: implemented, committed locally on G6-company-map. Not pushed. Codex owns browser, full suite, build and visual acceptance.

- **Change** (`InvestigateWorkspace.tsx` only, plus one test): the brand/title/status block moved above the canvas in the Canvas section. Below `lg` it is a normal-flow one-row toolbar (`flex-wrap`, bottom border, logo 44px tall) so the canvas starts under it and FitView fits only the free space. From `lg` up it is the same absolute top-left column as before (`lg:absolute lg:left-4 lg:top-4 lg:flex-col`), so desktop is unchanged.
- **Caption:** "A dot on a line marks newly recorded step activity, not data moved." is `sr-only` below `lg` (still read by screen readers) and visible from `lg`. Status text and the `h1` stay visible.
- **Side effect:** the Domino home link is now first in DOM and tab order, as it reads on screen. Canvas keeps `min-h-[45dvh]`; the page still scrolls (`overflow-y-auto`) and the Conversation panel is unchanged.
- **Verified** (apps/web): `npx vitest run components/investigate` 5 files, 102 tests pass (new test: header precedes canvas, toolbar classes, caption sr-only until lg). `npx tsc --noEmit` clean. `npx biome check --write` on the two owned folders clean.
- **Not verified:** no browser. Please check at 390x844 that the toolbar fits on one or two rows with a long status label and that the canvas height is still useful.
