# L1: automatic supported-source normalization
- **Goal:** an unseen supported SEC package reaches validated company snapshot/bridge roles without company-specific code.
- **Folder:** packages/engine only, new source-normalization.ts/test and index.ts export additions; own Result. Do not edit period.ts or S3-owned files.
- **Contracts used:** accepted L0 SourcePackage/MappingReceipt/CompanyKnowledgeSnapshot exports, HistoricalCase, QuarterBridgeInput; stop if names/shape differ.
- **Dependency:** accepted L0 and E0 DEVELOPMENT package only. Never read data/evaluation/sealed or test slices/labels.
- **Done when:** independent source-row expected values, decimal lexeme/scale/overflow, tag ambiguity, missing units/dates, consolidated scope, cutoff/amendment and role completeness tests pass. No invented zeros or company switches.
- **Notes:** ../spec/learning-loop-design-2026-10-24.md. Pure parser/normalizer, no network/AI/clock. Focused tests/typecheck/lint; Codex owns full suite and unseen-company acceptance after code freeze.
## Result
- Blocked on dependencies; no launch.
