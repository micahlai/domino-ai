# E6c-r1: Reject incomplete result code fences
- **Goal:** Reject malformed JSON behind incomplete/invalid code fences inside explicit result delimiters.
- **Folder:** packages/agents; exception this card Result.
- **Contracts used:** Existing text output and strict extractor only.
- **Done when:** Red/green tests reject opening triple-backtick-json followed by malformed text object with no closing fence, and two-backtick closing fence; valid complete fenced JSON and ordinary delimited prose still pass. Full pnpm check passes.
- **Notes:** Reviewer reproduction /private/tmp/e6c-extract-probe.ts. unfence strips only complete fences, then object/array prefix guard misses leading backticks. Fail closed on malformed leading code fences; do not broadly accept prose. Preserve diagnostics and caps.
- **Coordination:** You are not alone. Same E6c branch; no prompts.ts/schema edits because E6d handles C3 compatibility separately. No env/network/deps/subagents/other checkout writes/board/handoffs/pull/rebase/reset/stash/merge/push. Commit owned files and Result. Thirty-minute checkpoint.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
