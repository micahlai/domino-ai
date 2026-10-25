# P0-H: independent feature boundary smoke tests
- **Goal:** both owners can test the seam on an isolated local backend before depending on the peer's unfinished feature.
- **Owner:** one shared-setup UI worker after accepted P0-C/P0-S; Codex audits independently.
- **Folder:** apps/web only, plus this Result; minimal owned playground wrappers/adapters/tests and local setup documentation. No global redesign/dependencies.
- **Contracts used:** accepted feature-boundary schemas/fixtures; existing historical/investigation APIs and HistoricalView/Replay interfaces.
- **Done when:** both harness routes run with real existing local backend plus labelled peer fixtures; actual canonical hashes verify and tampering fails; existing consumers/routes compile; web tests/typecheck/build/browser checks pass.
- **Notes:** ../spec/independent-feature-lanes.md. Not future feature implementation. Record namespace/import inventory and exact isolated runtime commands. No shared backend/credential mutation/provider calls. Record base commit and fixture hashes only after combined audit/check.
## Result
- Prepared, not assigned or implemented.
- Changed files/checks/limits:
