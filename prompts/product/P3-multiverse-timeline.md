# P3 · The multiverse timeline (hero) (Micah)

Tools: Figma Make first (20 min), then Claude Code. Branch: `P3-multiverse`. Folder: `apps/web/components/multiverse/`. Depends on: P1.
Skill files (in skills/): kb-sync, ui-build, taste, figma-stage-log.

## Before coding (Figma)
1. In Figma Make, prompt: "A wide timeline chart. Left: 26 weeks of past cash as a solid line with event dots. A dashed vertical
   'Today' line. Right: 11 thin future lines fanning out from today, some ending in green checks, some breaking below a red
   dashed 'Lender's limit' line with a red cross. Above: 'Survives 7 of 11 futures (64%)' and an 'Apply fixes' toggle that makes
   broken lines bend up and turn green. Clean, white, Inter, one blue accent." Iterate 2 to 3 times.
2. Log the stage with the figma-stage-log skill. Share the Make file to "Anyone".

## Prompt (Claude Code)

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/ui-build/SKILL.md, skills/taste/SKILL.md. Read kb/spec/design-spec.md §2 and §3 fully, and the multiverse types in
packages/contracts/src/branches.ts. If the Figma Dev Mode MCP server is available, read the Figma Make frame I link: <paste link>.

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
and a stage-log entry for the code generation stage.
```
