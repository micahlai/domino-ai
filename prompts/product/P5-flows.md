# P5 · Branch detail, connect screen, add event, next week (Micah)

Tool: Claude Code. Branch: `P5-flows`. Folder: `apps/web/app`, `apps/web/components/`. Depends on: P4.
Skills: kb-sync, ui-build, taste.

## Prompt

```
Load the kb-sync, ui-build and taste skills. Read design-spec §1, §4 and build-spec §3 (user flow).

1. /connect: company create form (name, profile kestrel/tally/orbit) -> companies.create, then a live ConnectChecklist from
   sources.list showing each step text as it changes (found -> reading docs -> mapped -> tie-out ok / needs review).
   When status is "ready", go to /c/[companyId]. Make this feel alive: rows appear one by one.
2. /c/[companyId]/branch/[branchId]: BranchChart (Recharts lines for the branch, its parent and siblings, lender's limit),
   explanation text (explanations.forBranch, request agents.explain if missing), DominoChain, FixCards.
3. AddEventDialog: templates from kb/scenarios.md (late payment, lost renewal, cloud spike, credit line lowered, early big deal)
   with simple fields; builds Change[]; events.add. Shows the new future appearing in the multiverse.
4. Next week button: week.next with a confirm; show a toast with the weekly brief when it arrives.

Run the taste skill. When done: pnpm check passes, board row P5, handoff.
```
