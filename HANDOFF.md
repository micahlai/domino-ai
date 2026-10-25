# Domino handoff

> Latest scope: onboarding, source reconciliation, feedback learning and measured forecast improvement are mandatory. Read `kb/spec/required-learning-loop-2026-10-24.md` from the repo root. Earlier deferrals and the smaller planned-demo diagram are superseded. User still launches Claude manually. Monitor was observed PAUSED during chat handoff; do not assume it is active.

- Goal: one historical company Workspace / Company / Simulations product. Current team agreement: kb/coordination/historical/team-checkpoint.md. Product scope: kb/spec/product-workspace-2026-10-24.md.
- Accepted: G6/G7/G8a/G8/S1/U1. Last feature checkpoint 0f87ed2 passed 1,185 tests, typecheck, lint, build and browser checks. Stable preview is http://127.0.0.1:3102/case/2u.
- Integration: preview/historical-overnight only. Main remains 694ab2a. Fresh fetch found no new remote main or S2 implementation commits to integrate.
- S3: Claude finished 38297d4; PID 7799 exited. Independent audit blocks acceptance because actual saved 2U baseline includes AS-RESTRICTED and the new engine rejects it. 50 focused tests pass; real persisted-shape probe fails. Manual repair prompt: prompts/shared/S3-local-repair.md. No new local implementation worker launched.
- Friend: exclusively owns S2-simulation-catalog, remote 1154972, no implementation pushed at last fetch. Prompt: prompts/shared/S2-friend-catalog.md. Preserve an existing session; never duplicate locally.
- Next: user launches Claude; Codex audits S3 repair and S2. Then audit exact S4 persistence design, including frozen response evidence and protocol post-hoc taint. S4 implementation and U2 UI remain gated.
- CREAO: dedicated evidence app d949f966-355f-469e-b227-4e72066be8bc exists, zero runs observed, empty app memory/connectors. Full instructions, visibility and account/team inheritance remain unverified. Gate OFF; old app-scoped API only.
- Monitor stays active for audits/coordination, with a report after every run. User now launches implementation manually. Preserve backend 3214/3210 data, unrelated processes and secrets. Exact runtime ownership in active-run.md. No Git reset, deletion, rebase or force push.

- Team reset deliverable: kb/product/team-reset-2026-10-24.md explains the product, current features, ordered roadmap and official Hyphenate criteria with honest gaps. docs/architecture/diagram.py generates current/planned PNG and PDF diagrams. Old Kestrel product/proof/demo docs are marked superseded. No feature code or implementation launch in this documentation turn.
