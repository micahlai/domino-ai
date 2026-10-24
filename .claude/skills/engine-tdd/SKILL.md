---
name: engine-tdd
description: Write simulator and engine code test-first, pure and deterministic. Use for any work in packages/engine or packages/sim.
---

# Engine TDD

The engine is the part a finance judge will test. It must be correct, simple and explainable.

## Loop (per function)

1. Read the spec section (`kb/spec/build-spec.md` §6 for engine, §7 for sim).
2. Write the test first in `src/<name>.test.ts`, using `@domino/contracts/fixtures`.
   - One test for the normal case.
   - One test for each rule in the spec (for example "unsigned won deals add no cash").
   - One balance test: every week `opening + inflow - outflow = closing`.
3. Run `pnpm --filter @domino/engine test` and watch it fail.
4. Write the simplest code that passes.
5. Refactor. Keep functions under 40 lines.

## Rules

- Integer cents only. When you divide or apply a percent, round once with `Math.round` and test it.
- No `Date.now()`, no `Math.random()`, no network, no AI. Pass dates and seeds in.
- Date math with UTC only: `new Date(Date.UTC(y, m, d))`. Helper functions in `src/dates.ts`.
- Every domino and risk carries `evidence` that names a record id or document quote.
- Simulator randomness: one seeded generator (for example mulberry32) passed down. Same seed, same company.
- Never import the answer key outside `packages/sim/src/eval/`.

## Done

- Tests pass, `pnpm check` passes, and `pnpm sim:print` output looks sane to a human.
