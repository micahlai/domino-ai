# H2b: Deterministic historical period model
- **Goal:** Forecast one reported period, compare matching actuals, and model one costed alternative from frozen eligible inputs.
- **Folder:** packages/engine/; exception this Result. No UI/schema/evidence rewriting.
- **Contracts used:** H2a frozen historical schemas; H1 checked source/fact/assumption bundle. Use synthetic fixtures until real evidence passes validation.
- **Done when:** Money balances exactly; operating/investing/financing/FX scopes are explicit; restricted cash is distinct; cutoff/derived publication/YTD comparability tests pass; pre-cutoff nowcast shared by branches; costs and benefit lag honored; comparison reports misses without altering prediction; pnpm check passes.
- **Notes:** Read skills/engine-tdd/SKILL.md and historical-case-study-plan.md. Pure code, no network/AI/Date.now/randomness. No outcome tuning, unsafe intermediate cents, invented weekly observations or uncosted rescue cash. Do not import E3c's blocked funding path.
- **Handoff:** Push separate engine checkpoint on H2-historical-backend; report method, evidence hash, intervention assumptions and exact tests. One case only.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
