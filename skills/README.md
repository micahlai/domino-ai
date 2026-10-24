# Skills

Plain markdown checklists for building Domino. They work with any coding agent and with people.

## How to use a skill in each tool

| Tool | How |
| --- | --- |
| Any agent or person | Open `skills/<name>/SKILL.md` and follow it. Prompts and task cards name the skill files to read. |
| Claude Code | Same, or let it auto-discover them (`.claude/skills` links here). |
| Codex | Reads `AGENTS.md`, which lists the skills. Paste "Read skills/<name>/SKILL.md and follow it." |
| Cursor | `.cursor/rules/domino.mdc` points here. Mention the file with `@skills/<name>/SKILL.md`. |
| Gemini CLI | `GEMINI.md` points to `AGENTS.md` and here. |
| CREAO agents | Paste the relevant skill text into the agent's instructions. |

## Rules for writing a skill

- Plain steps and checklists. No tool-specific commands (no "use the X tool", no slash commands).
- Name files and commands that exist in this repo.
- Keep the front matter (`name`, `description`): it helps tools that auto-discover skills and is harmless for others.

| Skill | Use it when |
| --- | --- |
| orchestrator | Planning work and running several agents in parallel |
| task-card | Writing a task for an agent |
| kb-sync | Start and end of every task |
| contract-change | A shared type must change |
| engine-tdd | Engine or simulator code |
| ui-build | Any screen or component |
| taste | Reviewing a screen |
| ideate | Trying an idea in 15 minutes |
| review | Reviewing a diff before merge |
| demo-check | Running the demo end to end |
| figma-stage-log | Writing a Figma stage log entry |
