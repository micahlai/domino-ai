# Domino handoff
## 2026-10-24: Claude implements; Codex audits
- Goal: Claude Code implements E3b then E4. Codex handles planning, independent review, verification and integration, with no feature code written by the brain.
- Main: reviewed E3a repair 4a9be26 merged at 59fe62d after C1 3c54e67. Only merge conflict was duplicate repair-card notes; main retained Claude's complete Result plus independent audit notes. Original Claude checkout remains clean and untouched.
- Verification: combined main forced pnpm check passes 131 tests, five typechecks and lint; fresh forced pnpm build passes. Node 24.11.1 / pnpm 9.12.0.
- Next exact step: human starts Claude Code in ../domino-E3b on E3b-dominoes and gives it kb/tasks/E3b-dominoes.md. Implement only E3b, fill local card Result, run pnpm check and commit. Return its commit to Codex for independent audit, fresh checks and integration. E4 remains gated until that succeeds.
- E3b checkout: prepared from passing main with its task card and implementation brief. No feature worker launched by Codex. E4 worktree not created yet. Keep one writer in packages/engine at a time.
- Setup: export PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH"; pnpm install --frozen-lockfile. No environment/auth files copied. No new dependencies authorized.
- Scope: E3b adopts invoice links and common deadline/domino rules. E4 later builds scenarios, fix scoring and history. Exact acceptance and funding conventions: kb/spec/engine-e3b-e4-implementation.md.
- Open: raw Kestrel still hits the temporary forecast ambiguity guard until E3b adopts C1. Safe seeded-data backfill and E5/E7 contexts are separate. Parent E3 remains incomplete; passing tests are not a working hero/demo claim.
- Concurrent work: existing README edits, CREAO setup notes/card and untracked apps/web tooling preserved and excluded. No reset, push, deploy, worktree deletion or external messages. No Domino servers started. Do not touch the separate Scrabble bot or read secrets.
