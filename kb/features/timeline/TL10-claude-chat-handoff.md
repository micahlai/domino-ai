# TL10 handoff: Claude chat, scenario branches and timeline controls

Written 2026-10-25 for the next agent picking up this work. Read this, then `AGENTS.md`, then the files named below. Everything here is on branch `claude-timeline-chat` (pushed, tip `bae9a8e`). `main` is untouched. No PR is open yet: https://github.com/micahlai/domino-ai/pull/new/claude-timeline-chat

This work sits in the Timeline lane (owned by Micah's teammate). Task cards, board row and `kb/decisions.md` entries were not written; see "Not done".

## Where the code is

| Worktree | Branch | State |
| --- | --- | --- |
| `../domino-claude-chat` | `claude-timeline-chat` | The branch to continue on. Clean. |
| `../domino-unified-chat` | `timeline-unified-chat` | Same tip. **The dev server currently runs from here.** |
| `../domino-chat-layout`, `../domino-scenario-colors` | older branches | Fully merged, safe to remove (`git worktree remove`). |

### Run it

```bash
cd ../domino-unified-chat   # or ../domino-claude-chat after copying data, see below
pnpm dev                    # Convex local backend on 127.0.0.1:3212, Next on 127.0.0.1:3000
open http://127.0.0.1:3000/c/kestrel/timeline
```

**Local data gotcha.** Each worktree keeps its own local Convex database and env vars in `apps/web/.convex`. A new worktree starts empty, with no `ANTHROPIC_API_KEY`. The working copy (Kestrel test company, demo scenario tree, Anthropic key and model) is in `../domino-unified-chat/apps/web/.convex`. To run another worktree, stop the server and copy that folder over the new worktree's `apps/web/.convex`. The original checkout `../domino-ai` uses a different deployment (`anonymous-agent`, port 3220) with the team's older data; it was not changed.

Demo data in the local DB (Kestrel, base run `timeline:workspace/e3f72f6a…`): "Legal settlement paid" (starts Nov 17) with children "Acme pays 3 weeks late" (Nov 25) and "Raise bridge loan" (Dec 7); "Northwind pays 2 weeks late" (Nov 30) off the base.

## What was built (commits, oldest first)

1. `d78db83` **Claude answers chat and questions.** `convex/timeline/chatAssistant.ts` (action `timeline/chatAssistant:send`, same args/receipt as `chat:send`), `convex/timeline/assistant/{claude,context,questions}.ts`. The UI calls the action; without a key it forwards to the fixed-grammar `chat:send`.
2. `b9f25bb` **Layout.** Assistant pinned right at full height, left scenario rail, Enter to send, conversations scroll on their own with the composer pinned, `motion` animations. `components/timeline/workspace/{Assistant,chatFrame,ScenarioNav}.tsx`.
3. `91affe4` **Color-coded scenario branches with start dates.** Chart main line is always the base forecast; ticked scenarios draw in their own colors without navigation (`shownScenarios.tsx`, `scenarioComparisons.ts`). Lines start where they leave their nearest shown ancestor. Rail is a branch tree with "Build on". Start dates via `convex/timeline/scenarioStart.ts`; catalog entries gain `startsOn`.
4. `86e8170`, `f559380`, `123747a`, `f517bc5` **Chart controls.** Wider rail, axis titles and gridlines, two-handle time scroller under the chart and two-handle cash scroller beside it (`WorkspaceChart.tsx`: `RangeBar`, `CashBar`).
5. `d3f0a4d` Branches that differ from week one fork from the last recorded week; trackpad: two-finger swipe pans time and cash, pinch zooms time.
6. `d02f452` **Branch confirmation.** Proposal cards (chat review and Ask a question suggestions) show "Branches off ● [parent] on [date]" in the parent's color and the chart flashes the fork point (`branchPreview.tsx`).
7. `7effa62` **One "Ask Domino" chat.** Chat answers questions with sources (Claude tool `answer_question` and the fixed grammar both use the question resolver) and drafts what-ifs. First message starts the conversation. Saved one-off questions remain under "Earlier questions (N)".
8. `bae9a8e` A child scenario is shown only with all its parents; hiding a parent hides its children.

## Invariants to keep

- **Claude never makes the numbers.** Claude only fills `Intent` slots with normalized text (`"$50,000"`, `"2026-11-02"`, exact record ids). The existing deterministic path builds every proposal: `chat/draft.ts` `evaluateIntents` → `finish` → `questions/resolve.ts`, and `saveAssistantTurn` re-runs it before writing. Tests assert Claude-path proposals equal grammar-path proposals (`chat/assistant.test.ts`). Answers quote only numbers from the run context (`assistant/context.ts`, integer cents).
- **The meaning guard compares slots with wording.** Resolve Claude's intents against a statement built from the slots (`statement()` in `draft.ts`), never the raw user text, or normalized values are rejected.
- **Branch start rule.** A what-if may not start before the scenario it builds on (nearest ancestor with event changes). Enforced in `workspace:simulate` (`branchFloor`, error `STARTS_BEFORE_PARENT`) and explained early in chat. Automated responses from the saved-risks analysis pass `allowEarlierStart: true` because fixes may act before the risk.
- **Start dates.** A change starts on its own date; invoice and bill changes start on the record's due date (`scenarioStart.ts`). The client imports this pure file from `convex/` directly; keep it free of server imports.
- **Visibility.** Base is always drawn. A shown child implies shown ancestors (`toggleShown`, `showWithAncestors`, `hideWithDescendants`). Max 6 shown lines. Colors are stable per scenario while shown (`assignColors`).
- **Forecast horizon stays 13 weeks** (user decision; `ForecastSchema` is fixed at 13).
- Opt-out: `TIMELINE_ASSISTANT=off` keeps the earlier one-shot question reader and fixed grammar. Model: `TIMELINE_ASSISTANT_MODEL`, default `claude-opus-5-5` (the Convex `ANTHROPIC_MODEL=claude-sonnet-5-5` is ignored by these features). Requests use `fallbacks: "default"`.

## Verified

- `pnpm check` passes on the tip: typecheck, Biome, 1,209 web tests (plus all other packages).
- Live against the real API (local Convex): sloppy "pay 50000 to atlas legal on 2026-11-2" becomes a ready proposal in one turn; invoice choices offered for a late payment; question then what-if in one chat with sources.

## Not verified / known gaps

- **No browser check of any new UI.** The Chrome extension never connected in this session. Drag/scroll/pinch, the flash animation, the tree connectors and layout at different widths are tested only as static markup. Do a real browser pass first.
- The left rail and "Build on" exist only at ≥1280px. Narrower screens use the in-page "Saved scenarios" list, which opens scenarios by navigation.
- A scenario saved from the chat is not auto-ticked on the chart (composer and question saves are).
- Pan by trackpad moves time in whole weeks (slightly steppy).
- Question answers from Claude for broad "why" questions have no citations (status `answered`, `citations: []`).

## Not done (repo process)

- Task cards in `kb/tasks/`, board row, `kb/decisions.md` lines, spec updates (`TL9-chat-interface.md` no longer describes the chat: Claude path, choices, sources, unified chat, `startsOn`, branch rule).
- Playground entries that exercise the scrollers, branch tree and flash (`/playground` requirement in AGENTS.md).

## Next steps (agreed direction)

1. Browser pass and fixes (above).
2. **Phase 3: solution scenarios.** Score fixes against a scenario's full change chain (reuse `analysis/compute.ts` `responsesFor` with `ancestorChanges`), save each as a child of the issue scenario, mark it as a fix (needs a run kind or flag: `convex/schema.ts` change → request via `kb/requests.md`), and offer "how do we fix this?" in chat as engine-ranked choices.
3. Write the docs above, then open the PR.
