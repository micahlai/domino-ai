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
- Done:
- What changed (files):
- Watch out:
