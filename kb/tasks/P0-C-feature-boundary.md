# P0-C: frozen feature exchange
- **Goal:** both feature owners validate the same self-contained, versioned handoff before their long fork.
- **Owner:** current Claude lead assigns one contracts worker; Codex audits independently.
- **Folder:** packages/contracts only, plus this Result. Add feature-boundary schemas/tests/public fixtures and exports; preserve existing schemas.
- **Contracts used:** existing CompanyKnowledgeSnapshot and historical/scenario contracts; proposed TimelineSeedV1, TimelineResultRefV1, OperationSummaryV1.
- **Done when:** cutoff/closure/company/role/method/taint validation rejects malformed inputs; valid exposed fixture and separate post-reveal fixture pass; required hash algorithm/bytes are specified; contracts tests/typecheck/lint pass.
- **Notes:** ../spec/independent-feature-lanes.md. No crypto dependency cycle, sealed data or invented completeness. Consumer P0-H verifies actual content hashes. No feature implementation.
## Result
- Prepared, not assigned or implemented.
- Changed files/checks/limits:
