# Domino handoff
## 2026-10-24: E3b audit requires Claude repairs
- Goal: Claude implements engine work; Codex audits, checks and integrates. Keep one engine writer.
- Main: E3a merged at 59fe62d, C1 at 3c54e67. Main's prior combined verification passed 131 tests and a fresh build. Unrelated environment/README/CREAO/web tooling work is preserved.
- E3b: Claude finished clean e77474d on E3b-dominoes in ../domino-E3b. Not merged. Lead forced pnpm check passes 169 tests (66 engine), five typechecks and lint under Node 24.11.1/pnpm 9.12.0.
- Audit: independent GPT-6 Astra rules review and GPT-6.1 Sol causal review found three blockers, all reproduced by lead with schema-valid inputs. Weekly hire savings can fund before accrual or defer pre-Monday savings; chronology-based causedBy blames unrelated events; duplicate bill IDs corrupt funding/target lookup.
- Evidence: kb/reviews/E3b-e77474d.md has exact cases, file/line references and repair acceptance. Worker Result copied into main's E3b card. Worker checkout untouched.
- Next exact step: user gives Claude kb/tasks/E3b-r1-funding-causes.md from main. Claude copies only that card into its existing E3b checkout, fixes/tests/commits packages/engine plus local Result, and returns commit hash. No rebase or merge of main into the active worker. Codex re-reviews and reruns checks before E3b integration; E4 cannot launch yet.
- Repair design: keep exact weekly hire totals and actual daily availability; per-candidate causal proof or omit the link; reject duplicate bill identities locally without changing shared contracts.
- Remote integration: last fetch found origin/main eight commits ahead of local common history, including P3/P4 and copy; local main was 23 commits ahead then. Particle animation is a separate branch. No remote changes merged or pushed during this audit; recheck refs before integration and preserve local README/.env.example edits.
- Limits: no live provider calls, environment changes, seed resets, deployments, pushes, feature code or worktree deletion by this audit. E4, real adapters and context wiring remain open. Existing seed data requires a separate safe backfill.
