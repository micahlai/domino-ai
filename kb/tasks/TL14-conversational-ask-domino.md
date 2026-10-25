# TL14: Conversational Ask Domino

- **Goal:** Ask Domino discusses arbitrary messages naturally, remembers the full saved conversation, and clarifies what-ifs without forcing Start over.
- **Folder:** apps/web; this Result section. No shared contracts, schema, financial engine or unrelated Field changes.
- **Contracts used:** existing Change, Forecast, Constraint; local ChatReceipt, Draft, Intent and QuestionProposal validated with Zod.
- **Done when:** every accepted message invokes the LLM with all saved turns and current draft/selection/Worker context; general discussion and supported follow-ups work; exact lawsuit example asks liability-versus-payment clarification; grounded proposals remain review-before-save; retry/revision/isolation tests pass; pnpm check passes.
- **User steering:** Never bypass LLM. No grammar/canned-answer fallback for Ask Domino, including short slot replies, corrections, unsupported qualifiers or missing configuration. Provider unavailable/failure must leave the message retryable and not append a fake answer. Deterministic validation/calculation tools are allowed; an already accepted idempotent retry replays its actual earlier LLM response.
- **Required context:** Full conversation plus relevant invoice/company/timeline context, and MOST IMPORTANTLY the Brain map outputs. Resolve Field company identity from the verified Timeline seed/link (not names); supply saved analyst trace/scenarios/recommendations, audit findings, learned model/rules and source provenance. Use existing query boundaries and Zod schemas. Keep frozen Timeline facts distinct from newer Field evidence, label dates/staleness, and disclose missing/truncated context. Worker suggestion context alone is insufficient for regular Timeline chats. Test populated ordinary-chat context and cross-company/stale/missing sources. Do not expose secrets/raw provider logs or use held-out answer keys.
- **Notes:** continue origin/main fe1fbad in codex/ask-domino-conversation. Claude implements; Codex audits. Read existing chat/assistant tests and kb/spec/build-spec.md. Preserve checked engine answers/citations and leased idempotency. Enable LLM narration without allowing narration to write proposals, compute forecast money or treat source/Worker text as instructions. Explicitly handle unavailable providers; no canned claim of a working LLM. Unsupported scenarios remain discussable. Reset must prevent old draft revival; context must distinguish previous discussion from current approved values. Do not add broad regex barriers to conversation. No deployment, main merge, external calls, nested agents or runtime changes. Focused tests only by worker; root runs full check/build/browser.

## Result
- Done:
- What changed (files):
- Watch out:
