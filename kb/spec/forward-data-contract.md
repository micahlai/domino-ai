# C3: Optional forward billing and settlement contracts

Prepared for backend completion, not yet dispatched. This freezes the next additive contract slice after the current engine and provider work is reviewed. The reasoning and rollout gate are in forward-data-plan.md. Existing fixtures must remain valid without new fields; no existing required field changes.

## Public schemas

- BillingPlan: id, customerId, amount (positive safe integer cents), anchorDate, nextInvoiceDate, everyMonths (1, 3 or 12), paymentTermsDays (nonnegative integer), optional endDate. Dates are real calendar dates. nextInvoiceDate is the first unissued occurrence: on or after anchorDate, with a month difference divisible by everyMonths and day equal to the original anchor day clamped to that month's final day. endDate is the last permitted issuance date and can precede nextInvoiceDate after cancellation. Add optional Snapshot.billingPlans. Within a snapshot, IDs are unique, customers must exist, and each cursor is strictly after asOf.
- Invoice additions: optional billingPlanId; optional collection object {payOn, amount} describing an observable agreed full settlement before it happens; optional paidAmount describing terminal gross collected before processor fees; optional writtenOff observation date. Original amount and due never change. New amounts are safe integers from zero through the original invoice amount. paidAmount requires paid. paid and writtenOff are mutually exclusive. New dates must be real; writtenOff cannot be after snapshot.asOf. No partial payment support is implied.
- An invoice with billingPlanId must reference exactly one same-customer plan. Its issued date must be on that plan's anchored cadence, on or before snapshot.asOf, and before the plan's nextInvoiceDate. Its amount is the original plan amount. Each plan/date occurrence appears at most once. Expired plans remain available for historical links.
- PendingPayout: id, amount (nonnegative safe cents, net of fees), expectedArrival (real calendar date), invoiceIds (nonempty unique IDs). Add optional Snapshot.pendingPayouts. Each payout ID is unique; an invoice cannot appear in two pending payouts. Every referenced invoice must exist exactly once, be paid on or before snapshot.asOf and not be written off. Net amount cannot exceed the sum of referenced gross paidAmount (or original amount for legacy fully paid invoices). expectedArrival can be overdue because it is an estimate, not an observed deposit.
- Bill addition: optional agreedPayOn (real calendar date), preserving original due. It is a known payment agreement, not evidence of payment.
- Conservative overlap rule: this first slice does not add deal-to-plan valuation semantics. A plan customer's signed won deal with invoiceId null/unknown would create ambiguous duplicate cash, so reject that combination rather than guess. Existing explicitly invoiced deals may coexist. Generated-customer plans in the first simulator adoption have no deals.
- Extend FieldMapping.entity with billingPlans and pendingPayouts. Keep transforms unchanged in C3; deterministic conversion operations are a separate connector policy. Export the new public schemas/types. Optional fields absent in old snapshots remain absent.

## Simulator-private envelope

Add optional PlannedEvent.id, and optional WorldState.runtime with a typed version-1 envelope:

- collections: {invoiceId, payOn, payoutOn, grossAmount, netAmount}[], unique invoice IDs; real dates, payoutOn >= payOn, safe nonnegative cents with netAmount <= grossAmount. These are hidden scheduled outcomes until observed.
- billPayments: {billId, payOn}[], unique bill IDs and real dates.
- cashEvents: BankTxn[] holding scheduled synthetic one-off postings, unique IDs and real dates/safe signed cents.
- appliedEvents: {id, week, change: Change}[], unique IDs, nonnegative integer week. With runtime present, pending events must have unique IDs and no ID may also be applied. Referenced collection invoices and payment bills must exist uniquely in the snapshot; collection gross amount must not exceed original invoice amount. Applied weeks cannot exceed world.week.
- WorldState without runtime stays valid for legacy creation fixtures. The future simulator advance implementation may clearly reject such a legacy state instead of guessing its hidden schedule. Do not emit runtime or future queues through source APIs.

Snapshot asOf/today remain existing fields. Runtime-bearing worlds require real equal today and snapshot.asOf. No runtime behavior, calendar generation, simulator output, network call or schema/table migration is part of C3.

## Replay and rollout

Extend learning-origin checks to reject future writtenOff observations. Pending payouts are observable only after collection; their estimates and billing plans are allowed in authentic origin snapshots. Never reconstruct them using today's outcomes. Existing optional fields must survive schema round trips.

After contract review, serialize engine adoption after E7a: honor agreed collection dates/amounts, writeoffs, agreed bill dates, anchored future plan receipts and pending payouts. Planned receipts must not precede issuance under negative learned delays. Then adopt in simulator and source formats. Provider JSON schemas and prompts need a bounded C3 consumer follow-up before mapping new entities. No week control is enabled until every reader understands the fields.

Tests: legacy fixtures; real/leap/month-end dates and retained anchors; duplicate plan/occurrence/payout/queue identities; missing/mismatched references; paid/writeoff mutual exclusion; gross/net bounds; observable cutoff rules; pending payout replay; optional-field round trips; runtime event identity invariants; new mapping entities. Full check must pass without feature changes outside contracts.
