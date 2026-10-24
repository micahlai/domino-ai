# P4 · Main screen assembly (Micah)

Tool: Claude Code (Cursor for live tweaks). Branch: `P4-main-screen`. Folder: `apps/web/app/c/[companyId]`, `apps/web/components/`. Depends on: P2, P3.
Skills: kb-sync, ui-build, taste.

## Prompt

```
Load the kb-sync, ui-build and taste skills. Read kb/spec/design-spec.md §2, §4, §6 and kb/spec/convex-api.md.

Build /c/[companyId] per the layout in design-spec §2:
1. Top bar (company, week, Add event and Next week buttons wired to mutations; disabled with a tooltip until actions exist).
2. ResilienceBar + MultiverseTimeline from Convex (resilience.get with withFixes false and true, history.get, constraints.list).
3. Bottom panels: RiskList (risks.list), DominoChain for the selected universe/branch, FixCards (fixes.forBranch) with
   Simulate / Approve (approvals.decide with a confirm dialog) / Show proof.
4. ProofDrawer (Sheet) showing Evidence: source badge, ref, quote block, note.
5. Selecting a universe line selects the matching event branch and shows its chain and fixes.
6. Headline sentence computed from data in plain words (design-spec §6), for example "Kestrel survives 7 of 11 futures".
7. Every component also in /playground with fixtures. Loading skeletons with status text.

Run the taste skill and fix the top 3 issues. When done: pnpm check passes, board row P4, handoff.
```
