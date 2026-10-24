# H2a: Additive historical contracts and interface packet
- **Goal:** Freeze one validated source/fact/assumption/run/observation/comparison boundary for evidence, backend and UI.
- **Folder:** packages/contracts/; exceptions this Result and kb/coordination/historical/contract-v1.md. No engine/Convex/UI edits in this phase.
- **Contracts used:** Inspect existing Cents/date/evidence schemas; add historical Zod schemas with inferred types, preserving operational contracts.
- **Done when:** Contract tests reject unavailable/late evidence and malformed periods/units; synthetic fixtures clearly labelled; pnpm check passes; contracts-only code commit and versioned packet with exact SHA are pushed on H2-historical-backend.
- **Notes:** Read skills/contract-change/SKILL.md and historical-case-study-plan.md. Packet records proposed APIs separately from implemented APIs, currency/cash scope, availability inheritance, stale balance dates and UI states. Existing Forecast/GradeContext are not quarterly contracts.
- **Handoff:** Single contract owner. Freeze compatible shapes early; no breaking changes after UI adoption. Draft dependency testing is permitted in worker branches; final shared approval remains morning review.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
