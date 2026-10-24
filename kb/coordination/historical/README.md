# Historical run coordination

- H0 Claude lead owns orchestrator.md on claude/historical-orchestrator, then overnight-result.md and root HANDOFF.md on preview/historical-overnight only.
- H1 evidence owns its data/research files and card Result on H1-historical-evidence.
- H2 backend owns contract-v1.md plus its cards and code in sequential phases on H2-historical-backend.
- H3 UI owns ui-status.md plus its card/UI files on H3-historical-ui, in its own worktree on this computer.
- Codex owns the shared integration branch, status board and kb/handoffs.md. Do not write those from worker branches.
- Subagent messages and exact local commit SHAs coordinate this single-computer run. Inspect committed packets with git show. Normal pushes preserve checkpoints for review; no worker may edit a sibling checkout.
- Contract packet states: proposed, frozen (schema tests pass, exact contract SHA), API-ready (actual implemented endpoints/tests/bindings and an immutable code SHA containing the complete dependency closure). UI can build previews immediately, adopt frozen dependencies for typing, and wire only after adopting the full API-ready dependency closure. Frozen packets label unimplemented API signatures as proposed.
- A complete checkpoint records commit SHA, input/source version, tests and next step. No status file is proof without the corresponding checked artifact.
- The coordinator serializes installs/full checks/builds/browser verification and owns one preview server. All names are reservations, not claims that workers or branches have launched. If a name is already owned by unrelated work, preserve it and publish the chosen suffix through the coordinator.
