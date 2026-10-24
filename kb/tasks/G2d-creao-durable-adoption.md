# G2d: connect app-scoped CREAO to durable specialist operations

- **Goal:** default CREAO mode dispatches the accepted historical adapter exactly once, persists actual remote identity before polling, validates output and truthfully records uncertainty.
- **Owner/files:** apps/web/convex/investigation.ts, investigation tests, narrow optional operation fields in schema.ts if required, generated bindings if required; kb/coordination/historical/investigation-api.md and this Result only. No UI/package/contracts edits.
- **Dependencies:** G2b7801fb5 + G2cabb6d07. Read both API packets and kb/spec/creao-canvas-cycle.md. Reuse runCreaoHistoricalSpecialist and existing durable operation lifecycle.
- **Rules:** only app-scoped role credentials, no account/developer key or fallback. Missing config fails with no call. Require explicit server-side historical-profile verification gate defaultoff until Codex verifies dedicated remote app instruction/memory compatibility; fail honestly while off. Do not manufacture verification.
- **Profiles:** snapshot exact safe app-authored rules for actual provider/version, distinguish supplied per-run rules from unknown remote system instructions. Freeze mode/profile before dispatch and reject drift before call. Remote id/status persisted by onRunCreated with owner/lease/running guard, no public write endpoint; no polling if persistence fails. Unknown model/usage omitted, never invented.
- **Failures:** lease bounds encompass provider deadline. One create maximum, no retries/resumes after uncertain create, callback or timeout. Record provider/run when observed without declaring success before validation. UI may expose coarse lifecycle only. Preserve all G2b isolation/ownership/frozen input guarantees.
- **Acceptance:** focused tests for missing gate/config zero calls, CREAO success without model/usage, identity persisted beforepoll, late callback/expiredlease cannot overwrite, uncertain create/record/deadline no retry, unchanged explicit claude-dev behavior. Offline mocks only. Codex independently audits/fullchecks/runtime and actual CREAO configuration/call later.
- **Skills/budget:** /orchestrator /ponytail full. One Opus/high process, nochildren,45min boundedcheckpoint. No fullsuite/build/server/livecalls/secrets/cloud/push/merge/sharednotes. Other workers ownUI; preserve their work. No main.

## Result
- Pending.
