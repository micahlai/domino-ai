# E6c: Make provider text jobs diagnosable and adequately budgeted
- **Goal:** Resolve observed Claude explanation truncation and safely diagnose CREAO weeklyBrief no_result.
- **Folder:** packages/agents; exception this card Result only.
- **Contracts used:** AgentJob, existing provider outputs and failure categories. No shared contract edits.
- **Done when:** Claude explain and weeklyBrief defaults are4096 tokens; strict extraction remains intact; opt-in sanitized CREAO format diagnostics are tested; pnpm check passes. Lead runs live smoke separately.
- **Notes:** Live Claude explain512-token call truncated. CREAO weeklyBrief completed but no validated result; mapSource/readConstraints passed. Do not guess the missing format. Raise bounded short-text budget only, preserve truncation checks and per-job override.
- **Diagnostics:** Add an optional diagnostics callback suitable for smoke opt-in SMOKE_DIAGNOSTICS=1, reporting only fixed enums, booleans and counts: result/chatText presence, length, envelope/delimiter/fence presence, artifact counts by fixed MIME category, candidate/validated/distinct counts, failure stage. No provider text, reasoning, URLs, titles, IDs, headers, errors or env values. Callback failure must not alter provider results. Default off.
- **Extraction repair:** Reviewer reproduced malformed JSON inside result delimiters being accepted as a plain-text brief through tryJson(body) ?? {text:body}. Reject JSON-looking parse failures, preserve ordinary explicitly delimited prose. Add red/green tests for malformed objects/arrays and legitimate delimited prose.
- **Extraction:** Do not broaden to plain prose, memory result.text or generic first-text success. No artifact-format expansion until observed metadata justifies it; return findings for follow-up. No remote agent changes, retries or fallback changes.
- **Verification:** Regression tests request limits/overrides/truncation, diagnostics on/off/redaction/callback throws, and existing refusal/ambiguous/malformed protections. Preserve typed public API. Read existing implementation and review notes first.
- **Coordination:** You are not alone. No C3 entity adoption yet, dependencies, env/auth files, network/provider calls, other checkout edits, subagents, pull/rebase/reset/stash/merge/push/deploy. User authorized Claude implementation. Thirty-minute checkpoint. Commit only owned files and Result.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
