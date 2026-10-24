# E6d: Adopt reviewed forward-data contracts in provider schemas
- **Goal:** Keep provider prompts and structured outputs compatible with C3 contracts before C3 reaches main.
- **Folder:** packages/agents; exception this card Result.
- **Contracts used:** C3 InvoiceSchema refinements, BillingPlanSchema, PendingPayoutSchema and FieldMappingSchema.entity.
- **Done when:** Module import and full pnpm check pass with C3; mapping schemas and prompts include both new entities and current canonical fields; parity tests fail for omitted enum values, not just missing keys.
- **Notes:** InvoiceSchema is now ZodEffects, so Object.keys(InvoiceSchema.shape) crashes. Read the underlying object via its public innerType accessor without removing refinements. New plans/payout schemas are also refined. Preserve strict Claude output dialect and CREAO validation, existing provider behavior and new E6c diagnostics when merged.
- **Scope:** Add prompt canonical fields for billingPlans/pendingPayouts, derive or validate entity enums against FieldMappingSchema, update only affected fixtures/tests. Include valid new-entity mapping on both backends and invalid entity rejection. No actual new data emissions or provider calls.
- **Coordination:** You are not alone. C3 is already integrated in this isolated branch for validation, main is intact. No contracts/engine/sim/web/deps/env/network/other checkout edits/subagents/board/handoffs/pull/rebase/reset/stash/merge/push. Commit owned files and Result. Thirty-minute checkpoint.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
