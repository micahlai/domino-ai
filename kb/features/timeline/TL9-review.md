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

## TL9U2 sidebar follow-up

ACCEPTED at 9e7e250173c985d8b77dc3345d98bd64024ca153; worker checkout clean. Backend review remains accepted unchanged at 274b3c95d265db6cea1ddc33828898740d1e7c7a.

- Existing saved timeline chart, scenario browser, composer and detail/rule controls remain in the workspace; the right chat uses its already validated source and does not duplicate the full chart.
- Company/run keys reset chat source state, subscription query bags stay memoized on bounded stable identifiers, and conversation changes reset local view state. Existing typed receipt context stays pinned. URL context initializes the main selection; later chart/item interaction supplies the context for a new chat.
- Conversation links now use the existing timeline URL with conversationId/selection and a sidebar fragment. The former standalone route redirects while preserving identifiers and selection. Reload/resume reads persisted receipt state, with no automatic begin or calculation.
- Exact proposal review, retained/replacement rules, revision-bound checkbox, monotonic receipts and frozen uncertain command/retry safeguards remain intact.
- Phone chat toggles preserve mounted state; unconditional lg:block restores desktop visibility even after phone collapse. The former hidden-summary details problem is repaired. Nested transcript/sidebar bounds keep existing controls reachable.
- Independent focused run: 101 tests across chat and workspace pass (including integration rendering, encoded in-page links, source and revision guards).

No remaining review blocker. Lead handles desktop/mobile browser acceptance, including a phone-collapse-to-desktop transition and actual in-place clarification/save/reload, plus final integration checks/build.

## Final browser-discovered repairs

- UI dd06258070cd1422548bc63b5713b61643eeba90 ACCEPTED. Independent 24 focused chat tests pass. Composer exposure waits for the saved conversation route/query, preventing fast typed input from being lost at the begin navigation remount. Opening state prevents duplicate begin and supplies a recovery link; subsequent write responses still outrun older subscription receipts.
- Backend 6291fd78c7683d291e1762223b5a5ad521a6b2a5 ACCEPTED. Independent 40 focused backend tests pass; worker checkout clean. Only new cash labels are disambiguated against ancestor/current labels using deterministic date/ordinal suffixes, respecting 200-character bounds. Amount, direction, date, old labels and frozen review/confirm payload stay unchanged. The regression confirms two nested $500 payments to the same counterparty/date are each applied once, with precisely -50,000 cents versus each parent and no duplicated effect on confirm retry.
- Retained constraints now compare canonical content, accepting object key reorder while rejecting a changed financial rule. Focused regression covers both.

No remaining review blockers. Lead owns final actual phone nested-save and post-fix integration/build acceptance; no shared math/contracts/root schema or stable TL7 edits were introduced by these repairs.
