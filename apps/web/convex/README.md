# Convex data layer

The API and table contract is in `kb/spec/convex-api.md`. All large JSON payloads
are parsed with `@domino/contracts` through `lib/parse.ts`. Keep `_generated/`
up to date with the Convex CLI. Do not hand-edit the generated files.

## Fixtures

Run `pnpm dev` from the repository root, then in another terminal:

```sh
pnpm convex:fixtures
```

The internal seed returns `{ companyId, created }`. Use that returned Convex document
ID in API arguments. `kestrel` in the snapshot payload is the canonical contract ID;
it is not a Convex document ID. Branches and fixes keep their fixture IDs such as
`br_acme_late` and `fix_early_pay`.

The seed creates seven sample sources, snapshot, model, constraints, risks, branches,
fix candidates with gains, both resilience reports, history and an initial log.
It creates no fake accuracy history, approvals or agent explanations. Those collections
stay empty until results exist. Source tie-outs stay pending and `lastPull` stays null
because this seed does not connect to a tool. The `fixtures.seed` log identifies the
fixture company; repeat runs return its ID without resetting any decisions.

## Approvals and scheduling

`approvals.decide` requires a simulated fix branch and the candidate that generated
its changes. The candidate, parent and fix branch must belong to the same company.
The decision, branch status and audit log are written in one transaction. A decision
never schedules an action or moves money. Identity comes from Convex Auth when
available; anonymous demo clicks are recorded as `demo-user (unverified)`.
This demo does not implement company access controls or a sign-in flow.

The `connect`, `engine`, `agents` and `week.advance` internal actions are deliberate
P2 placeholders for Jayden's E5/E7 work. They throw `not built`; scheduled jobs will
show failure rather than report invented results. Queries and fixture seeding work
without running any placeholder.

## Tests

`pnpm check` runs the Convex integration tests in `tests/backend.test.ts` and parser
tests in `tests/parse.test.ts`, alongside the existing workspace checks. They use
`convex-test` and an edge runtime with the actual schema and function modules.
