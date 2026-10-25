# Timeline local runtime

Worktree: `/Users/micahlai/code/domino-timeline`, branch `TL5-checkpoint` (checkpoint preview; `timeline/main` is the lane base).

- App: http://127.0.0.1:3107
- Weekly saved timeline/catalog: http://127.0.0.1:3107/c/kestrel/timeline
- Older computed prototype: http://127.0.0.1:3107/c/kestrel
- Boundary/backend check: http://127.0.0.1:3107/playground/timeline-seam
- Backend: http://127.0.0.1:3240; HTTP actions: http://127.0.0.1:3241

The app's ignored `apps/web/.env.local` points to this lane's anonymous local deployment. TL1–TL7 now support saved weekly imports, evidence questions, confirmed events/rules, nested scenarios and catalog/reopen. [Smoke tests](SMOKE-TESTS.md) link the accepted baseline and a saved breach example. The shared Timeline navigation still opens the older prototype; use the weekly route above or the baseline playground's workspace link.

The optional question language reader is configured on this local backend using the existing intended Anthropic key and `TIMELINE_QUESTIONS_MODEL=claude-sonnet-5-5`. No key is stored in source. Fixed wording works without a provider. Unrecognized wording without configuration produces a saved failure receipt; providers classify intent only, while code supplies financial values. One live provider intent/answer was verified. Field owns the dashboard component.

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

Node 26.3.1 / pnpm 9.12.0 passed workspace checks on this machine. Both services were left running for the user. TL5 acceptance uses the labelled synthetic peer fixture; real Field exchange, production authentication, Field health/dashboard adoption and branch rejoin remain separate gates. TL6 output and TL7 analysis are now merged into this TL5-checkpoint preview.

## Separate TL6–TL7 checkpoint

Worktree `/Users/micahlai/.codex/worktrees/tl7-checkpoint/domino-ai`, branch TL7-checkpoint. App http://127.0.0.1:3108; backend3250/3251. Use the same restart commands above with3250/3251 and3108, from this separate worktree. Reuse its existing ignored local deployment state. Never copy environments or reset TL5 data. No provider configured or needed for deterministic analysis. [Acceptance and saved analysis](TL7-acceptance.md); [smoke steps](SMOKE-TESTS.md). TL5 remains unchanged and open on3107. Do not merge into TL5 without the user's explicit instruction.

## 2026-10-25 merged smoke preview

User authorized TL7-checkpoint into TL5-checkpoint. The existing3107 app/3240 backend now include TL6/TL7 and saved scenario comparisons. Previous instructions to keep TL5 at597fcc0 are historical. Saved data and ignored environment were retained; no data copied from3108. Main is unchanged.
