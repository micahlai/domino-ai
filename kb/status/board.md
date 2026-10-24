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
| S0 | Product machine setup | `prompts/shared/00-setup.md` | — | review | codex/p1-web-shell | Local setup verified; team access and integration keys still need Micah |
| P1 | Web shell + playground | `prompts/product/P1-web-shell.md` | S0 | done | codex/p1-web-shell | Seven routes, fixture previews, local Convex, checks/build/browser pass |
| P2 | Convex schema, queries, mutations, fixture seed | `prompts/product/P2-convex.md` | P1 | done | codex/p2-convex | 14 tables/queries, 5 mutations; seed and live queries verified; 56 tests/check/build pass |
| P3 | Multiverse timeline (hero) | `prompts/product/P3-multiverse-timeline.md` | P1 | doing | codex/p3-multiverse | Interactive SVG and fix comparison in playground |
| P4 | Main screen: resilience bar, risks, chain, fixes, proof | `prompts/product/P4-main-screen.md` | P2, P3 | todo | | |
| P5 | Branch detail, connect screen, add event, next week | `prompts/product/P5-flows.md` | P4 | todo | | |
| P6 | Learning + record screens; taste pass | `prompts/product/P6-learning-record-polish.md` | P5 | todo | | |
| P7 | Usability test and demo materials | `prompts/product/P7-user-test.md` | P6 | todo | | |
| P8 | Demo video and submission | `prompts/product/P8-submission.md` | E8, P7 | todo | | |

| T1 | Dark palette and original Domino logo | User request | P1 | done | codex/dark-theme | Shared tokens, header mark and favicon; checks/build/screenshot pass |

## Shared

| ID | Task | Prompt | When |
| --- | --- | --- | --- |
| G | Gate check | `prompts/shared/99-gate-check.md` | At every gate |
