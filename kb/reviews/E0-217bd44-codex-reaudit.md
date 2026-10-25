# E0 re-audit of 217bd44 by Codex CLI 0.159.2 (codex exec, read-only, independent), 2026-10-24

**REJECT** for `217bd44`, reviewing `16a3a56..HEAD`. Two prior findings remain partly unresolved.

1. **High: missing acceptance still permits original-accession substitution.** [build.py:53](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-E0/data/evaluation/build.py:53>) sorts missing acceptance instants last. Synthetic probes confirmed that a later original filing can replace an earlier filing with unknown acceptance, leaving origin, predecessor, or target eligible. Preserve filing chronology and fail closed when the first original’s instant cannot be verified. The committed manifest has populated instants; this does not establish that its current pairs were substituted.

2. **Medium: historical custody logging remains incomplete.** [read-ledger.jsonl:3](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-E0/data/evaluation/read-ledger.jsonl:3>) retains the earlier builds without their raw, slice, and label hashing-read entries. Current helpers log correctly, but [exposure-ledger.md:26](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-E0/data/evaluation/exposure-ledger.md:26>) still claims every read is recorded. Append an explicitly retrospective accounting and disclose unknown details without inventing timestamps.

3. **Low: self-check covers only part of the repair.** [selfcheck.py:32](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-E0/data/evaluation/selfcheck.py:32>) exercises substitution, conflicts, and boundaries. Mutation checks confirmed it still passes when target timestamps, read logging, or mapping-package configuration are removed. Add synthetic coverage for those paths and finding 1.

Prior-finding status:

- **Accession pinning:** ordinary amendment/comparative substitution fixed; missing-acceptance bypass remains.
- **Acceptance instants:** actual timestamp fields now recorded. Source correctness remains independently unverified under custody restrictions.
- **Read logging:** current read/load/hash helpers fixed; historical ledger incomplete.
- **Freshworks mapping package:** referenced files exist, are nonempty and ignored; freeze-before-release instruction is documented. Contents and hashes were not independently verified.
- **Quarter boundary:** fixed; both boundary days excluded and exercised.

Checks run:

- `python3 -I data/evaluation/selfcheck.py`: passed.
- Independent synthetic builder, substitution, logging, and mutation probes.
- Protocol/manifest hashes and request-ledger consistency.
- Development slices and labels reproduced byte for byte; raw hashes matched.
- All three commits checked for scope and custody payload tracking. No committed test values found; development payloads identify only Amplitude.
- `git diff --check 16a3a56..HEAD`: passed.

No sealed or withheld payloads opened, no network requests made, and no files changed.