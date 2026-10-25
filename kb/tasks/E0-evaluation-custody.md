# E0: sealed evaluation source custody
- **Goal:** assemble development packages and seal proposed test corpus without exposing test values to model selectors.
- **Folder:** data/evaluation only, including local scripts/provenance/.gitignore and this card Result. No model/evaluator/product implementation.
- **Contracts used:** current HistoricalSource/Fact patterns; L0 evaluation manifest when accepted. No shared contract edits.
- **Done when:** development package is audited, planned 16-pair coverage/availability is reported, raw/slice/label/protocol hashes and exposure/read ledger committed BEFORE test release; no test values/errors in Result/logs/prompts.
- **Notes:** follow ../spec/forecast-evaluation-protocol-v1.md exactly. Verify metadata from original SEC accessions. No test source/label bytes in Git or broad worker-readable logs before candidate seal. Only custodian reads sealed values. Procedural isolation is disclosed.
- **Mapping acceptance:** package exposed Freshworks 2023Q3 separately; release it to L1 only after Amplitude-developed normalizer/dictionary commit freezes. Never use test cohort for product acceptance. Coverage may block; do not fabricate inputs.
- **Limits:** public SEC only or authorized local package, no keys/paid APIs. At most 80 requests total, <=1/sec, two bounded retries per GET included in cap. Stop on access/coverage/exposure failure; do not select replacement companies. No nested workers. Verify actual slots first.
## Result
- Pending human launch; hashes/coverage are not yet known.
