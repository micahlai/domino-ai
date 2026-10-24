# C1: Prepare engine context contracts
- **Goal:** Produce a reviewable contracts-only patch unblocking correct E3b/E4 implementation.
- **Folder:** `packages/contracts/` only; brain records Result in main after worker returns.
- **Contracts used:** Deal, Snapshot, Constraint, Branch, FixCandidate, Engine, new DominoContext and FixScoreContext.
- **Done when:** Link/reference, field preservation, legacy omission, constraint and context tests pass; full `pnpm check` including web passes; branch diff contains only contracts and fixtures/tests.
- **Notes:** Read `kb/spec/engine-context-contract-proposal.md` as the precise design, `skills/contract-change/SKILL.md`, AGENTS.md and existing consumers before editing.
- **Scope:** Optional fields/arguments with inferred Zod types; no engine implementation, Convex schema/migration, manifests or dependencies. Do not touch Claude's E3a checkout.
- **Launch:** GPT-6.1 Sol/high in sibling `domino-contract-engine-context`, branch `contract-engine-context`; user authorized preparation, not contract merge.
- **Coordination:** You are not alone. Do not edit main, board/handoffs or this card. Commit only your owned folder and report exact verification/limits; no merge/push/team messages.
## Result (brain records worker result)
- Done: prepared local f80401d on contract-engine-context; independent GPT-6 Astra review found no blockers. Lead reran full forced check: 103 tests, five typechecks and lint passed under Node 24.
- What changed (files): packages/contracts/src/core.ts, branches.ts, modules.ts, fixtures/index.ts and engine-context.test.ts. Contracts-only diff; 22 new tests, 35 contract tests total.
- Watch out: not merged or pushed. Engine enforcement and seeded-data backfill remain later work. One-to-one invoice links intentionally reject split billing. Claude's E3a branch is untouched. See kb/reviews/C1-f80401d.md.
