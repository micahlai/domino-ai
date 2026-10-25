# TL3Q: evidence questions and natural-language event/rule proposals

- **Goal:** pinned one-shot questions answer from saved evidence or yield confirmed event/rule proposals, clarification or saved failure.
- **Folder:** apps/web/convex/timeline (ONLY questions.ts, questions*.ts or questions/**; no workspace/baselines/refs/schema edits).
- **Contracts used:** ChangeSchema, ConstraintSchema, OperationSummaryV1, WeeklySeedV1, Forecast; strict Zod boundary parsing.
- **Done when:** convex-test plus adapter tests cover evidence answer, late invoice equality, expense+cash rule, vague/missing/unsupported clarification, malformed/refused/truncated/provider failures, context isolation, saved request deduplication/conflicts, lease expiry, reload without provider, validated exact proposal link. pnpm check and separate Convex typecheck pass after backend integration.
- **Notes:** frozen interface kb/features/timeline/TL2-TL5-interface.md; workspace get via typed function ref/strict projection, schema supplied by TL2B. Read Convex guidelines; this is bounded one-shot intent extraction with operation receipts, no custom LLM conversation agent. May use a strict documented grammar for common cases and optional one-shot Anthropic fetch only to interpret intent; never calculate money or trust generated answers. Answers derived from actual saved schedule/records, dates and outputs. No private agents imports/shared contracts. No runtime/env/live provider calls (lead verifies). User authorizes parallel through TL5. Commit TL3 steps, Result only, no merge/push.

## Result
- Done:
- What changed (files):
- Watch out:
