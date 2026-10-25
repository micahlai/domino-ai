# Team checkpoint: manual Claude launches

> Latest scope: onboarding, source reconciliation, feedback learning and measured forecast improvement are mandatory. Read `kb/spec/required-learning-loop-2026-10-24.md` from the repo root. Earlier deferrals and the smaller planned-demo diagram are superseded. User still launches Claude manually. Monitor was observed PAUSED during chat handoff; do not assume it is active.

This is a coordination reset, not a Git reset. Preserve branches, local data and worktrees.

## Agreed product

One historical 2U journey: conversation and grouped agent map, inspectable frozen company evidence, quarterly forecast, separate observed reveal, and hypothetical Event/Response with explicit cost and uncertainty. No new themes. Real CREAO coordination remains a required gate, not a label for the fixed workflow.

## Shared baseline

- Integration branch: preview/historical-overnight in domino-preview. Main remains 694ab2a and must not be merged into or changed.
- Accepted UI/backend foundation: G6/G7/G8a/G8/S1/U1. Last feature checkpoint 0f87ed2 passed 1,185 combined tests, typecheck, lint, production build and desktop/mobile/keyboard browser checks.
- Stable preview: http://127.0.0.1:3102/case/2u. Existing data and backend processes stay in place.
- Fresh fetch found no remote-only commits in main or S2 beyond preview. S2 remote remains 1154972 with task documentation only. No feature merge was needed.
- S3 local commit 38297d4 is not accepted. Independent review passed 50 focused tests but reproduced rejection of actual saved 2U baseline inputs. Keep it isolated until repaired and audited.

## Owners and launch prompts

| Owner | Assignment | Prompt | State |
| --- | --- | --- | --- |
| Friend's Claude | S2 read-only saved investigation catalog and one conversation index | prompts/shared/S2-friend-catalog.md | Reserved; human launches or continues existing session |
| Jayden's Claude | S3 saved-baseline compatibility repair | prompts/shared/S3-local-repair.md | Human launches; previous PID 7799 has exited |
| Codex | Independent audits, persistence design, integration and preview validation | prompts/shared/C1-canvas-supervisor.md | Active audit/coordination only; no new implementation auto-launch |

One worker per checkout. Friend's second computer is useful if they can own S2 through commit/push; it does not remove shared account usage limits. Otherwise explicitly transfer S2 ownership before running it locally. Never run both.

## Next gates

1. Audit repaired S3 and friend's S2; integrate only accepted changes into preview.
2. Finalize and independently audit S4 persistence schema/API/hash design. Reuse historicalRuns and investigation operations, preserve old records, immutable baseline and idempotence. Baseline snapshots omit A1, so freeze a deliberate response extension. Preserve protocol.response.postHoc independently of user reveal timing.
3. Human launches Claude S4 only after the design and dependencies pass. U2 then wires the real catalog, event/response results and chart details with one UI writer.
4. Verify dedicated CREAO identity/instructions/isolation, then bounded actual coordinator acceptance. Old app-scoped API only. No account key, purchases or fake execution.
5. Full saved journey and browser audit, publish preview, no main merge.

The monitor may fetch, review, check and publish accepted work. It must prepare prompts instead of launching implementation until Jayden changes the manual-launch preference.
