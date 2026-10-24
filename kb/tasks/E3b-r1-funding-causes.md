# E3b-r1: Correct daily savings, causal attribution and bill identity
- **Goal:** Resolve all three blockers from the independent e77474d audit before E3b merges.
- **Folder:** `packages/engine/` only; exception: copy this card from main to this checkout and fill its Result.
- **Contracts used:** Existing Snapshot, Change, Forecast, DominoContext, Constraint and Domino; no shared contract edits.
- **Done when:** Regression tests reproduce then fix both hire-date cases, unrelated-event/drop causal blame and both duplicate-bill cases from kb/reviews/E3b-e77474d.md; all prior rounding tests and full `pnpm check` pass.
- **Notes:** Read the review from main, the E3b implementation brief and skills/engine-tdd/SKILL.md. Preserve weekly exact rounded totals while exposing actual daily savings; prove cause per candidate or omit the arrow; reject ambiguous bill IDs.
- **Launch:** Claude Code continues in ../domino-E3b on E3b-dominoes at e77474d. Codex independently audits the repair before merge or E4 launch.
- **Scope:** No new features, contracts, dependencies, Convex, provider calls or approval semantics. Preserve queue/horizon rules and evidenced consequences.
- **Coordination:** You are not alone. Do not reset/rebase/merge/push or edit main/board/handoffs; keep existing work. Commit scoped changes plus your local card Result, record red/green outcomes and return the commit hash.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
