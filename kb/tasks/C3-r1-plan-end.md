# C3-r1: Enforce plan end date on linked invoices
- **Goal:** Reject invoice issuance after the plan's last permitted issuance date.
- **Folder:** packages/contracts; exception this card Result.
- **Contracts used:** BillingPlan.endDate and Invoice.billingPlanId inside SnapshotSchema.
- **Done when:** Red/green test rejects Jan31 anchored monthly plan endDate2026-09-30 with linked invoice issued2026-10-31, cursor2026-11-30, cutoff2026-10-31. Issuance exactly on endDate and retained earlier historical invoices pass; canceled plan cursor after endDate stays valid. Full pnpm check passes.
- **Notes:** Independent Astra probe /tmp/c3-independent-audit.ts. endDate means last permitted issuance, not last collection. Smallest contracts-only repair. InvoiceSchema.shape consumer incompatibility is recorded and will be handled by the integration owner in a separate provider slice after E6c; do not touch agents here.
- **Coordination:** You are not alone. Same C3 worktree, no other folders/env/network/deps/subagents/other checkout edits/pull/rebase/reset/stash/merge/push. Fill Result and commit owned files. Thirty-minute checkpoint.
## Result (worker fills this in when done)
- Done: Snapshot cross-check now rejects a plan-linked invoice issued after `plan.endDate` (path `invoices[i].issued`). Red first (endDate 2026-09-30, issued 2026-10-31, cursor 2026-11-30, asOf 2026-10-31 parsed as valid), green after the fix. On-endDate issuance, earlier history and a canceled plan with cursor past endDate all pass. `pnpm check` exit 0 (162 contracts tests).
- What changed (files): `packages/contracts/src/core.ts` (one `else if` in the linked-invoice loop), `packages/contracts/src/forward-data.test.ts` (3 tests under "plan end date"), this card.
- Watch out: Did not run `/tmp/c3-independent-audit.ts` (no `tsx` in the workspace); the vitest cases cover its endDate scenario. The check is in the same `else if` chain as the cadence/asOf/cursor checks, so an invoice already failing one of those reports only that first `issued` issue. InvoiceSchema.shape consumer issue untouched, per card.
