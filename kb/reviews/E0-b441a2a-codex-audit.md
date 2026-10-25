# E0 audit of b441a2a by Codex CLI 0.159.2 (codex exec, read-only sandbox, independent of the implementer), 2026-10-24

REJECT

1. **High: original-accession selection is not enforced.** [build.py:119](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-E0/data/evaluation/build.py:119) calls `pick` without pinning required inputs to their original accession. Synthetic probes confirmed that later comparatives and amendment rows can replace missing originals while the pair remains eligible. This violates the protocol.

2. **Medium: target acceptance instants are omitted.** [build.py:145](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-E0/data/evaluation/build.py:145) records only a presence flag. The protocol requires the actual acceptance instants in E0 metadata.

3. **Medium: sealed-read logging is incomplete.** [build.py:44](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-E0/data/evaluation/build.py:44) reads bytes for hashing without calling `log_read`. Raw-package and generated-file hashing therefore bypass the ledger, contradicting its completeness claim.

4. **Medium: required mapping package is missing.** [E0-evaluation-custody.md:17](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-E0/kb/tasks/E0-evaluation-custody.md:17) acknowledges that the Freshworks acceptance package required by the task card was not built.

5. **Low: quarter-boundary enforcement is inclusive.** [build.py:107](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-E0/data/evaluation/build.py:107) compares dates inclusively. A synthetic origin exactly at quarter start passes. The committed test-origin metadata does fall strictly inside its target quarters.

Checks run:

- Reviewed full `git diff 16a3a56..HEAD`, both commits, scripts, manifests, ledgers and development payloads.
- Found no committed test monetary values, labels or raw payloads. Neither commit tracks sealed payloads.
- Verified the committed ignore rule excludes everything except `.gitignore`.
- Recomputed protocol, manifest and all committed development hashes. Development slices and labels reproduced byte for byte in memory.
- Confirmed development payloads contain only Amplitude data.
- Checked six logged SEC requests: no retries, below the cap, minimum logged spacing approximately 1.298 seconds. Serial fetch logic enforces the delay.
- Confirmed current-companyfacts and missing-original-filing limitations are disclosed honestly. That disclosure does not resolve finding 1.
- Python syntax checks and `git diff --check` passed.

No sealed payloads were opened, no network requests were made, and the worktree remained unchanged. Sealed hashes and original-source contents remain independently unverified under the custody restriction.