# P6 · Learning + record screens, polish (Micah)

Tool: Claude Code + Cursor. Branch: `P6-learning`. Folder: `apps/web`. Depends on: P5.
Skill files (in skills/): kb-sync, ui-build, taste.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/ui-build/SKILL.md, skills/taste/SKILL.md. Read design-spec §1 and §4.

1. /c/[companyId]/learning: LearningChart (forecast error % by week, falling; Recharts), RuleCards (models.latest rules:
   text, error before -> after, proof), and the latest weekly brief.
2. /c/[companyId]/record: table of approvals and log entries (who, what, when, refs), newest first, with proof links.
3. Landing page /: one sentence ("Domino stops cash problems before they start a chain reaction") and "Connect a company".
4. Polish pass on every screen with the taste skill: spacing, alignment, wording (design-spec §6), empty and loading states.
5. Keyboard: "R" on the main screen reloads cached results (demo fallback).

When done: pnpm check passes, board row P6, handoff.
```
