# Domino handoff
## 2026-10-24: E3b and E4 integrated after direct Claude execution
- Goal: Claude implements; Codex directly dispatches, audits and integrates. User authorized running Claude without relaying prompts. Particle work remains deferred.
- Done: E3b aa1d876 merged at b7a6d93. E4 2340ff8 plus repair 87de4f6 are reviewed and merged at c354bcb alongside P3/P4/I1, E3a/C1/E1a/E6a. Independent Sol/Astra reviews and lead probes clear the recorded blockers. Combined and post-merge 240 tests, five typechecks and lint pass; fresh production build passes.
- Current engine: forecast, dominoes, scanRisks, scoreFix, rankFixes, history, pastEvents and stressTest implemented. grade/learn remain placeholders. No claim that Convex actions already use these functions or live provider credentials work.
- Next exact step: scope Claude's provider-adapter and connector/action work from the existing E5/E6/E7 dependencies. Preserve actual generated risk IDs, load ancestor context once, and plan an idempotent C1 seed backfill that preserves approvals. Do not reset data.
- Reviews: kb/reviews/E3b-r2-aa1d876.md and kb/reviews/E4-r1-87de4f6.md. Broad churn may omit causal links conservatively; daily-only risks retain zero low-point impact under the chosen ranking. No invented signing dates; current restricted cash is a disclosed historical assumption.
- Workers: Claude E4 is finished, clean at 87de4f6 in ../domino-E4. Logs /tmp/domino-E4-claude.log and /tmp/domino-E4-r1-claude.log. No active implementation writer. Original E3b/E4 and other worktrees retained; no deletion authorized.
- Preservation: .env.example changes, CREAO notes/cards and untracked web tooling remain outside integration. No ignored env changes, push, deployment, particle integration or external data write.
- Servers: temporary UI preview localhost:3012 stopped and browser tab closed. No server owned by this integration remains. Screenshot /tmp/domino-ui-integration.png verifies illustrative fixture UI only.
