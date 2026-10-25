# L1 4d68acd Codex re-audit (round 2)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170c6-1915-7c93-8745-582a02677d8c.

**REJECT `4d68acd`.**

1. **High: submissions can change between hashing and parsing** at [source-normalization.ts:205](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-L1/packages/engine/src/source-normalization.ts:205>). Start `companySnapshot` with hashed `0630` submissions, then change them to `1231` before awaiting completion. Both mutating the bytes and replacing `source.submissions` produce a **complete snapshot and bridge**, despite the current bytes failing the package hash. Hashing checks the original bytes; parsing reads the changed bytes. Copy once with `Uint8Array.from`, then hash and parse that same private copy. [Independent probes](/tmp/domino-l1-audit-4d68acd.cjs).

The restricted-cash fix passes both row orders. The original fiscal sidecar forgery is also blocked, but finding 1 leaves calendar authentication bypassable.

**Sibling ruling:** a rejected sibling should not automatically block a uniquely validated component. It contributes no usable observation. Require exactly one validated row per component, the same filing/period, and exact reconciliation. Blanket blocking is more conservative, but lets unusable rows veto otherwise validated evidence. Multiple validated candidates should continue blocking.

Checks on Node 24.11.1:

- Engine: **238/238 tests passed**, including **37 normalization tests**, across **12 files**.
- Independent probes: **108 passed, 2 failed**. Both failures reproduce finding 1; all **75 prior probes pass**.
- Engine typecheck passed; Biome passed on **32 files**; diff whitespace check passed.
- No caller/export regression found. Buffer, offset views, BOM, Unicode, CRLF, malformed/empty submissions and CIK checks passed.

No network or sealed/withheld access. No tracked files changed. Broader application integration was not tested.