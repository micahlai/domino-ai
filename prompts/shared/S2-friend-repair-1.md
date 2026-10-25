# Friend: S2 repair round 1

Copy to the friend's agent. Audit: kb/reviews/S2-bd7e880-codex-audit.md (on preview after the lead pushes, or pasted below).

```text
Independent Codex audit REJECTED S2 bd7e880 with ONE finding; everything else passed (2/2 typechecks, 408 web tests, 125 status permutations, case isolation, ordering ties, allowlist, no writes, ownership 5/5 files).

P2, apps/web/convex/investigationCatalog.ts:185: pagination has no server-enforced read bound. A caller can pass a returned cursor as endCursor with numItems: 1 (and omit maximumRowsRead); Convex then materializes every row up to endCursor (the auditor reproduced 500 conversation rows read) BEFORE your page.length guard rejects it. The guard limits the response, not the read.

Fix so the bound holds before reading completes, using a server-controlled value the caller cannot override. Options, pick the simplest correct one and document it in the card Result:
(a) Override maximumRowsRead server-side, e.g. paginate({ ...paginationOpts, maximumRowsRead: MAX_PAGE_ITEMS + 1 }) and treat a split or over-limit page as fail-closed or as a truncated page with continueCursor, OR
(b) Reject any request that supplies endCursor or caller maximumRowsRead/maximumBytesRead, if the catalog does not need them.
Verify against the installed Convex version's paginate semantics (check node_modules/convex types/docs), not memory.

Add a regression test: 500 conversations, endCursor from a later page with numItems: 1, assert at most MAX_PAGE_ITEMS + 1 rows are read (or the request is rejected) and no oversized page is returned. Keep all existing tests passing. Stay within the S2 file ownership. Run focused investigationCatalog tests, web + convex typecheck (tsc --noEmit --incremental false), web vitest, biome on apps/web/convex. Commit and push ONLY S2-simulation-catalog (no force, no main/preview). Report the new sha, diff summary, test counts.
```
