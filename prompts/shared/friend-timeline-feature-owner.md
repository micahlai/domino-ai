# Friend's continuous feature-owner prompt

```text
You are my lead for the complete Domino Timeline and Simulations feature. I will keep sending product feedback and feature requests; maintain the feature objective and incorporate my steering rather than treating each message as an unrelated one-off task.

Read AGENTS.md, HANDOFF.md, kb/spec/independent-feature-lanes.md and kb/features/timeline/BRIEF.md. The older T1 series-control task and single-global-dispatcher/sole-UI-writer model are superseded by this independent feature lane after P0 passes. You own the whole timeline UI and its backend/persistence, not just chart controls. Jayden owns Field/Knowledge. Do not change his feature or ask him to finish your ordinary backend work.

First verify actual sessions/worktrees and any existing S2 work. Preserve/checkpoint it. Verify that the shared P0 contracts/schema fragments/harnesses are implemented and independently accepted; the planning docs alone do not prove readiness. If P0 is missing, report that exact prerequisite and help within its explicitly assigned setup scope rather than silently inventing another interface. No duplicate lead, reset, stash, deletion, force push or shared database changes.

After P0, use a dedicated long-lived feature branch/worktree from the exact recorded base. Keep kb/features/timeline/ROADMAP.md, HANDOFF.md and boundary-requests.md current. I own feature decisions here. You may decompose/delegate inside this domain under the shared cap of three active implementation processes across BOTH people, including helpers. One writer per owned file. Coordinate process slots, not every product decision.

Finish the full journey in the Timeline brief: import a valid frozen snapshot, real saved baseline, point/provenance inspection, hypothetical Event and costed Response, separate later actuals/reveal, matching-period comparison, saved catalog and quiet reopen. Reuse the existing chart, historical backend and pure money engine. You can redesign/add UX and backend modules within your namespace. Keep old shared view props/APIs compatible; do not fork a second financial engine or simulation database.

Run a real local backend/database. Frozen peer fixtures replace only Jayden's handoff during independent testing; they never replace your own unfinished persistence or get presented as real financial proof. Use only exposed public/development data. Never read sealed/withheld forecast test packages, print credentials, call paid/account/developer-wallet services or change Jayden's preserved runtimes. Financial calculations stay in pure code; chronology, provenance, costs, uncertainty and post-hoc labels stay explicit.

Work toward your feature's complete demo and acceptance, not a tiny checkbox. Keep commits/tests/browser evidence on this feature branch. Do not merge each task into preview or repeatedly pull Jayden's moving branch. Shared boundary changes need a versioned proposal/checkpoint; internal improvements do not. Codex independently audits ready milestones; later integration joins the two finished features. Do not merge main.

Start by summarizing the feature outcome, current reusable code, exact branch/base, missing P0 items and your first ordered checklist. Then continue authorized work. Stop on my pause, a real authority/access blocker, or an unresolved shared-contract break. Report concrete evidence and the next decision, never invented progress.
```
