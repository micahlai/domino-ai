# TL9 independent review

Status: ACCEPTED at backend 274b3c95d265db6cea1ddc33828898740d1e7c7a and UI e8d9875b3454db88bdb463805691a5f5fb8e3d6a. Both worker checkouts clean. No remaining review blockers.

## Reviewed scope

Read-only review of TL9B/TL9U against TL9-chat-interface.md and TL9R card. No edits to source, services, shared contracts, engine, root schema or stable TL7. Scratch probes in this folder are independent of author tests.

## Passing evidence so far

- UI commit: 21 focused tests pass independently, covering strict source wire, historical/forecast and record context, exact frozen review, no autorun, revision-bound confirm, guarded navigation, monotonic receipts, and preserved uncertain request payload.
- Backend: 18 independent typed draft probes pass (unsafe amount/date/counterparty ambiguity, date-qualified rules, negation and retained known fields).
- Backend: 3 real convex-test boundary probes pass (confirm accepts server proposal only and duplicate effect once; ancestor changes apply once; reset retries return original frozen snapshot after later turns and reads/retries invoke no engine/network).
- Eight initial-condition/discount/account-scope qualifier probes pass after author repair.

## Blockers found and repaired during review

- Date-limited cash/runway rules previously became unconditional rules.
- Ambiguous or numeric counterparty replies previously lost pending context or became payment names.
- Conditional, relative-date, discount and account-restricted initial requests previously became unconditional exact events/rules.

## Final verification

- All 32 independent scratch tests pass against backend commit 274b3c95d265db6cea1ddc33828898740d1e7c7a: 18 typed draft probes, 11 qualifier probes, and 3 transactional boundary probes.
- Shared semantic refusal now runs before every advance branch, retains pending typed state, and does not silently reinterpret the three counterparty condition replies.
- Author permanent backend focused suite rerun independently: 38 tests pass.
- UI focused suite rerun independently at e8d9875b3454db88bdb463805691a5f5fb8e3d6a: 21 tests pass.
- Scope inspection finds only task-authorized additive Timeline schema fragment/composition count, Timeline chat code, routes/components/minimal navigation links, and task-card results. No shared contract, root schema, engine, dashboard, Field or stable TL7 changes.

## Limits

This review does not substitute for lead integration full check, production build, real local API writes or desktop/mobile browser acceptance. The UI deliberately describes bounded supported wording, not unrestricted provider-backed dialogue.
