# E4 · Engine: risks, fix scoring, history, stress test (Jayden)

Current execution card: `kb/tasks/E4-multiverse.md`. Read `kb/spec/engine-e3b-e4-implementation.md` first; it supersedes conflicting instructions in this historical full-task prompt. Respect the card dependency gate and worker ownership.

Tool: Claude Code. Branch: `E4-multiverse`. Folder: `packages/engine`. Depends on: E3.
Skill files (in skills/): kb-sync, engine-tdd.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/engine-tdd/SKILL.md. Read AGENTS.md, kb/spec/build-spec.md §2.1, §6.3, §6.4, §6.6, and the
multiverse types at the end of packages/contracts/src/branches.ts.

In packages/engine implement, test first:
1. scanRisks(snapshot, model, constraints) per §6.3: late payment, non-renewal, spend spike. Rank by chance x impact, top 5.
   Include at least one GOOD event type (big deal closing early) so the multiverse has upward futures.
2. scoreFix(parent, fix, snapshot, model, constraints) per §6.4. A fix that does not raise the low point is marked not useful.
   Export rankFixes(...).
3. history(snapshot, weeks) and pastEvents(snapshot, model) per §6.6.
4. stressTest(snapshot, model, constraints, risks, fixes) per §6.6: base, each risk, pairs of the top 4, all bad together.
   Probability = product of risk chances. survivalRate probability-weighted. breakingPoints by binary search
   (smallest delay in days for the top late payer; smallest lost renewal amount).
   Must run in under 200 ms on the Kestrel fixture; add a timing test with a generous limit.

Tests:
- scanRisks on fixtures ranks Acme late payment first
- the early-pay fix raises the low point; a fix that delays a critical bill is rejected
- stressTest: survivalRate is between 0 and 1; with the fixtures' fixes it is higher than without
- breaking point for Acme is a whole number of days and breaks the rule exactly at that value (and not one day earlier)
- history has the requested number of weeks and ends at the snapshot date

When done: pnpm check passes, board row E4, handoff. Tell Micah in the handoff that real stressTest output is ready.
```
