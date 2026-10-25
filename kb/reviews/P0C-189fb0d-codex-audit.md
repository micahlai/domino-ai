# P0-C 189fb0d Codex audit (round 1)

Reviewer: Codex CLI 0.159.2, read-only, session 01a170d9-70b7-7642-ab7c-82f242ac0d80. Finding 4 (method equality test) assigned to P0-H.

**REJECT** commit `189fb0d` for freezing before the long fork. Existing checks pass, but independent probes found contract gaps.

1. **P1: Forecast-ready accepts invalid method chronology.** At [feature-boundary.ts:365](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:365), selected financing/FX assumptions are checked for existence and units, but not interval coverage. At [feature-boundary.ts:402](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:402), YTD starts need only match each other. With all hashes recomputed, seeds pass with a `2023-01-02` YTD start, a 21-month YTD period, or financing/FX beginning after the target. The pinned engine rejects all four. Engine rejection contains the failure, but leaves the frozen “forecast-ready” promise inconsistent across lanes.

2. **P2: The documented numeric domain is unenforced.** [feature-boundary.ts:69](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:69) says contract numbers are safe integers. Seeds nevertheless accept `9007199254740992` in `benefitLagDays` and learned-rule `version`. Canonicalization follows ECMAScript correctly, including rounding the literal `9007199254740993` to `9007199254740992`. Enforce the promised numeric bounds at this boundary before freezing them.

3. **P2: OperationSummary is not fully bounded.** [feature-boundary.ts:530](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:530) permits unlimited case-item IDs; [feature-boundary.ts:174](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:174) permits unlimited domain-kind length. Independent probes accepted a million-character reference through each path. Bound both.

4. **P2, fork-gate follow-up: Method drift has no regression guard.** [feature-boundary.ts:203](/Users/jaydenl/Dev/Hackathon/CalHacks%2026/domino-P0C/packages/contracts/src/feature-boundary.ts:203) describes a consumer equality test, but none exists. Independent comparison confirms both currently pin `quarterly_cash_bridge@0.1.0`. Assign the equality test to P0-H; contracts need not import engine.

Worker-decision rulings:

| Decision | Ruling |
|---|---|
| (1) Seed equals its parse, including explicit defaults | Accept. Prevents silent stripping/default insertion from changing hashed content. |
| (2) Namespaced IDs reject bare Convex IDs | Accept. Proves syntax, not provenance or existence. |
| (3) Boundary/hash/snapshot/method pins | Accept. No invented 2U protocol version. |
| (4) Added `TimelineRevealV1` | Accept. Keeps later disclosures separate and context-checkable. |
| (5) Synthetic blocked seed | Accept. Clearly labelled; blocked required role cannot pass ForecastReady. |
| (6) Fixture-index export | Accept. Within authorized contracts scope. |

Verification:

- **396/396 contracts tests**, nine files, including 58 new tests.
- **4/4 typechecks:** contracts, engine, agents, web.
- **Biome:** 32 files clean. Diff whitespace check clean.
- **100 independent sanity/edge checks passed; eight targeted rejection gaps reproduced.**
- **40 Python hash/data assertions passed:** five fixture digests, three seed digests, three snapshot digests, both exposed raw-source hashes, and copied 2U records.
- Canonical edge checks passed for UTF-16 key ordering, Unicode/surrogates, number formatting, nested undefined, negative zero, large integers and unsupported values.
- Closure, cutoff, company linkage, required-role blocking, pins, explicit post-hoc taint, post-reveal exclusion, result linkage and unknown-payload rejection passed.
- The assembled 2U fixture matches existing public records and all four baseline/nowcast protocol amounts. Existing schema files are unchanged.

[Reproduction evidence](/tmp/domino-p0c-audit.vPo72f/gap-results.json). Repository unchanged. No network, sealed/withheld access, or evaluation-cohort data used.

Actual Field export and joined feature execution remain unverified; those belong to P0-H and final integration.