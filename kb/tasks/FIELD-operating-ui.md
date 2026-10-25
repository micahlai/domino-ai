# FIELD: Primary2U full-product scenario experience
- **Goal:**2U baseline is primary; all product pages work with explicit provenance and four scenario choices.
- **Folder:** apps/web/components, apps/web/app, apps/web/lib only; separate worker result note in kb/features/field/TAKEOVER-OPERATING-UI.md.
- **Contracts used:** Shared new adapter/API in ../features/field/OPERATING-LEDGER-CONTRACT.md; no financial math in UI.
- **Done when:**2U worker/map/connect/clock/Timeline unblocked, default and scenario switching consistent, required exact label visible, reported/reconstructed/forecast distinction inspectable; tsc/tests/lint/build and browser pass.
- **Notes:** Keep /case/2u reported historical replay separate. Never silently select Kestrel. Preserve latest map height repair. No Convex/sim edits; coordinate missing fields with lead.
## Result
- Done: UI adapter, exact company and scenario selection, guarded operating pages, global provenance and 2U payables bridge, Timeline routing, and illustrative cash-rule wording are implemented. Node 24 install, Biome, aliased web tsc, 28 focused suites with 229 tests, and `git diff --check` passed. Standard web typecheck and browser/build verification remain for integration after sim `98ec90f` and backend `311fad7` are merged. See `kb/features/field/TAKEOVER-OPERATING-UI.md`.
