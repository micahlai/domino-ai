# P3 · The multiverse timeline (hero) (Micah)

Tools: Codex or Claude Code, with a playground prototype. Branch: `P3-multiverse`. Folder: `apps/web/components/multiverse/`. Depends on: P1.
Skill files (in skills/): kb-sync, ui-build, taste.

## Before coding
Prototype the fan-out and fix toggle in `/playground` with contract fixtures. Review a screenshot with the taste skill.

## Prompt (Claude Code)

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/ui-build/SKILL.md, skills/taste/SKILL.md. Read kb/spec/design-spec.md §2 and §3 fully, and the multiverse types in
packages/contracts/src/branches.ts.

Build MultiverseTimeline exactly per design-spec §3 in apps/web/components/multiverse/:
- Custom SVG with d3-scale and d3-shape; animation with motion (Framer Motion). Props as in §3.1.
- Past line + event markers (tooltip on hover), Today line, base future, one path per universe with opacity by probability,
  break crosses at breaksAt, survive checks, lender's limit line, selected universe highlight.
- Motion per §3.3: past draws in, futures fan out one by one, score counts up; showFixes morphs every path between the
  no-fix and with-fix report (match universes by riskIds), red to green where they now survive. prefers-reduced-motion support.
- Responsive width (ResizeObserver). 60 fps on a laptop with 11 to 30 universes.
- ResilienceBar component per design-spec §4 with the toggle and breaking-point sentence.
- Playground section with fixtures.resilience, fixtures.resilienceWithFixes, fixtures.history, fixtures.pastEvents.

Run the taste skill on a screenshot and fix the top 3 issues. When done: pnpm check passes, board row P3, handoff,
and a screenshot of the playground prototype.
```
