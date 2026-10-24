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
