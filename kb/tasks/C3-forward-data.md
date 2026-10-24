# C3: Forward billing and settlement data
- **Goal:** Represent known recurring revenue, pending processor cash and durable simulator transitions without inventing observed records.
- **Folder:** packages/contracts only; exception: this card Result.
- **Contracts used:** Snapshot, Invoice, Bill, FieldMapping, WorldState, PlannedEvent, LearningExample and new BillingPlan/PendingPayout/runtime schemas.
- **Done when:** The exact optional additions in kb/spec/forward-data-contract.md pass invariant/legacy/round-trip tests and full pnpm check. No feature behavior changes.
- **Notes:** Read forward-data-plan.md, forward-data-contract.md and skills/contract-change/SKILL.md. E7a is reviewed/merged and E6b is independently approved. Lead now dispatches this isolated contracts slice. Do not populate new fields before consumers adopt them.
- **Scope:** Schemas, inferred exported types, focused contract tests and Result only. Keep existing fixtures valid and unchanged. No dependencies or web schema migrations.
- **Coordination:** You are not alone. No engine/sim/agents/web/env/other-checkout edits, secrets, network, subagents, external messages, board/handoffs, pull/rebase/reset/stash/merge/push. Commit owned files for independent audit.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
