# S0: Start the main checkout locally

- **Goal:** Main runs with the updated root `.env` and its own working Convex backend.
- **Folder:** `apps/web` (ignored local configuration and CLI-generated bindings only).
- **Contracts used:** Existing computed seed and company query APIs; no type changes.
- **Done when:** Convex deploys, updated server settings are loaded without printing secrets, `/c/kestrel` renders the computed company, and `pnpm check` passes.
- **Notes:** Follow `apps/web/README.md` and build-spec §11. Preserve other worktrees and databases. Use the idempotent computed seed; no external provider runs or production deployment.

## Result
- Done: Local backend deployed on 3220/3221; all 25 root environment settings loaded; computed company seeded and visible in the browser; pnpm check passes.
- What changed (files): Ignored apps/web/.env.local and .convex runtime state; CLI-generated convex/tsconfig.json. Dependencies refreshed from the frozen lockfile.
- Watch out: Root `.env` is the source of server settings; Convex keeps its connection settings in `apps/web/.env.local`.
