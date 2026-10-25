# FIELD Timeline friend integration safety
- Goal: safely integrate friend b9f25bb/d78db83 without retry, stale-call or financial-grounding regressions.
- Own: apps/web/convex/timeline assistant/chat/questions and related tests; optional claim fields on existing schemas/timeline.schema.ts timelineChatRequests only if required; this Result and kb/features/field/TAKEOVER-TIMELINE-CHAT-SAFE.md.
- Read: AGENTS.md, friend review findings and existing request/receipt/meaning validators before editing.
- Deliver: original-input request fingerprints, accepted-replay/preflight and atomic duplicate-call claim, stale/terminal/limit rejection before provider, original wording/source-span semantic validation, deterministic checked financial answers/citations, total provider deadline below question lease.
- No: Field/root schemas, new tables, UI edits, secret/README removal diffs, actual providers, main/runtime, root handoff, force/reset, merge/push.
- Schema permission: optional backward-compatible claim metadata on the existing Timeline chat request table is explicitly authorized if a claim cannot use the existing receipt contract; preserve old rows and isolation/index contracts.
- Checks: mocked same/conflicting/concurrent retries; no provider for replay/stale/saved/limits; fail-closed negation/conditional/daily/invented values; unsupported financial prose rejected; deadline; chat/question tsc/Vitest/Biome.
- Result: pending.
