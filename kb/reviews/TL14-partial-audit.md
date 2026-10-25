# TL14 partial implementation audit

Claude session `1b5f3f7a-5f43-4522-af08-671fb231b89a` hit its session limit at 06:42 PDT; reset reported at 07:00 PDT. Working branch: `codex/ask-domino-conversation`, base `fe1fbad`. No implementation commit or checks yet. Main and shared runtimes unchanged; isolated fixture preview is3147/session5623. Original worker sessions83830/76262 were interrupted only to incorporate new user requirements; final75308 exited on the limit. Resume this same session after reset unless the human overrides Claude-only implementation.

## Required before acceptance

- Finish the provider action/save integration: `chatAssistant.ts` is still the old extractor and `chat.ts` has incomplete imports/return wiring. Every new message must invoke LLM; no-key/failure must be retryable with no fake response.
- Ground draft replacement in the latest instruction as well as retained values. Current `checkDraft` can retain an older amount even when the latest user explicitly changes it; its model-written restatement does not prove latest-message coverage.
- Verify populated normal-chat Brain context against actual Field query payloads, replicas, missing/deleted links and newer snapshots. Include research findings and same-version reused summary/coordinator outputs exposed by `fieldAnalyst.latest`, not just the selected trace.
- Complete context truncation accounting and enforce the final budget. `brain.ts` currently stops trimming after a finite list without checking the remaining size, and some sliced lists keep inaccurate included counts or no total. Selected older timeline weeks and records outside initial caps need retrieval.
- Check money narration validation: recursively treating every saved integer as cents also treats counts, versions and day values as money. Keep amount provenance typed; display rounding must not alter financial computations.
- Add action-level mocked LLM regressions, run full checks/Convex tsc/build, inspect the chat playground, and document remaining live-provider limitations.
