# Forward data and week advancement: integration plan

Status: reviewed direction, not implemented or approved for emission. Finish the current I2/E6b/E7a slices first. Additive contracts and their readers must land before the simulator emits new fields. The main demo remains explicitly synthetic.

## Why another slice is necessary

The current simulator builds 26 observed weeks, then copies four pending invoices, three bills and two payroll runs. Its generated customers have no forward billing records. WorldState has no persistent collection or payout state. The real fixture forecast therefore has 0 of 11 passing scenarios; changing a displayed score would conceal the missing inputs.

The engine cannot reconstruct recurring revenue from paid historical invoices without an unsupported assumption. It also skips paid invoices, so a payment collected by the processor but not yet deposited needs an observable pending payout. Hidden simulator schedules must never supply forecast cash.

## Chosen small contract direction for C3

- Add optional public billing plans for generated customers that currently have no deals. Each plan needs a stable ID, customer ID, positive cents amount, immutable calendar anchor, first unissued occurrence cursor, month cadence, payment terms and optional last permitted issuance date. Keep month-end anchoring across January 31, February 28 and March 31. A plan ends future issuance, not collection of existing invoices.
- Give each occurrence a collision-free identity derived from plan and scheduled date. Issuing an invoice and advancing the cursor are one pure transition. The cursor must be after the snapshot cutoff and exactly on the anchor's cadence. Planned receipts cannot precede issuance merely because an estimated delay is negative. Do not invent already-issued future invoices. Deal-to-plan linkage can remain a later extension because this slice uses customers with no overlapping deal cash.
- Add observable pending payouts with stable IDs, net cents, expected arrival date and explicit collected invoice references. These are processor-reported pending settlements, not private future outcomes. Forecast them once while excluding paid invoices; remove them when their bank deposit is observed. Avoid customer churn canceling already-earned processor payouts.
- Preserve original invoice amount and due date. Add optional terminal paidAmount (gross collected before fees, only with paid), mutually exclusive writtenOff observation, and explicit agreed collection date/amount when a changed agreement is observable before settlement. Defer partial payments. Bills likewise need an observable agreed payment date without changing their original due date.
- Keep optional private simulator state outside Snapshot: typed pending collection/payment/payout queues and an applied-event ledger with stable identities. All serialization must retain it. Connectors see only public source records. Plan and settlement field names/invariants must be frozen in a separate C3 card before implementation.
- C2 must reject future write-off observations in replay origins. Every reader must preserve new optional public fields. Serialize engine adoption after E7a so learning and forecast semantics remain coherent.

## Execution and retries

advanceWeek remains a pure transition: identical world plus ordered injected changes returns identical next world. It advances exactly seven days and posts each due record once. Dates and IDs derive from seed/record identity, never a restarted global RNG or wall clock. Retain history and original due dates.

Pending changes apply once in a documented order; delayed invoices and bills move settlement timing additively. Lost invoices stay auditable as written off. Discounts preserve original linked invoice/deal amounts. Hire deferral reduces planned payroll outflow, never creates a fictitious bank deposit. Public changed terms must persist so a fresh forecast can see known commitments without reading the private ledger.

Convex week orchestration must use a durable request identity and expected world version, with an atomic transition/commit. Content hashes cannot distinguish a retry from an intentionally repeated identical cash event. Existing approvals record decisions only; they must not automatically execute payments, send messages or silently inject changes into the simulated world.

## Verification gate

Independent checks: month-end cadence; duplicate occurrence prevention; paid-before-bank straddling a week; original due/amount preservation; all eight changes over multiple weeks; JSON round trips; exact bank reconciliation; unchanged input worlds; 13 successive advances with continued forward coverage; hidden queues absent from API payloads. Forecast, risk, grading and replay tests must adopt the new public fields before live week controls are enabled.

Counterargument: these additions delay week advancement. Keeping only the current contracts would require fabricated issuance, lost receivables, or invisible pending cash. The smaller safe delivery is the fixed-snapshot computed prototype while this slice is completed.
