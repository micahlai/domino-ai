# E7 · Wire the actions + grading and learning (Jayden)

Tool: Claude Code. Branch: `E7-wiring`. Folders: `apps/web/convex/actions/`, `packages/engine` (grade, learn). Depends on: E4, E5, E6.
Skills: kb-sync, engine-tdd, demo-check.

## Prompt

```
Load the kb-sync, engine-tdd and demo-check skills. Read kb/spec/convex-api.md (Actions), build-spec §6.5 and §3.

1. packages/engine: grade(previous, actualBank) and learn(snapshot, model, history) per §6.5, test first.
   learn keeps a change only if mean error on past weeks goes down; it records errorBefore and errorAfter.
2. apps/web/convex/actions/: connect.run, engine.recompute, engine.addEvent, engine.simulateFix,
   agents.proposeFixes, agents.explain, week.advance, exactly as in convex-api.md. Write progress text to
   sources.step so the connect screen animates. Write every step to the log table with its actor.
   recompute must write resilience with AND without the top fixes, history and pastEvents.
3. Cache agent results (explanations table, by input hash) so the demo replays fast.
4. week.advance: sim.advanceWeek -> re-seed changed records -> pull -> grade -> learn -> recompute -> weeklyBrief.
5. Run the demo-check skill end to end on your dev deployment. Fix what breaks in your folders; file requests for others.

When done: pnpm check passes, board row E7, handoff with the demo-check result.
```
