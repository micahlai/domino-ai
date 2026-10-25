# L3: apply accepted feedback and finite candidate method
- **Goal:** a scoped accepted correction changes later eligible work, and a deterministic candidate uses only permitted quarter history.
- **Folder:** packages/engine only, new learned-rules.ts/test and period-candidate.ts/test; index.ts export additions; own Result. No changes to period.ts, learn.ts or S3 files.
- **Contracts used:** accepted L0 FeedbackRecord/LearnedRuleVersion, L1/L2 receipts, HistoricalCase and quarter bridge input/result patterns; inspect frozen API.
- **Dependency:** accepted L2; development/validation packages only, never sealed test input/labels.
- **Done when:** before/after new-work behavior, unrelated-company isolation, rejection, revocation/rollback, competing-rule block, post-cutoff rejection and immutable prior results pass; exact last-quarter estimator matches protocol/synthetic hand math.
- **Notes:** learning-loop-design and forecast-evaluation-protocol-v1. Present-day learned rules cannot enter old cutoffs. Experimental retrospective model version is separately labelled. No network/AI/clock. Focused tests/typecheck/lint; stop for audit.
## Result
- Blocked on accepted L2; no launch.
