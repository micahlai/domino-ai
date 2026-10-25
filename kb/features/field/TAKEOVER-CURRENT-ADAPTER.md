# Current-company adapter handoff, 2026-10-25

- Goal: expose historical 2U and current Asana/GitLab based companies as the three primary Field choices while preserving both 2023 legacy worlds and their Timeline books.
- Checkout: `domino-field-operating-ui`, branch `field/current-company-adapter`, based on `6e9309f`.
- Changed: Field selector, source strip, playground wording, AppShell legacy route guard, Convex optional company enum and ensure validator, and focused tests. The five supported company IDs remain valid for backend feeds. Only the three primary IDs resolve as a current picker choice. Legacy Timeline paths show their original books without current source banner or automatic feed setup.
- Verification: changed-file Biome and `git diff --check` pass with Node 24. Focused web tests and typecheck are pending the separate sim implementation of `OPERATING_PRIMARY_COMPANY_IDS`, `simulationAsOf`, `filedAt` and `currentLedger`. No protected runtime was started or changed.
- Next exact step: integrate the sim branch in the Field integration checkout, run focused selection, source, route, Convex ensure and six-mock roundtrip tests, then web typecheck and changed-file Biome. Check current world IDs and dated source blurbs in a safe preview before promoting.
- Open question: none on API shape. The sim owner confirmed the additive exports and provenance fields in the current filing contract.
