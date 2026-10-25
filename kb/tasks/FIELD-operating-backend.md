# FIELD: One reconstructed ledger across backend and connectors
- **Goal:** Resolve all selected operating demos to real feeds consumed by connectors, agents, daily clock and Timeline.
- **Folder:** apps/web/convex only; separate worker result note in kb/features/field/TAKEOVER-OPERATING-BACKEND.md.
- **Contracts used:** Existing Snapshot/WorldState/WeeklySeed; new API in ../features/field/OPERATING-LEDGER-CONTRACT.md.
- **Done when:** Idempotent lazy setup, connector-to-generator exact tie-out, scenario separation, clock, provenance query and Timeline export pass; web/Convex tsc and focused tests/lint pass.
- **Notes:** Optional companies.operatingDemo addition in schemas/field.schema.ts is explicitly authorized. No root/Timeline-owned schema changes, no secrets, live data reset or main edits.
## Result
- Done: Pending.
