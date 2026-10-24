# E3b: Linked receipts and evidenced dominoes
- **Goal:** Forecast the C1 Kestrel snapshot without double-counting receipts and explain real rule breaches.
- **Folder:** `packages/engine/` only; exception: this card's Result in the worker checkout.
- **Contracts used:** Engine.forecast/dominoes, Deal.invoiceId, Constraint, DominoContext, Forecast, Domino, Change.
- **Depends on:** C1 merged at 3c54e67; reviewed E3a repair 4a9be26 integrated and combined checks passing before launch.
- **Done when:** forecast.test.ts and dominoes.test.ts cover the E3b acceptance cases in the implementation brief; raw fixtures.snapshot forecasts successfully; full `pnpm check` passes.
- **Notes:** Read `kb/spec/engine-e3b-e4-implementation.md`, the C1 contract document, AGENTS.md and skills/engine-tdd/SKILL.md. Fixture forecasts are illustrations, not numerical oracles.
- **Launch:** Human launches Codex GPT-6.1 Sol/high on E3b-dominoes in ../domino-E3b after the dependency gate; branch/worktree not created yet. Independent GPT-6 Astra review before integration.
- **Scope:** Preserve exact cents/date repairs; expose a shared internal rule evaluator for E4. No scanRisks/scoreFix/stressTest, shared contracts, dependencies, Convex, seed updates or network calls.
- **Coordination:** You are not alone. Preserve others' work; no main, board/handoff, merge, push or rebase edits. Stop at 90 minutes and report a split if unfinished.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
