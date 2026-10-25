# Timeline local runtime

Worktree: `/Users/micahlai/code/domino-timeline`, branch `timeline/main`.

- App: http://127.0.0.1:3107
- Live computed timeline: http://127.0.0.1:3107/c/kestrel
- Boundary/backend check: http://127.0.0.1:3107/playground/timeline-seam
- Backend: http://127.0.0.1:3240; HTTP actions: http://127.0.0.1:3241

The app's ignored `apps/web/.env.local` points only to this worktree's new anonymous local deployment and its synthetic computed company. No peer environment or provider secrets were copied. The home dashboard is still the shared shell placeholder; the live company screen is available through Timeline navigation.

## Restart

Check that these ports are free or already owned by this worktree. Preserve other services. From `apps/web`, keep these in separate terminals:

```sh
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --local-cloud-port 3240 --local-site-port 3241 --tail-logs disable
```

```sh
pnpm dev:web --port 3107
```

The existing ignored deployment state is reused. Do not copy another checkout's `.env.local`, reset the database or use `--configure` to create a different deployment during a routine restart.

## Seed and verify

The existing computed seed is idempotent and uses synthetic fixture inputs; every financial output is computed by the engine. It does not call live integrations:

```sh
pnpm exec convex run dev/seedComputed:seed
pnpm exec convex run historical:getCase '{"caseId":"twou-2023-cash-v1"}'
```

Verified at setup: second seed call returns `created:false`, browser seam query returns 2U with seven facts, weekly fixture hash verification succeeds, and `/c/kestrel` renders Kestrel Data (computed prototype) from live backend subscriptions. Add event/fix simulation are available; week advancement is not implemented.

Node 26.3.1 / pnpm 9.12.0 passed workspace checks on this machine. Both services were left running for the user. Current roadmap features (new weekly imports, conversational questions, editable constraints, weekly catalog) remain separate implementation work.
