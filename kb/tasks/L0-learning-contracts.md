# L0: required knowledge and evaluation contracts
- **Goal:** freeze additive schemas for the required L1-L4 loop and StoredHistoricalScenario before consumers change.
- **Folder:** packages/contracts only; own card Result allowed. New learning-loop.ts and tests; index.ts export additions; historical-scenario.ts only for the explicitly additive stored envelope. Preserve HistoricalRun.branch.
- **Contracts used:** HistoricalSource/Fact/Case/Run/ScenarioInput/ScenarioResult, SafeCents, CalendarDate, Timestamp; inspect actual exports first. New names in design are proposals.
- **Done when:** synthetic valid/invalid fixtures cover provenance, exact units, scoped/versioned rule eligibility, missing input, conflict receipts, evaluator seals and scenario pins/taint. Focused tests/typecheck/lint pass.
- **Notes:** read ../spec/learning-loop-design-2026-10-24.md and scenario-persistence-v1.md. No source fetch, test-company data, backend/schema/engine/UI/provider edits. Return exact new export API for Codex audit; stop before consumers.
## Result
- Pending human launch and Codex review.
