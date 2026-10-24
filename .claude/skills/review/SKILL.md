---
name: review
description: Review another agent's or person's diff before merge, against AGENTS.md, the contracts and the spec. Use on every pull request.
---

# Review

Read the task card, then the diff. Answer each item. Block the merge on any "no" in the first group.

## Must pass
- Only the folder on the task card changed (plus `kb/` updates).
- No change to `packages/contracts` or `convex/schema.ts` unless the card says so.
- Money is integer cents everywhere. No float math on money.
- Engine code is pure: no network, AI, `Date.now()` or randomness.
- Outside inputs are parsed with Zod.
- No secrets, no live Stripe keys, no answer-key imports.
- Tests exist for new engine/sim logic. `pnpm check` passes.

## Should pass
- The code does what the spec section says (cite the section).
- Names are clear. Functions are short.
- UI text follows design-spec §6.
- The board and a handoff entry are updated.

## Output
A short list: blocking issues first, then suggestions. Quote file and line.
