# E6e: Read strict results from trusted text artifacts
- **Goal:** Handle observed CREAO weeklyBrief Markdown artifacts without accepting narration or memory summaries.
- **Folder:** packages/agents; exception this card Result.
- **Contracts used:** Existing provider text/structured outputs and safe transport.
- **Done when:** Bounded authenticated text/Markdown artifacts use the same strict extractor; malformed/ambiguous outputs still fail; sanitized diagnostics describe extraction counts; pnpm check passes. Lead live smoke afterward.
- **Evidence:** Direct smoke25seconds returned result/chatText present,923characters, startmarkertrue/endfalse, zero candidates, one Markdown artifact, no JSON artifacts. Claude explain/weeklyBrief now pass. No artifact content has been accepted or exposed.
- **Implementation:** Extend recognized artifact metadata to JSON, plain text and Markdown (documented MIME/title patterns); all recognized downloads share maxArtifacts budget, byte/time/redirect limits and trusted per-run URL checks. JSON retains JSON parse; text/Markdown runs existing chatTextCandidates and selectOne over all sources. Require explicit envelope/delimiters or fenced JSON already supported, never arbitrary prose or result.text. Conflicting valid answers remain ambiguous. Incomplete markers/fences must not become prose success.
- **Diagnostics:** Fixed counts for recognized/downloaded/parsed artifact categories and extracted valid/distinct candidates only. No URLs/titles/IDs/text/reasoning/env in diagnostics. Callback isolation and default-off retained. Remote agent instructions/credentials unchanged. Prompt can explicitly require an artifact to contain the same JSON envelope if necessary; no arbitrary formatting adaptation.
- **Verification:** Trusted Markdown with one envelope succeeds; plain text with explicit result delimiters succeeds; unmarked narrative fails; malformed fences/JSON fail; conflicting chat/artifact fails; equivalent duplicates accepted; combined cap prevents more than allowed recognized downloads; private redirect/auth stripping protections unchanged.
- **Coordination:** You are not alone. Launch after E6d integration. No contracts/engine/sim/web/deps/env/auth reads/network/provider calls/other checkout writes/subagents/board/handoffs/pull/rebase/reset/stash/merge/push. Commit owned files/Result. Thirty-minute checkpoint.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
