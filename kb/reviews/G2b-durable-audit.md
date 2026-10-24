# G2b audit: candidate c185500 blocked

Full pnpm check passed930tests/typechecks/lint. Independent Astra ran32focused tests and6probes (/tmp/g2b-independent.test.ts, /tmp/g2b-independent.config.mjs), reproduced four defects. No live provider calls. All repairs stay in original Convex ownership; G2c owns agents package.

1. P1 investigation.ts476: predictable inv-${operationId} shares public historical receipt namespace. Public saveBaseline/reveal can prepopulate that key so investigation attaches an already-revealed run with no reveal operation. Separate internal request ownership and prohibit legacy public writes from mutating conversation-owned visibility. Prefix alone is insufficient.
2. P2 investigation.ts694: stored profile can differ from current historicalSystemPrompt used by real dispatch. Fail before provider call if frozen instructions/version do not match actual implementation. Do not alter agents package.
3. P2 investigation.ts385/606: leaseUntil not checked in claim/finish. Expire without cleanup running, then action still bills/completes; late result accepted. Enforce at claim/commit and immediately before call; expired queued fails without calling, expired running remains unknown.
4. P2 investigation.ts475: only source/fact IDs compared. Changing source contentHash/title after source load yields a forecast from different evidence. Freeze and consume actual loaded snapshot or fail on full source-version/input drift before creating forecast.

Preserve once-only dispatch and no retries/fallback. Add meaningful regressions and run existing historical/activity/investigation tests, typecheck/scoped lint only. Codex runs full gate again. Read skills/kb-sync/SKILL.md with Read tool; do not skip because compound shell denied.
