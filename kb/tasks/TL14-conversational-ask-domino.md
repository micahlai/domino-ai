# TL14: Conversational Ask Domino

- **Goal:** Ask Domino discusses arbitrary messages naturally, remembers the full saved conversation, and clarifies what-ifs without forcing Start over.
- **Folder:** apps/web; this Result section. No shared contracts, schema, financial engine or unrelated Field changes.
- **Contracts used:** existing Change, Forecast, Constraint; local ChatReceipt, Draft, Intent and QuestionProposal validated with Zod.
- **Done when:** provider receives all saved turns and current draft/selection/Worker context; general discussion and supported follow-ups work; exact lawsuit example asks liability-versus-payment clarification; grounded proposals remain review-before-save; retry/revision/isolation tests pass; pnpm check passes.
- **Notes:** continue origin/main fe1fbad in codex/ask-domino-conversation. Claude implements; Codex audits. Read existing chat/assistant tests and kb/spec/build-spec.md. Preserve checked engine answers/citations and leased idempotency. Enable LLM narration without allowing narration to write proposals, compute forecast money or treat source/Worker text as instructions. Explicitly handle unavailable providers; no canned claim of a working LLM. Unsupported scenarios remain discussable. Reset must prevent old draft revival; context must distinguish previous discussion from current approved values. Do not add broad regex barriers to conversation. No deployment, main merge, external calls, nested agents or runtime changes. Focused tests only by worker; root runs full check/build/browser.

## Result
- Done:
- What changed (files):
- Watch out:
