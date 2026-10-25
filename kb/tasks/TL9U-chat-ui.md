# TL9U: conversational timeline rule/scenario editor

- **Goal:** chat transcript and short replies, source context, clear review/save and saved conversation/result links.
- **Folder:** apps/web ONLY: components/timeline/chat/*, app/c/[companyId]/timeline/chat/*, app/playground/timeline-chat/*, minimal Playground and WorkspaceView links; this Result.
- **Contracts used:** Forecast, Change, Constraint, existing QuestionProposal, WorkspaceRun; shared types unchanged.
- **Done when:** exact wire/limits/semantics in kb/features/timeline/TL9-chat-interface.md; meaningful fixture tests, pnpm check and relevant typecheck/build; commit.
- **Notes:** Codex authorized; own supplied worktree. Read interface fully, skills/ui-build or review, nested AGENTS and installed guidance. No services/env/provider/shared contracts/engine/root-schema/dashboard/Field/main/push/TL7 edits; no delegation. All missing values remain user-supplied; no transcript-concatenation guess. Lead handles separate3109/3260 browser/runtime verification. Report interface blocker early.

## Result
- Done: separate chat route and labelled props playground; 21 focused UI boundary/request/render tests, web TypeScript check and scoped Biome lint pass. Lead runs combined checks/build and live desktop/mobile acceptance after backend integration.
- What changed: durable conversation reads, explicit start, alternating transcript and short replies, source chart with working selection, complete rule/event review, revision-bound confirmation, saved result/recent-chat links. Strict receipt/source parser accepts raw invoice/bill/payroll and mapped scheduled IDs plus historical/forecast weeks. Lost replies retain their exact request/payload even if live state advances; delayed navigation cannot switch another source screen.
- Watch out: supported grammar is stated in UI; no provider/general dialogue claim. Published TL7 and its preview remain untouched. No auto-start or calculation on reading the page. Source-only rule sets are displayed in full during cash-event review. Separate live backend/runtime verification remains lead-owned.
