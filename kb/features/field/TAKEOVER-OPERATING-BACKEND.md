# Operating backend takeover, Oct 25 2026

- Branch/worktree: `field/operating-backend` in `domino-field-operating-backend`.
- Goal: selected filing-backed operating feeds in Field, without changing historical `/case/2u`.
- Changed: `fieldOperating.ensure/list/context`; indexed optional `companies.operatingDemo`; generated world and constraints through the existing source and ingestion pipeline; operating dispatch in weekly feed and daily clock; generated API type entry; focused adapter tests. Operating feeds start with Plaid simulated bank connected and Nessie disconnected. Legacy feeds retain their prior bank setup.
- Timeline route: `fieldTimeline.openInTimeline` already takes the selected Convex company ID and returns a route derived from the exported seed. The generator's `operating/<company>/<scenario>` company ID keeps each scenario separate. UI should pass the selected Convex ID and use the returned route. The frozen assumption note now includes provenance wording and distinguishes the historical ledger period from the public report date; its rules are illustrative.
- Checks: frozen-lockfile install succeeded with network escalation after the offline store lacked Vitest; changed-file Biome and `git diff --check` passed. The combined branch exposed Convex arguments inferred as an empty object. Follow-ups use explicit literal validators from the frozen ID constants and let the handler argument infer from them. The isolated checkout still lacks the concurrent simulation exports, so combined `tsc` and focused tests run with the integration owner. No runtime or provider requests were made.
- Next exact step: integrate the simulation commit; run `pnpm --filter @domino/web typecheck` and `pnpm --filter @domino/web test -- convex/tests/operatingFeed.test.ts convex/tests/fieldOperating.test.ts`; inspect any source-shape failure. Verify selected 2U UI routing in the integration worktree. Use `context.reconciliation` for four-category reported cash-flow provenance; Timeline's existing engine cash-flow display groups FX with other unclassified activity.
- Open question: none in the backend contract; combined runtime checks are pending.

## Copy repair

- Analyst bridge suggestion and advisor activity now say "cash minimum". The same generated minimum is illustrative for operating feeds, so these messages no longer present it as an actual lender covenant. Legacy judge fixture stories and internal field names were left intact.
- Verification for this copy-only change: changed-file Biome and `git diff --check` passed. No assertion targets this wording; root integration owner will run combined checks.
