# Historical run coordination

- Current run: C0 Codex supervisor owns active-run.md, shared handoff/board, audits and preview assembly. Direct Claude workers implement one bounded phase and commit locally. H0 manual orchestration is inactive and must not run alongside C0.
- H1 evidence owns its data/research files and card Result on H1-historical-evidence.
- H2 backend owns contract-v1.md plus its cards and code in sequential phases on H2-historical-backend.
- H3 UI owns ui-status.md plus its card/UI files on H3-historical-ui, in its own worktree on this computer.
- H4 succeeds H3 in the UI slot on H4-ui-styles-motion, based on the checked H3 SHA; owns its UI changes, card Result and ui-styles-result.md. No concurrent H3/H4 edits. H2d adds real activity on the backend branch and publishes an additive readiness packet.
- Codex owns the shared integration branch, status board and kb/handoffs.md. Do not write those from worker branches.
- Subagent messages and exact local commit SHAs coordinate this single-computer run. Inspect committed packets with git show. Codex publishes accepted/checkpoint branches for review; no worker may edit a sibling checkout.
- Contract packet states: proposed, frozen (schema tests pass, exact contract SHA), API-ready (actual implemented endpoints/tests/bindings and an immutable code SHA containing the complete dependency closure). UI can build previews immediately, adopt frozen dependencies for typing, and wire only after adopting the full API-ready dependency closure. Frozen packets label unimplemented API signatures as proposed.
- A complete checkpoint records commit SHA, input/source version, tests and next step. No status file is proof without the corresponding checked artifact.
- The coordinator serializes installs/full checks/builds/browser verification and owns one preview server. The active-run.md record distinguishes launched workers from later reserved branches. If a name is already owned by unrelated work, preserve it and publish the chosen suffix through the coordinator.
