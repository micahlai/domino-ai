# Knowledge base

This folder is our shared memory. People and AI agents read it before work and update it
after work. It lives in git, so `git pull` gives you everything the other person knows.

## Rules

1. **Pull before you start. Push when you finish.** Knowledge changes go in the same commit as the code they describe.
2. **One fact, one place.** Do not copy facts between files. Link to them.
3. **Short entries.** One idea per line. Newest entries at the top.
4. **Dates and names on every log entry.** Format: `2026-10-24 09:10 Jayden:`.
5. **The spec is the truth.** If code and spec disagree, fix one of them in the same commit and add a line to `decisions.md`.

## Map

| File | What it holds | When to update |
| --- | --- | --- |
| `spec/build-spec.md` | The full product and engineering spec | When a design decision changes |
| `spec/design-spec.md` | Screens, components, props, design tokens, wording | When the UI design changes |
| `spec/convex-api.md` | Every Convex table, query, mutation and action | Before you add or change one |
| `product/overview.md` | Pitch, seats, tracks | Rarely |
| `product/demo-script.md` | The 3-minute demo, step by step | When the demo changes |
| `product/proof.md` | What is real, what is simulated, test results | When we have new numbers |
| `product/submission.md` | Every track's requirements and our checklist | When we finish a requirement |
| `product/hyphenate-checklist.md` | Hyphenate brief mapped to what we build | Before submission |
| `status/board.md` | Every task: owner, status, branch | Start and end of every task |
| `handoffs.md` | Short notes for the other person | End of every task or work session |
| `decisions.md` | Each decision and why | Whenever we decide something |
| `requests.md` | Requests to change someone else's area | When you need a change |
| `scenarios.md` | Events and fixes we want to demo | Whenever you have an idea |
| `stage-log.md` | Archived optional track template (outside frontend scope) | Only if that track is resumed |
| `glossary.md` | Finance words in plain English | When a new word appears |
| `research/` | Public company data, sponsor notes | When you research something |
| `tasks/` | Task cards for agents | Before you start an agent |
| `context/` | Session handoffs that explain why decisions were made (read `context/claude-session-2026-10-23.md` first if you are new) | When a long planning session ends |
