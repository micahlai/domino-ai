---
name: contract-change
description: Change a shared type or interface in packages/contracts safely. Use when a module needs a new field, type, Change kind or function signature.
---

# Contract change

Contracts are the agreement between modules. A careless change breaks the other person.

## Steps

1. Write the request in `kb/requests.md` (what, why, who is affected).
2. Make a branch `contract-<name>` that changes ONLY `packages/contracts/` and its fixtures.
3. Change the Zod schema; the TypeScript type is inferred from it. Never write a type by hand that duplicates a schema.
4. Update fixtures in `src/fixtures/index.ts` so they still parse. Add a test if you added a rule.
5. Prefer adding optional fields over changing existing ones. Never rename a field during the hackathon.
6. Run `pnpm check` at the root. Fix every type error in packages you own; list the others in the PR.
7. Update `kb/spec/build-spec.md` §5 (and `convex-api.md` if a table is affected).
8. Both people approve the PR. Merge it before other work that depends on it.
9. Post one line in the team channel: "contracts changed: <what>".
