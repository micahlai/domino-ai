# Jayden launch plan: 2026-10-24
Owner: Codex brain. Initial preparation is complete. Update: Claude Code implemented E3a at f9b5ad2; independent review blocks merge on two bugs. Use kb/tasks/E3a-r1-money-dates.md for repairs in that existing worktree. Do not launch the E3a prompt below again.
Current gate: Saturday noon, real engine output in the multiverse. These three slices start that path; they do not satisfy the gate by themselves.

## Decision
Original plan: launch E3a first, then E1a and E6a concurrently in separate worktrees. Maximum three workers. Actual E3a owner is Claude Code; retain that owner for fixes.
Use Codex for all three so model selection is explicit and handoffs stay consistent.
The host exposes GPT-6.1 Sol and GPT-6 Sol. Use GPT-6.1 Sol/high for engine math; GPT-6 Sol/high for simulator and routing.
Counterargument: completing the original E1/E3/E6 prompts in one pass offers more breadth. Their contract gaps, cross-folder writes and external dependencies make them poor bounded assignments.
Keep full E1/E3/E6 open until their remaining slices pass. Do not mark planned workers doing before the human launches them.

## Shared worker instructions
- Read AGENTS.md, skills/kb-sync/SKILL.md, your card, relevant contracts and the sections below. This scoped plan replaces the broader E1/E3/E6 prompt for this run.
- One package per worker. You may update only your own card's Result section outside that package. The brain owns shared docs, requests, root manifests, lockfile and integration.
- For these workers, the brain's synchronized worktrees satisfy and supersede kb-sync Start step 1; do not pull/rebase a task branch or merge main independently. The brain fetched origin/main and confirmed main already includes it without rewriting the existing local commit.
- For these workers, report decisions, spec discrepancies and cross-folder requests in your card Result instead of kb-sync Finish steps 4-6. The brain applies the shared-document changes after review. All other applicable kb-sync steps remain in effect.
- Do not revert others' changes, spawn more workers, merge, push, deploy, start persistent servers, copy auth files or read secrets. Human launches implementation workers.
- New dependencies require a Result request to the brain; existing packages suffice for these slices.
- Run focused tests first, then pnpm check. Record exact commands and results, including unsupported behavior. Report a partial result at the time limit rather than marking the parent task complete.
- A passing mock test is not a real provider integration. A schema-valid fixture is not forecast accuracy. The hand-written cash paths and 64%/93% copy are not expected engine outputs.
- Finish with a clean scoped commit if checks pass; include your card Result. If blocked, leave changes intact and report the exact next step. Do not force push or rewrite history.

## Setup in each worktree
The default shell selected Node 19.8.1. Use the installed Node 24 explicitly without changing system settings:
```sh
export PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
```
Expected runtime: Node 24.11.1, pnpm 9.12.0. Each worktree has separate dependencies.
The main checkout's forced-cache-bypass check is the offline S0 gate. Full S0 remains incomplete: account/credential setup is separate.
No .env.local is copied into worktrees. E3a/E1a need no keys; E6a uses injected providers and public documentation.
Sandboxed Turbo can fail to initialize macOS TLS. Retry the existing check with normal approved local access; do not change keychain/system settings.

## E3a boundaries
Build forecast and all eight Change variants using an internal dated cash schedule, not a falsely complete applyChanges(): Snapshot conversion.
Use integer cents, UTC date math, ordered changes and no mutation, network, clock or randomness.
Test conservation with small independently calculated examples, multiple changes on one record, a change reversing timing, empty cash schedules and outside-horizon flows.
Acme's fixture due date plus mean delay is 2026-12-16. Another 45 days gives 2027-01-30, still within the final week. Test that date; use a larger delay for the out-of-window case.
The raw fixture can already breach the lender's floor. Do not assert that the delay uniquely creates a breach or copy the illustrative branch cash curves.
Known missing contract: no deal-to-invoice link. Do not guess a deduplication join. For a signed won deal with a potentially matching invoice (same customer and amount), reject as ambiguous with a descriptive error. Test rejection on the original fixture, and calculate unambiguous minimal fixtures separately. This is a temporary correctness guard, not final demo behavior.
For this slice, anchor recurring spend at asOf + everyDays and continue that cadence; document the assumption. Prorate shift_hire over [fromDate, toDate) by each calendar month's day count, rounding the week's total to cents once. Keep changes in supplied order.
Leave dominoes, risk scan, stress test, grading and learning unbuilt. Full E3 needs E3b and a jointly approved contract resolution before E4 integration.

## E1a boundaries
Generate history in dated canonical records, not a new WorldState property. Use fixed asOf 2026-10-30 and seeded variation, about 300 customers including the fixture identities.
Set WorldState.week=25 for the current Monday bucket (2026-10-26); week 0 is the first history bucket. Pending future events begin at week 26. Keep today and snapshot.asOf equal.
Provide 26 Monday-bucket history with a documented opening balance such that opening + bank net flow = ending cash; closing cash is 450000000 cents and restricted cash is 60000000 cents.
Do not insert future activity into bank history or treat known pending events as observed outcomes. Keep invoice/payroll timing and 1-3-day payout lag explainable.
Build package-local summary CLI through the existing root sim:print script. Print record counts, date range and balances, not private answer keys. No engine import is needed.
Use build-spec profile amounts as synthetic assumptions. No EDGAR-calibrated claim until real sources are fetched in E1b.
Do not tune Tally/Orbit. Leave advanceWeek/answerKey unbuilt and reject unsupported profiles.
Raw-only planted errors (bank detail changes, missing receipts, misapplied payments) need mock-source records in a later slice; do not claim coverage by adding labels alone.

## E6a boundaries
Use the existing dependencies and injected async provider clients that return unknown. Preserve public Agents method signatures; construction helpers can remain package-local exports.
Defaults per spec: CREAO for mapSource/readConstraints/weeklyBrief; Claude for proposeFixes/explain. Env keys use job.toUpperCase(), for example AGENT_BACKEND_MAPSOURCE. Unknown nonempty values are configuration errors.
At most two attempts on the primary backend. If primary is CREAO and both fail validation or transport, try Claude at most twice, then throw a clear final error. If primary is Claude, never loop back into Claude as another fallback.
Validate mapping/constraint/fix arrays with existing schemas, text jobs as nonempty strings, and explain with a tested three-sentence limit. Report the responding backend without logging secrets or full private inputs.
Read official CREAO/Anthropic documentation; record dated source links, request/output shape, auth mechanism, reachability requirements and unknowns in provider-feasibility.md. No endpoint guesses or claimed latency without measurement.
If CREAO documentation is inaccessible, mark it unconfirmed and finish the mock router. Do not claim CREAO track completion or a working live fallback.
Live adapters, schema-to-JSON-schema dependencies, prompt construction and real fixture calls are E6b after brain-controlled dependency changes and credentials.

## Review and integration
1. Read each worker's Result and inspect the entire diff for folder ownership.
2. Use a different model for independent review. GPT-6 Astra/xhigh is appropriate for E3a money/date logic and any shared contract proposal; keep routine review on the lead.
3. Run package tests and pnpm check on each branch before integration.
4. Jointly resolve contract requests before claiming full E3 or the real hero path. Contracts merge before dependent code.
5. Merge reviewed engine/sim changes before integration work, then agents; pnpm check after each merge.
6. Next slices: E3b dominoes then E4; E1b advanceWeek/answer key/calibration then E2; E6b real adapters then E7 when E4/E5/E6 are ready.
7. Human glances at diffs before merge. Worktree removal is deferred until authorized; do not delete working copies during this preparation task.

## Launch prompts
Open a separate Codex chat in the named worktree and select the model/effort above.
- E3a: Read AGENTS.md and kb/tasks/E3a-forecast.md. Implement only that card. Follow kb/tasks/launch-plan-2026-10-24.md. You are a worker; do not edit the board or shared handoffs. Record verification and blockers in your card's Result.
- E1a: Read AGENTS.md and kb/tasks/E1a-kestrel.md. Implement only that card. Follow kb/tasks/launch-plan-2026-10-24.md. You are a worker; do not edit the board or shared handoffs. Record verification and blockers in your card's Result.
- E6a: Read AGENTS.md and kb/tasks/E6a-agent-feasibility.md. Implement only that card. Follow kb/tasks/launch-plan-2026-10-24.md. You are a worker; do not edit the board or shared handoffs. Record verification and blockers in your card's Result.
