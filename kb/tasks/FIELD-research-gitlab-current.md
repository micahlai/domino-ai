# FIELD research gitlab-current
- Goal: latest verified current-company filing inputs, as of2026-10-25.
- Own: kb/features/field/research/gitlab-current/; this task Result only.
- Read: AGENTS.md, CURRENT-FILINGS-CONTRACT.md, prior research template.
- Deliver: Latest GitLab source proof, exact quarter/YTD anchors, cash/restricted basis, AR/deferred endpoints, disclosed cash-flow components, original strings and citations; valid formatted JSON.
- No: source implementation, providers, protected2U files, main, live runtime, root handoff.
- Check: parse JSON, primary-source values/units/periods, latest eligibility proof.
- Result: done. Added `kb/features/field/research/gitlab-current/anchors.json` and `research.md` from GitLab's FY2027 Q2 and prior Q1 SEC 10-Qs, plus the September 1, 2026 earnings release. Q2 filing date September 2; as-of cutoff October 25. Anchors include exact USD-thousands balance-sheet endpoints, quarter income and stock compensation, comparable six-month and three-month cash-flow totals and disclosed components. Restricted cash is unreported, not a verified zero. Q1/Q2 cash-tax scopes are recorded separately. JSON parse, Biome check and a code-based quarter cash reconciliation to both reported endpoints pass. No implementation code or live runtime changed.
