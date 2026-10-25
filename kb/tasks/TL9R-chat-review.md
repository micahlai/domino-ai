# TL9R: independent conversational proposal review

- **Goal:** find correctness/scope/retry bugs in saved clarification chat before acceptance.
- **Folder:** read-only TL9 backend/UI worktrees and integration; scratch /tmp/TL9-review; this Result by lead.
- **Contracts used:** existing Change/Constraint/WorkspaceRun/QuestionProposal; frozen TL9-chat-interface.md wire.
- **Done when:** stable SHA accepted or concrete repro blockers. Verify short replies retain typed pending fields, ambiguous/conflicting/unsafe input never becomes guessed event, rules retain old set, confirm only frozen server proposal at revision, exact request snapshots/retries, cross-company/run isolation, bounded rows/transcript, no engine/provider beforeconfirm/read, UI honest/source-pinned/pending/stale response handling and reviewcardexactness.
- **Notes:** no source/env/services/provider/TL7/main/push edits or delegation. Read review/ui-build/taste. Authors repair; reviewer reruns meaningful focused/scratch tests. Lead does independent live3109/3260 API/browser multi-turn save/reload and fullcheck/build. Existing3107 preview/published origin/TL7-checkpoint remain unchanged. Record report /tmp/TL9-review/review.md.

## Result
- Done: accepted locally; see kb/features/timeline/TL9-acceptance.md and TL9-review.md.
- What changed: none; read-only review.
- Watch out: TL9 unpushed; no merge into TL7. Bounded deterministic supported wording only.
