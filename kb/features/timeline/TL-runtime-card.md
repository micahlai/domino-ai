# TL-runtime: isolated local backend

- **Goal:** Timeline runs against its own local Convex backend and the browser confirms a real query.
- **Folder:** `apps/web` (ignored runtime configuration and CLI-generated bindings only).
- **Contracts used:** Existing historical case/query schemas and frozen seam fixtures; no type changes.
- **Done when:** Backend on free isolated ports deploys, app connects, seam query passes in browser, checks pass.
- **Notes:** Follow `../SEAM-HARNESS.md`; do not copy peer environment/data or call providers. User also authorized `origin/shared/shell` merge. Lane handoff records runtime evidence.

## Result
- Done: isolated Convex 3240/3241 and app 3107 running; browser verifies real seam query/live computed Kestrel; idempotent seed; 1,610 tests/typechecks/lint plus Convex typecheck pass.
- What changed (files): ignored local environment/deployment, CLI-installed untracked AI guides/skills; tracked generated bindings unchanged. Authorized shared shell fast-forward merged at f20f0c4.
- Watch out: preserve services on 3210/3230; local prototype setup does not implement new weekly APIs or provider jobs. Restart/evidence in LOCAL.md/HANDOFF.md.
