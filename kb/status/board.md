# Status board

Update your rows at the start and end of every task. Status: `todo`, `doing`, `review`, `done`, `blocked`.
Prompts are in `prompts/`. Gates are in `kb/spec/build-spec.md` §11.

## Engine (Jayden)

| ID | Task | Prompt | Depends on | Status | Branch | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Machine setup | `prompts/shared/00-setup.md` | — | doing | main | install + check pass; `.env.local` missing |
| E1 | Simulator: Kestrel + EDGAR calibration + `sim:print` | `prompts/engine/E1-simulator.md` | S0 | todo | | |
| E2 | Mock servers (Stripe, CRM, cards, books, payroll, docs) + Nessie seeding + `pnpm seed` | `prompts/engine/E2-mocks-and-seed.md` | E1 | todo | | |
| E3 | Engine: forecast, changes, dominoes | `prompts/engine/E3-forecast-dominoes.md` | S0 | todo | | Can run in parallel with E1 |
| E4 | Engine: risks, fix scoring, history, stress test | `prompts/engine/E4-multiverse.md` | E3 | todo | | Powers the hero visual |
| E5 | Connectors + tie-out (Convex actions) | `prompts/engine/E5-connectors.md` | E2, P2 | todo | | |
| E6 | Agents: CREAO + Claude adapters | `prompts/engine/E6-agents.md` | S0 | todo | | Can run in parallel |
| E7 | Wire actions: connect.run, recompute, week.advance; grade + learn | `prompts/engine/E7-wiring-learning.md` | E4, E5, E6 | todo | | |
| E8 | Held-out companies + proof numbers | `prompts/engine/E8-proof.md` | E7 | todo | | |

## Product (Micah)

| ID | Task | Prompt | Depends on | Status | Branch | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Product machine setup | `prompts/shared/00-setup.md` | — | review | main | CREAO local setup complete: all five .env fields, three private agents, API mock runs and checks pass; other service access remains unverified |
| P1 | Web shell + playground | `prompts/product/P1-web-shell.md` | S0 | done | codex/p1-web-shell | Seven routes, fixture previews, local Convex, checks/build/browser pass |
| P2 | Convex schema, queries, mutations, fixture seed | `prompts/product/P2-convex.md` | P1 | done | codex/p2-convex | 14 tables/queries, 5 mutations; seed and live queries verified; 56 tests/check/build pass |
| P3 | Multiverse timeline (hero) | `prompts/product/P3-multiverse-timeline.md` | P1 | done | codex/p3-multiverse | SVG fan, stable fix morph, selection and keyboard access; desktop/mobile verified |
| P4 | Main screen: resilience bar, risks, chain, fixes, proof | `prompts/product/P4-main-screen.md` | P2, P3 | done | codex/p4-main-screen | Live subscriptions, exact branch selection, proof and confirmed approval; 67 tests/check and browser pass |
| P5 | Branch detail, connect screen, add event, next week | `prompts/product/P5-flows.md` | P4 | review | codex/p5-p6-flows | UI/data flows verified; E5/E7 services and credit-limit Change still required for complete demo |
| P6 | Learning + record screens; taste pass | `prompts/product/P6-learning-record-polish.md` | P5 | done | codex/p5-p6-flows | Learning/records, validated brief storage/toast, R fallback, phone polish; 82 tests/build pass |
| P7 | Usability test and demo materials | `prompts/product/P7-user-test.md` | P6 | todo | | |
| P8 | Demo video and submission | `prompts/product/P8-submission.md` | E8, P7 | todo | | |
| T1 | Dark palette and original Domino logo | User request | P1 | done | codex/dark-theme | Shared tokens, header mark and favicon; checks/build/screenshot pass |

| C1 | Plain financial timeline copy | User request | P4 | done | codex/plain-timeline-copy | Forecast/scenario language, requirement outcomes and explicit preview copy; checks/browser pass |

| V1 | Timeline particle experiment | User request | P3 | done | codex/timeline-particles | Full-line probability-weighted emission; 72 tests/build pass; browser checked |
| V2 | Timeline date/value inspection | User request | V1 | done | codex/timeline-particles | Selected-scenario guides only inside plot; weekly values, keyboard/touch; 75 tests/build pass |

## Shared

| ID | Task | Prompt | When |
| --- | --- | --- | --- |
| G | Gate check | `prompts/shared/99-gate-check.md` | At every gate |
