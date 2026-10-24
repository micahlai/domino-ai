# Prompts: what to run, who runs it, in what order

## Current launch: historical overnight run

The old run order below is historical reference, not the current launch queue. Launch only `shared/H0-overnight-orchestrator.md` on this computer; it spawns evidence, backend and UI subagents. The UI subagent reads `product/H3-historical-ui.md`. Read `../kb/spec/project-stages-2026-10-24.md`. All start from origin/integration/historical-case-study in isolated worktrees. Claude coordinates all three workers; Codex audits before final integration. No main merge or production deploy.

Each file is a ready-to-paste prompt for a coding agent. Open the file, start the agent tool it names,
in its own worktree, and paste the block under "Prompt".

**Jayden = engine. Micah = product.** Max 2 to 3 agents per person at once.

## Original run order, superseded

| When | Jayden runs | Micah runs | In parallel? |
| --- | --- | --- | --- |
| Now (Fri night) | `shared/00-setup.md` | `shared/00-setup.md` | Both |
| Fri night | `engine/E1-simulator.md` + `engine/E3-forecast-dominoes.md` + `engine/E6-agents.md` | `product/P1-web-shell.md`, then `product/P2-convex.md` | Yes: E1, E3, E6 touch different folders |
| Sat morning | `engine/E2-mocks-and-seed.md`, then `engine/E4-multiverse.md` | `product/P3-multiverse-timeline.md` + `product/P4-main-screen.md` | Yes |
| Sat 12 PM gate | `shared/99-gate-check.md` | `shared/99-gate-check.md` | Together |
| Sat afternoon | `engine/E5-connectors.md`, then `engine/E7-wiring-learning.md` | `product/P5-flows.md`, then `product/P6-learning-record-polish.md` | Yes |
| Sat 6 PM gate | `shared/99-gate-check.md` | `shared/99-gate-check.md` | Together |
| Sat evening | `engine/E8-proof.md` | `product/P7-user-test.md` | Yes |
| Sun night | Add-ons only if the gate passed | `product/P8-submission.md` | |

## How to run one prompt

1. `git pull` on `main`.
2. `git worktree add ../domino-<ID> -b <ID>-<name>` and open that folder in the agent tool.
3. Paste the prompt. Let the agent work. Answer its questions.
4. When it says done: run `pnpm check` yourself, open a PR, ask another agent to review it with `skills/review/SKILL.md`.
5. Merge. Update the board (the agent should have done this already).

## Agent tools

- **Claude Code:** most prompts. Reads `CLAUDE.md` and the skills automatically.
- **Codex:** Micah’s web tasks P1–P8 and prompts marked "Codex OK". Read `AGENTS.md` and the named skills; frontend work uses Next.js on Vercel and `/playground`.
- **Cursor:** live UI tweaks while you watch. Rules load from `.cursor/rules/`.
