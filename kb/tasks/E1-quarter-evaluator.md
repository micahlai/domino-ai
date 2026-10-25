# E1: paired quarterly evaluator, no test release
- **Goal:** frozen baseline/candidate produce an honest paired report on development/synthetic data with test leakage prevented.
- **Folder:** packages/sim/eval only and own Result. No engine/model changes, sealed-data reads or product/answer-key imports from runtime code.
- **Contracts used:** accepted L0 EvaluationProtocol/Seal/Report and accepted L3 pure candidate API; baseline quarterBridge and compareRun semantics.
- **Dependency:** accepted L0/L3 and E0 DEVELOPMENT interface. Evaluator may be designed earlier but no dispatch until interfaces freeze.
- **Done when:** synthetic signed/absolute error, exact 5% inequality, per-company non-regression, >=9 strict wins, zero baseline, 16-pair minimum, failed/missing rows, time/source leakage and prediction-before-label tests pass. Development report shows every planned row.
- **Notes:** forecast-evaluation-protocol-v1. No test data until E2 sealed release, no web/LLM/network, no metric/model/cohort adjustment. Focused tests/typecheck/lint; return exact run command and seal fields to Codex.
## Result
- Blocked on frozen interfaces; evaluator working alone cannot pass L4.
