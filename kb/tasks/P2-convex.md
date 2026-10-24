# P2: Convex data and fixture seed

- **Goal:** The documented queries and mutations work against validated Kestrel data in Convex.
- **Folder:** `apps/web/convex` (exclude connectors/ and actions/).
- **Contracts used:** Cents, ISODate, Id, CompanyProfile, SourceKind, FieldMapping, Snapshot, CompanyModel, Branch, BranchKind, Change, RiskEvent, FixCandidate, Constraint, Evidence, HistoryWeek, PastEvent, ResilienceReport and their Zod schemas.
- **Done when:** All tables/indexes and API functions in convex-api.md exist; query/mutation tests and pnpm check pass; convex:fixtures seeds a local deployment idempotently and queries return its rows.
- **Notes:** Read build-spec §3–5 and kb/spec/convex-api.md. May change schema.ts and regenerate _generated. Use @domino/contracts/fixtures. Heavy work is scheduled to explicitly unbuilt internal actions; approvals write only a decision record. No contract changes.
