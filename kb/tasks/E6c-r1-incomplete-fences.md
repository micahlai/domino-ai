# E6c-r1: Reject incomplete result code fences
- **Goal:** Reject malformed JSON behind incomplete/invalid code fences inside explicit result delimiters.
- **Folder:** packages/agents; exception this card Result.
- **Contracts used:** Existing text output and strict extractor only.
- **Done when:** Red/green tests reject opening triple-backtick-json followed by malformed text object with no closing fence, and two-backtick closing fence; valid complete fenced JSON and ordinary delimited prose still pass. Full pnpm check passes.
- **Notes:** Reviewer reproduction /private/tmp/e6c-extract-probe.ts. unfence strips only complete fences, then object/array prefix guard misses leading backticks. Fail closed on malformed leading code fences; do not broadly accept prose. Preserve diagnostics and caps.
- **Coordination:** You are not alone. Same E6c branch; no prompts.ts/schema edits because E6d handles C3 compatibility separately. No env/network/deps/subagents/other checkout writes/board/handoffs/pull/rebase/reset/stash/merge/push. Commit owned files and Result. Thirty-minute checkpoint.
## Result (worker fills this in when done)
- Done: Delimited bodies that still start with a triple-backtick fence after unfence (no closing fence, or a two-backtick close) now count as malformedDelimited and give no_result. Red seen first (2 new bodies resolved as prose), then green. Valid complete fenced JSON and ordinary delimited prose still pass. `pnpm check` exit 0 (214 agents tests).
- What changed (files): `packages/agents/src/extract.ts` (malformed guard is now `/^(?:[{[]|```)/`), `packages/agents/src/creao.test.ts` (2 incomplete-fence bodies, 1 valid fenced brief).
- Watch out: Delimited prose that starts with a literal triple backtick is now rejected on purpose (fail closed). A single leading backtick is still read as prose. Diagnostics and caps unchanged.
