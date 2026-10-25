# FIELD: One reconstructed ledger across backend and connectors
- **Goal:** Resolve all selected operating demos to real feeds consumed by connectors, agents, daily clock and Timeline.
- **Folder:** apps/web/convex only; separate worker result note in kb/features/field/TAKEOVER-OPERATING-BACKEND.md.
- **Contracts used:** Existing Snapshot/WorldState/WeeklySeed; new API in ../features/field/OPERATING-LEDGER-CONTRACT.md.
- **Done when:** Idempotent lazy setup, connector-to-generator exact tie-out, scenario separation, clock, provenance query and Timeline export pass; web/Convex tsc and focused tests/lint pass.
- **Notes:** Optional companies.operatingDemo addition in schemas/field.schema.ts is explicitly authorized. No root/Timeline-owned schema changes, no secrets, live data reset or main edits.
## Result
- Done: Added lazy, idempotent `fieldOperating.ensure/list/context` with indexed selected-demo metadata, generated illustrative constraints, and provenance from the same seed-1 generator. Operating worlds now advance through the existing weekly feed and daily clock, with Plaid mock bank connected and Nessie disconnected. Timeline's frozen assumption note carries the exact 2U label, historical ledger period, report date, and illustrative status. Added focused tests for all 12 source round-trips, day/week cursor advance, selection idempotence, legacy preservation, provenance, export identity, and 2U Timeline import.
- Verification: Node 24 frozen-lockfile install and changed-file Biome check passed; `git diff --check` passed. Web TypeScript cannot finish in this isolated branch because the concurrent `packages/sim` exports are not present here yet. The new tests are written but await the combined branch to run.
- Next: Merge with the simulation branch, run web TypeScript and focused backend tests, then verify exported 2U seed and Timeline import against the same ingested snapshot.
