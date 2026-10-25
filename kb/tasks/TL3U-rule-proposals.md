# TL3U: confirm rule-only prompts and align question receipts

- **Goal:** a confirmed question containing only rules saves a rule revision; combined event/rules remain one scenario; real backend failure/method states read plainly.
- **Folder:** apps/web/components/timeline/workspace ONLY plus this Result; worktree ../domino-TL2U on TL2-timeline-screen.
- **Contracts used:** frozen local QuestionReceipt/WorkspaceRun, unchanged reviseConstraints/simulate/link signatures.
- **Done when:** tests cover rule-only proposal selecting reviseConstraints (not empty simulate), combined event/rules selecting simulate, missing/empty proposal refusing, stable retries and exact link; backend uppercase failure codes and operation method title are displayed. Focused tests/typecheck/lint pass; commit SHA.
- **Notes:** root combined e85c57f includes originalUI+R1+d8b18a8 phone fix. Existing WorkspaceLive.confirmProposal always calls simulate, which rejects empty changes and breaks pure constraint prompts. Route rule-only full set/note through existing reviseRules mutation path without navigating; then exact link/recovery identical. Keep data flow/UI plain, no backend/shared/dashboard/styles/env/services/provider calls. User authorizes Codex parallel throughTL5. No delegation/push/main. Root handles actual browser confirmation test.

## Result
- Done:
- What changed:
- Watch out:
