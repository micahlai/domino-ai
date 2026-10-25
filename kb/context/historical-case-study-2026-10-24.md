# Historical case study: user scope, 2026-10-24

This scope supersedes the unattended backend-completion plan. Company selection remains pending. The implementation plan is in ../spec/historical-case-study-plan.md.

- Replay a real public company's documented financial deterioration. Test warnings against information available at the time, then simulate whether alternative decisions could have helped.
- Investigate 2U and alternatives with public financial history and meaningful model fit. Amplitude was an earlier calibration idea, not a selected distress case. Planning must not wait for a final company choice.
- Flow: load disclosures available at a chosen date, produce and save a forecast/risk assessment, reveal later reported outcomes, compare actual results with the saved forecast, then simulate alternative decisions with explicit costs and assumptions.
- Distinguish reported facts, synthetic operational details and counterfactual assumptions. Use publication dates to prevent future-data leakage. Validate at the frequency public data supports. Reconstructed weekly values are not actual history. Do not claim Domino could have prevented bankruptcy.
- Preserve the financial timeline as a readable chart, not an infinite canvas. Progressively reveal baseline, event and response branches with dates, labels, evidence and financial tradeoffs. Distinguish projected outcomes from observed results.
- A separate, later agent page may pan and zoom across Domino, specialist agents, tools, sources and company knowledge. Node details show evidence, task status and outputs. Animate actual operations and keep a persistent conversation panel. This must not block the core demo.
- Preserve existing UI and P5's E5/E7 dependencies. Reuse components/interfaces where practical. Reassess simulated Next week against historical replay.
- Prioritize one defensible historical case and one complete journey. Defer arbitrary tool generation, unlimited agents and broad disaster scenarios. Keep hypothetical scenario testing separate from injecting events into a simulated world.
- Finish and audit already-running tasks to a safe checkpoint. Recommend the smallest revised plan and counterargument before further implementation dispatch. Subsequent integration belongs in a dedicated branch/worktree and must be reviewable before merging into main.

Execution boundary: integration/historical-case-study in ../domino-case-study, based on main 694ab2a. Preserve existing branches, worktrees and local changes. No further implementation dispatch, merge into main, push or deployment is part of this assessment.
