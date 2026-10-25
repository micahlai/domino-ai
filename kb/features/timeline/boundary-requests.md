# Timeline boundary requests

## P0 acceptance and exact base (open)

Published lane agreement/brief are now available in preview at `a1b9341`. Earlier local missing-document blocker is resolved. The implementation/acceptance gate remains open:

| Gate | Verified published evidence | Needed before the long fork |
| --- | --- | --- |
| P0-C | `kb/reviews/P0C-189fb0d-codex-audit.md`: REJECT; repairs recorded as dispatched | Accepted repaired contracts; actual consumer hash verification; method-pin equality regression assigned to P0-H; versioned fixture hashes |
| P0-S | Task prepared; setup blocked on S2 checkpoint | Composed unchanged schema and indexes, saved-shape compatibility checks, exact fragment paths, independent acceptance |
| P0-H | Task prepared; waits accepted C/S | Real isolated backend/harness routes, seed tamper rejection, compatible old routes/consumers, checks/build/browser, exact setup commands |
| Common base | No accepted P0 base recorded in inspected history | One exact accepted commit and fixture digests, followed by long-lived Timeline branch |

This is a shared preparation prerequisite, not a request for Field to implement Timeline persistence. No replacement seam is proposed. Keep the shared setup dispatcher and its existing workers; do not launch duplicates.

## S2 single-index handoff to P0-S (ready for shared setup)

S2 remote remains `1154972c3edae09d0a5df7c19c553b329b1b46fa`, with no catalog module/test or `by_case_createdAt` index. No S2 writer/worktree is present on this machine. Existing Timeline control work and prior local changes are preserved.

This lead releases its schema reservation for ONLY `investigationConversations.by_case_createdAt(caseId, createdAt)` to the existing P0-S assignment. P0-S may add and independently review that bounded index as part of its recorded prerequisite, as allowed by the lane agreement's alternative explicit owner/review path. This does not transfer the catalog feature or authorize Field/runtime/API changes. If another machine has unpushed S2 work, preserve/checkpoint it before touching overlapping files. No index exists to claim as already reviewed.

Acknowledge incorporation in the shared setup checkpoint. Ordinary Timeline catalog/backend work resumes within Timeline after accepted P0, without waiting for Field's L5.

## Shared-setup handoff and technical preflight

Latest user requests this chat to prepare shared P0. Cross-machine ownership/actual process-count confirmation is pending because published records already show another shared lead and P0-C/L2 repairs. No competing implementation is launched. [Preflight](../../coordination/historical/P0-setup-preflight-micah-2026-10-24.md) records the resolved official Convex guide, 22-table schema baseline and 55/55 existing backend tests. This does not accept P0 or replace the existing P0-C repair.
