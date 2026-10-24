# E4-r1: Preserve daily risks and trustworthy timeline identity
- **Goal:** Fix the three blockers in kb/reviews/E4-2340ff8.md before E4 integration.
- **Folder:** packages/engine/ only; exception: this card's Result in the worker checkout.
- **Contracts used:** Existing Snapshot, RiskEvent, Universe and PastEvent; no shared type changes.
- **Done when:** Each exact review case reproduces red then passes; daily-risk output survives despite equal weekly totals; all risk sets have distinct stable IDs; no signing event uses expectedClose as an actual date; full pnpm check passes.
- **Notes:** Read the review from main, the updated E4 brief and skills/engine-tdd/SKILL.md. Preserve verified money/date/score logic and all E3b regressions.
- **Launch:** Codex directly runs Claude Opus in ../domino-E4, E4-multiverse at 2340ff8, under user authorization. Thirty-minute checkpoint; no second engine writer.
- **Scope:** Smallest repair and regression tests only. Keep ranking/top-five/all-adverse policies and genuine no-effect omission; do not restrict valid risk IDs. Omit dated big-deal signing markers until actual timestamps exist. No new feature, contract, dependency or provider work.
- **Coordination:** You are not alone. No other checkout, env, board/handoff, pull/rebase/reset/stash/merge/push or subagents. Commit owned engine changes and this Result. Record actual red/green evidence, full-check counts, limitations and hash.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
