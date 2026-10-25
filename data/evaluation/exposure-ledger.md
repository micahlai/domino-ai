# Evaluation exposure ledger (protocol v1)

Protocol: kb/spec/forecast-evaluation-protocol-v1.md, sha256 41344e7a724a4777b05616794488484655fd4ea2d1052c01bf0bc14729025e3f (commit 1fce04a).

## Cohort status

| Company | Status | Reason |
| --- | --- | --- |
| 2U, Amplitude, PagerDuty, Box, Freshworks, Sprout Social | EXPOSED / development | Used in earlier calibration or seen by the lead (protocol v1). Amplitude 2021-2022 development, 2023 validation. |
| Tenable (CIK 0001660280, TENB) | proposed test, sealed | No values found in tracked files (search below). |
| Varonis (CIK 0001361113, VRNS) | proposed test, sealed | No values found in tracked files (search below). |

## Tracked-repo search (2026-10-24, branch E0-evaluation-custody at 16a3a56)

Command: `git grep -n -i -I -E "tenable|varonis|\bTENB\b|\bVRNS\b|1660280|1361113"` over all tracked files.
Every hit is planning text naming the proposed cohort. None contains a monetary value, label, error or payload excerpt:

- HANDOFF.md:11, kb/decisions.md:5, kb/coordination/historical/team-checkpoint.md:11, kb/reviews/lead-takeover-2026-10-24.md:11 ("No Tenable/Varonis cash values fetched by the lead"), kb/spec/forecast-evaluation-protocol-v1.md:8, kb/spec/learning-loop-design-2026-10-24.md:55, prompts/shared/E0-sealed-evaluation.md:9, docs/architecture/diagram.py:91 (diagram label).
- No hits under data/ or packages/.

Limits: this checks the tracked repo only. It cannot rule out prior human or model knowledge of these public filings, untracked files, other checkouts or chat history.

## Sealed reads

Every read of data/evaluation/sealed/ is appended to read-ledger.jsonl (time, reader, file, purpose). Through this commit only the E0 custodian read sealed files, to verify identity, filing metadata, coverage and build slices/labels. No test amounts, labels or errors were returned to the lead or any model worker. Isolation is procedural (shared filesystem), not an enforced security boundary.

## Network

request-log.jsonl records every SEC GET attempt (URL, status, bytes, sha256). Public SEC endpoints only, user agent `domino-evaluation-custody (hackathon research)` with no contact identity.
