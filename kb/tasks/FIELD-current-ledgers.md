# FIELD current ledgers
- Goal: current Asana/GitLab datasets with exact reported anchors and reconstructed books through2026-10-25; historical2U/2023 legacy unchanged.
- Own: packages/sim only; this Result; kb/features/field/TAKEOVER-CURRENT-LEDGERS.md.
- Read: AGENTS.md, CURRENT-FILINGS-CONTRACT.md, both current research artifacts and existing operating API/types/tests.
- Deliver: two new immutable company IDs; primary roster constant; date/source catalogs; reported AR/deferred/cash/restricted; component cash flows; current roll-forward; future-only scenarios and exact cent tests.
- No: contracts/engine/web edits, protected2U data/assumptions/held-out/evaluation, providers, main, live runtimes, root handoff, merges/pushes.
- Checks: sim tsc/Vitest/Biome; legacy unchanged, all supported IDs/current primary12 cases, reported+current cash, component totals, revenue/AR/AP and scenario observation custody.
- Result: implemented current IDs, primary catalog, July reported anchors/components and October 25 reconstructed cash; October 26 forecasts; future-only scenarios; explicit GitLab rounded customer-advance scope adjustment. Full sim suite 128 tests, sim TypeScript, Biome (32 files), and diff whitespace check pass. All 36 captured legacy complete-output hashes unchanged. Handoff: `kb/features/field/TAKEOVER-CURRENT-LEDGERS.md`. Adapter/integration owns mock roundtrip and web acceptance.
