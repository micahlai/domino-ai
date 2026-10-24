# E8 · Held-out companies + proof numbers (Jayden)

Tool: Claude Code. Branch: `E8-proof`. Folder: `packages/sim/src/eval/`. Depends on: E7.
Skills: kb-sync.

## Prompt

```
Load the kb-sync skill. Read build-spec §7.2 and §10, and kb/product/proof.md.

Build packages/sim/src/eval/run.ts (pnpm --filter @domino/sim eval):
1. For each profile (kestrel, tally, orbit) and seeds 1..5: create the company, run the full pipeline offline
   (sim -> reference connectors -> engine; mapSource via the real agent for one seed per profile only, to limit cost),
   advance 8 weeks, and record every measure in build-spec §10 against the answer key and the baseline.
2. Write results to kb/product/proof.md (replace TBD with numbers; mean and range across seeds). Add the command used and the date.
3. Do not tune anything on tally or orbit. If held-out numbers are bad, report them honestly and write one line in decisions.md.
4. Produce data for the learning screen: error by week for Kestrel seed 42 (write to the grades table via a dev action or a JSON the UI can read).

When done: pnpm check passes, board row E8, handoff with the 3 headline numbers for the pitch.
```
