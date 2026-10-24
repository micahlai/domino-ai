# Decisions

Newest first. Format: `- YYYY-MM-DD Name: decision. Why: reason.`

- 2026-10-24 Micah: default to the supplied dark palette and reuse the calhacks-2026 Domino mark. Why: explicit user direction supersedes the light-only design spec.

- 2026-10-24 Codex brain: prepare E3a, E1a and E6a as package-scoped first slices; full E1/E3/E6 stay open. Why: unblock offline work without mixing shared files, credentials or unresolved contracts. See kb/tasks/launch-plan-2026-10-24.md for provisional forecast conventions and deferred work.
- 2026-10-24 Codex brain: forecast must reject ambiguous signed-deal/invoice pairs until an explicit linkage is approved. Why: current contracts cannot establish whether cash is already invoiced; matching by amount alone could hide or double-count receipts.
- 2026-10-24 Micah: P2 company relationships use Convex document IDs while fixture payloads retain canonical contract IDs. Why: database relationships stay typed without changing shared contracts. The seed returns the ID for UI routing.
- 2026-10-24 Micah: seed fixtures once and preserve approvals on rerun; unpulled sources have null lastPull and pending tie-out. Why: sample data must not reset human decisions or claim a connector ran.
- 2026-10-24 Micah: remove Figma from frontend scope. Why: user direction; use the Next.js playground, screenshot reviews and Vercel instead. P7 now covers usability testing and demo materials.
- 2026-10-24 Micah: P1 uses an isolated local Convex backend and its built-in `--run-sh` to start Next after bindings are ready. Why: local work proceeds without cloud credentials and both services stop cleanly together.
- 2026-10-24 Jayden: the multiverse timeline is the hero visual and the main screen. Why: it is the clearest "wow" and directly answers "is the company resistant to what might happen?"
- 2026-10-24 Jayden: use CREAO for learning agents (mapSource, readConstraints, weeklyBrief) and Claude for live agents (proposeFixes, explain). Why: CREAO track; learning is our core feature; live calls must be fast.
- 2026-10-23 Team: all TypeScript, one monorepo. Why: two people plus agents; one language.
- 2026-10-23 Team: Convex is the only database. Capital One Nessie is the bank. Why: live UI updates; sponsor tracks with a real job.
- 2026-10-23 Team: vertical is B2B software, seat is FP&A cash forecasting. Why: mentor feedback; rich cash-timing problems; public peers for realism.
- 2026-10-23 Team: not entering Anthropic "Claude for Public Benefit" or Cartesia. Why: no real fit.
