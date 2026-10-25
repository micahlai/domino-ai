# S4: durable event and response lineage
- **Goal:** save/reopen one event and response using existing historical runs and investigation operations.
- **Dependency:** accepted S1/S2/S3. DESIGN GATE FIRST: exact additive schema/API/hash/operation changes must be written and audited before implementation. No worker dispatched yet.
- **Ownership after gate:** apps/web/convex historical/investigation implementation/tests/schema/generated binding only, own Result. S2 schema ownership must first be released. Shared contract additions need their own prior gate.
- **Requirements:** immutable baseline, explicit parent/baseline IDs, frozen scenario assumptions, engine-computed values, honest post-hoc flag, separate observed reveal, existing legacy row/read compatibility. Reuse current rows/hashes/receipts/scheduler rather than parallel persistence. No automatic provider fallback/retries.
- **Acceptance:** actual local concurrent idempotent/conflicting requests, unknown/failure paths, hash tampering rejection, no future disclosure leak, reload read-only, catalog states/lineage, parent checks/build. Stop for Codex audit before UI uses it.
## Result
- Pending design.

## Design findings from S3 audit
- Existing baseline persistence adds AS-RESTRICTED; S3 must accept that validated saved manifest before S4 dispatch. Do not strip it from existing runs.
- Baseline frozen snapshots omit A1. Define and hash a deliberate cutoff-safe response evidence extension instead of pretending it was a baseline input or silently using later case data.
- The authoritative protocol marks A1 post-hoc even though the case assumption selectedAfterReveal is false. Freeze that protocol taint separately from whether the user has revealed outcomes. Saved response and overall status must retain it.
- Human launches implementation after Codex audits the exact design and prerequisites. No S4 worker has been dispatched.
