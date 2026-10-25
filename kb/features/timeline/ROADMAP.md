# Timeline and Simulations roadmap

Owner: friend and their feature lead. Outcome/acceptance: [BRIEF.md](BRIEF.md). This is a full UI/backend feature; owner may reorder internal work and keep steering their agent.

| Milestone | Status | Acceptance |
| --- | --- | --- |
| Shared P0 base | Blocked: C repair, S/H acceptance | Preview a1b9341 has lane docs. P0-C 189fb0d rejected; no accepted exact base/fixture hashes. S2 state and bounded P0-S index handoff recorded in HANDOFF.md |
| Frozen snapshot -> saved baseline | Planned | Real validated import, hash/cutoff checks, immutable engine result and source inspection |
| Event -> costed Response | Planned | Engine-computed scenario, durable lineage, feasibility/cost/range/post-hoc labels |
| Reveal -> compare | Planned | Separate later outcomes, period-matched comparison, old forecast unchanged |
| Catalog -> quiet reopen | Planned | Saved baseline/scenarios/reveal survive reload without rerunning or leaking ownership |
| Feature demo/acceptance | Planned | Real local backend, failures/retries/reopen, checks/build/browser and unchanged seam fixtures |
| Later joint integration | Separate gate | Real Field export -> Timeline import -> saved result link with both latest features |

Accepted chart/historical backend/S3 code is reusable foundation, not evidence these new milestones are complete. Current S2 activity must be checked, not overwritten. Keep branch/base/checks/next step in a feature-local HANDOFF.md when implementation starts; breaking shared requests go in boundary-requests.md. No long-lived feature branch or worker was launched by this planning update.

## 2026-10-24 verified intake

- Temporary documentation checkpoint: `codex/timeline-p0-checkpoint`, based on exact `a1b9341`; not the long-lived feature branch.
- S2 remains `1154972c`, pending with no fetched catalog code or index. No local S2 writer found. Single index ownership is released to the existing P0-S assignment under independent audit; catalog remains Timeline-owned.
- Read [HANDOFF.md](HANDOFF.md) for preservation/evidence and [boundary-requests.md](boundary-requests.md) for the exact readiness gates. No feature milestone, test/build/browser or database acceptance is claimed by this intake.
