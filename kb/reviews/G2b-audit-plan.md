# G2b independent audit plan

Prepared by Astra audit_g2a against committed foundation and task scope, not an approval of the in-progress worker. No tests run for this checklist.

1. Submit then close browser: backend scheduled work completes unaided. Scheduling failure rolls intent/message back atomically.
2. Concurrent same-key/same-payload submits yield one chain/provider attempt; changed payload conflicts. Same key in another conversation cannot return the first conversation's historical run.
3. Reject substituted conversation/operation/baseline/dependency IDs. Reveal in A cannot widen B or old operation inputs.
4. Hold fake HTTP open and race claim calls: persist running first, invoke once. Lease expiry prevents late completion overwrite and never retries paid work automatically.
5. Inspect actual serialized provider requests after a queued run and unrelated reveal. Exclude S8/H01/H03/D01 and reveal-derived messages; compare with authoritative getRun.inputSnapshot. Old hashes remain fixed.
6. Only explicit requests reveal or compute alternatives. Provider prose/source wakeups cannot execute those gates; legacy APIs cannot silently widen conversation visibility.
7. Default unavailable CREAO fails with zero Claude calls. Explicit Claude development mode reports Claude. Refusal, malformed output, timeout and unknown outcome never create agent success; completed tools remain inspectable.
8. Compare saved instruction/profile snapshot with actual outbound instructions; changing profiles later must not relabel old runs. Exclude secrets/raw reasoning from rows and queries.
9. Enforce concurrent-turn and two-specialist attempt ceilings atomically across distinct request IDs, failed attempts, reload and expiry. Unknown remote outcome consumes an attempt.
10. Same source version is no-op; arbitrary changed strings/unrevealed future disclosures cannot fabricate discovery or trigger paid work.

Use controlled convex-test scheduler and deferred HTTP, then isolated local-backend concurrency checks. Re-run shared historical/activity tests where altered. CREAO live execution is a separate gate.
