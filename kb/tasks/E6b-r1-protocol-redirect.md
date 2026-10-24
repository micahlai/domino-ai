# E6b-r1: Accept documented responses and close redirect bypass
- **Goal:** Resolve the two independent provider adapter blockers before live smoke.
- **Folder:** packages/agents only; exception: this card Result. Continue existing E6b branch/worktree.
- **Contracts used:** Existing provider clients and diagnostics, no schema/API changes.
- **Done when:** Both audit probes are regression tests, malformed/ambiguous outputs still fail, credential stripping stays intact, and full pnpm check passes.
- **Notes:** Read kb/reviews/E6b-81c0975.md in main and the two /private/tmp probes. Filter only documented thinking/redacted_thinking blocks; require exactly one validated text block. Never log or return the reasoning blocks. Reject malformed known blocks and unsupported tool/other blocks. Keep refusal/truncation checks. Do not arbitrarily pin a model or send unsupported thinking-disable settings.
- **Redirect:** Normalize terminal DNS dots before host classification, or reject such targets consistently. Cover localhost., metadata.google.internal., server.local., intranet., mixed case and their encoded forms where URL parsing permits them. Retain bounded manual redirects and permanent Authorization stripping after leaving trusted origin. Public storage redirects must still work.
- **Scope:** Focused protocol/URL helpers and tests only. No live calls, env/auth reads, model configuration, dependencies, contract or other checkout edits. Full check, Result and commit; Codex runs authenticated smoke after audit.
- **Coordination:** You are not alone. No subagents, external messages, board/handoffs, deployment, pull/rebase/reset/stash/merge/push. User authorized direct Claude implementation.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
