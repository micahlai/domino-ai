# E3c ffeea88: blocked checkpoint

2026-10-24. Claude implementation; independent GPT-6 Astra review plus lead forced branch check. No merge and no repair dispatched after the historical pivot.

`TURBO_FORCE=true pnpm check` passes typechecks, lint and 657 tests on this branch, including 169 engine tests. Passing tests do not resolve the two independent reproductions.

1. **P2: late-payment scenario ignores issuance clamp.** packages/engine/src/risks.ts:120 uses rounded p90 minus rounded mean after the baseline clamps receipt to issuance. Issued October 30, due November 25, mean -40 and p90 -10: baseline October 30, generated delay 30 days yields November 29. Correct p90 receipt is November 15, only 16 additional days. The incorrect scenario falsely breaches a November 16 bill deadline.
2. **P2: daily funding permits unsafe intermediate cents.** packages/engine/src/funding.ts:34 sums unguarded daily usable cash, despite forecast.ts weekly guards. With M = Number.MAX_SAFE_INTEGER, cash and restricted cash M, payroll outflows 2 and M, plan receipt 2 and payout M, exact usable is zero. The implementation marks a one-cent bill funded. Inputs parse through SnapshotSchema and weekly guards pass.

Reproduction is preserved in /tmp/e3c-independent-audit.ts; copy retained beside this review as E3c-independent-probes.ts.txt. Worktree ../domino-E3c remains clean at ffeea88. Reuse requires a separately authorized repair and review. Forward operational plans are not necessary for the smallest public-disclosure demo.
