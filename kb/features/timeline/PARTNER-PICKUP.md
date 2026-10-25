# Timeline partner pickup —2026-10-25

Merge source: `origin/TL5-checkpoint`. Verified feature source is0db7f2d; the tip also includes this pickup note. This is the stable Timeline implementation throughTL7 plus sidebar/comparison curves, date/cash scales and in-timeline scenario editor. A separate chat-interface worktree follows; it is not part of this merge.

## On the other computer

From your integration branch, fetch and merge the checkpoint (preserve your work; do not reset):

```sh
git fetch origin
git merge origin/TL5-checkpoint
pnpm install --frozen-lockfile
pnpm check
```

No merge into main or Field has been performed here. Scope is Timeline-owned UI/backend plus additive tables in `apps/web/convex/schemas/timeline.schema.ts`; root schema composition, shared contracts/engine math, global styles and Dashboard.tsx are unchanged. If your lane changed schema composition counts, resolve the test expectation to match the composed tables, retaining both lanes' owned table fragments.

## Runtime and smoke test

Use your own ignored environment and local Convex deployment, on free ports. Do not copy another computer's env, keys, deployment state or database. Backend `convex dev` applies the additive Timeline tables/functions. See [LOCAL.md](LOCAL.md) for the commands (3107/3240/3241 are this computer's example ports).

Existing saved links in acceptance docs are machine-local data. For a fresh machine, open `/playground/timeline-seam`, load the labelled Kestrel weekly seed, review neutral assumptions, save a forecast and open its workspace. Verify 26 history weeks/13 forecast weeks, questions/evidence, confirmed scenario/rule creation, sidebar comparisons, axis scales, inline editor chosen-week date/draft retention and saved reload. `/playground/timeline-analysis` contains controlled analysis UI states. For a live TL7 job use a saved baseline/rule-only timeline (event ancestry intentionally rejects), review inputs then Start analysis. No financial action executes.

Provider-free supported wording works. Optional language intent classification requires your own intended backend configuration; credentials are not in source. Unsupported or ambiguous requests clarify. New chat-based clarification is being built separately and is not claimed here.

## Validation and boundaries

Latest full check:1,963 tests, five package typechecks, lint391; production build and separate Convex typecheck pass. Actual local API/browser desktop1512/mobile390 save/reload checks are recorded in [TL5 acceptance](TL5-acceptance.md), [TL7 acceptance](TL7-acceptance.md), [sidebar acceptance](TL7S-acceptance.md) and [editor/scales acceptance](TL7XC-acceptance.md). See [smoke guide](SMOKE-TESTS.md).

Field owns dashboard. TL6 offers `timeline/output:get` canonical versioned JSON with supported WeeklyResultRefV1 health plus exact saved chart/scenario proof; agree and test Field adoption separately. Unknown runway stays null. TL7 uses bounded deterministic engine-tested risks/costed responses; weighted scenario index is not survival probability. Baseline/rule-only start,3risks/2responses cap and unmodeled consent/fees are explicit. Real Field export exchange, production authorization and TL8 financial-state rejoin remain separate gates. Do not interpret older lane docs saying TL5 is held at597fcc0 as current: user explicitly authorized TL7/TL5 integration on2026-10-25.
