# L2: resolve comparable financial evidence
- **Goal:** classify candidate evidence and block affected calculations on an unresolved true conflict, retaining all lineage.
- **Folder:** packages/engine only, new source-reconciliation.ts/test and index.ts export additions; own Result. No other engine feature files.
- **Contracts used:** accepted L0 ObservationKey/ReconciliationReceipt and accepted L1 normalized records; actual names frozen by L0.
- **Dependency:** accepted L1. No parallel engine writer; no sealed evaluation data.
- **Done when:** agreement, exact duplicate, same-origin corroboration, timing, definition, rounding, true conflict, dated authority, late amendment and compatible/incompatible YTD tests pass; cash identity independently ties out.
- **Notes:** ../spec/learning-loop-design-2026-10-24.md. Pure functions, preserve candidates; no majority/averaging/latest-download policy. Focused tests/typecheck/lint; no backend writes/UI/providers.
## Result
- Blocked on accepted L1; no launch.
