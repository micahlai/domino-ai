# P0-C: frozen feature exchange
- **Goal:** both feature owners validate the same self-contained, versioned handoff before their long fork.
- **Owner:** current Claude lead assigns one contracts worker; Codex audits independently.
- **Folder:** packages/contracts only, plus this Result. Add feature-boundary schemas/tests/public fixtures and exports; preserve existing schemas.
- **Contracts used:** existing CompanyKnowledgeSnapshot and historical/scenario contracts; proposed TimelineSeedV1, TimelineResultRefV1, OperationSummaryV1.
- **Done when:** cutoff/closure/company/role/method/taint validation rejects malformed inputs; valid exposed fixture and separate post-reveal fixture pass; required hash algorithm/bytes are specified; contracts tests/typecheck/lint pass.
- **Notes:** ../spec/independent-feature-lanes.md. No crypto dependency cycle, sealed data or invented completeness. Consumer P0-H verifies actual content hashes. No feature implementation.
## Result
- Implemented on branch P0-C-feature-boundary (base 507fbe1); awaiting Codex audit.
- Files: packages/contracts/src/feature-boundary.ts, feature-boundary.test.ts, fixtures/feature-boundary/{index.ts,valid-2u-seed.json,blocked-seed.json,mismatched-seed.json,saved-result-ref.json,post-reveal-2u.json}; export lines in src/index.ts and src/fixtures/index.ts.
- Exports: TimelineSeedV1Schema, ForecastReadyTimelineSeedV1Schema, TimelineResultRefV1Schema, TimelineResultRefContextV1Schema, OperationSummaryV1Schema, TimelineRevealV1Schema, TimelineRevealContextV1Schema, DomainIdSchema, TIMELINE_METHODS, FEATURE_BOUNDARY_HASH, canonicalJson, contentHashPreimage.
- Hash: sha256/domino-canonical-json-v1 = lowercase hex SHA-256 of UTF-8 canonical JSON (sorted keys, no whitespace, undefined dropped, non-JSON rejected). Seed and snapshot contentHash exclude their own top-level contentHash (existing engine convention). Schemas do not verify digests; P0-H consumers must.
- Checks: contracts tsc OK; vitest 9 files / 396 tests (58 new); biome check packages/contracts clean; git diff --check clean; engine, agents, web tsc OK.
- Limits: the 2U snapshot wrapper is fixture-assembled from the reviewed public case, not Field normalizer output. TIMELINE_METHODS duplicates engine QUARTER_BRIDGE_METHOD; a consumer test should assert equality. Contracts cannot import the engine, so bridge arithmetic validity is still engine-checked.
