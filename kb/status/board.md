# Status board

## Current scope: historical case study, supervised overnight execution

Authoritative scope: `../context/historical-case-study-2026-10-24.md`. Assessed plan: `../spec/historical-case-study-plan.md`. Launch stages: `../spec/project-stages-2026-10-24.md`. Older rows below are implementation history, not a launch queue. Main is frozen at 694ab2a. Assessment and future integration use `integration/historical-case-study` in `../domino-case-study`.

| Work | Checkpoint | Decision |
| --- | --- | --- |
| Historical assessment | done | 2U cash-only subset accepted; debt claims excluded pending evidence |
| C0/H1/H2/H3/H4 overnight run | doing | Historical backend4795d51 accepted734tests and live checks; H4c core UI running; active-run.md owns current state |
| H4 visual styles/motion | doing | Presentation436878e accepted; H4c core live UI running against accepted H2c; activity wiring remains gated |
| H2d actual activity | done | Code6498b75 independently accepted; full backend4795d51 pushed;734tests/live checks pass, UI wiring pending |
| E3c ffeea88 | blocked | 657 tests pass, two independent money/date defects; no merge or repair dispatch |
| E2a 29de286 | blocked | 650 tests/typecheck/lint pass; pagination, payout and OpenAPI defects independently reproduced; parked |
| E1b repair 9ab358a | review | Independently approved checkpoint; 661 tests/typechecks/lint and sim:print pass; parked unmerged |
| P1-P4, I1/I3, particles/crosshair | preserved | Reuse timeline, selection, proof, risk/fix presentation |
| P5 | rescope | Connect/detail are stubs; preserve interfaces and E5/E7 dependencies; reveal disclosure replaces simulated Next week |
| I4, E2b, broad E5/E7, E8, agent canvas | deferred | No implementation launch under the old plan |


Update your rows at the start and end of every task. Status: `todo`, `doing`, `review`, `done`, `blocked`.
Prompts are in `prompts/`. Gates are in `kb/spec/build-spec.md` §11.

## Engine (Jayden)

| ID | Task | Prompt | Depends on | Status | Branch | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Machine setup | `prompts/shared/00-setup.md` | — | doing | main | Offline check gate verified with Node 24; credentials/accounts remain unverified |
| E1 | Simulator: Kestrel + EDGAR calibration + `sim:print` | `prompts/engine/E1-simulator.md` | S0 | doing | main | E1a merged at 5762475; later E1 slices remain open |
| E2 | Mock servers (Stripe, CRM, cards, books, payroll, docs) + Nessie seeding + `pnpm seed` | `prompts/engine/E2-mocks-and-seed.md` | E1 | todo | | |
| E3 | Engine: forecast, changes, dominoes | `prompts/engine/E3-forecast-dominoes.md` | S0 | done | main | E3a/C1 plus independently reviewed E3b aa1d876 integrated; combined 197 tests/check/build pass |
| E4 | Engine: risks, fix scoring, history, stress test | `kb/tasks/E4-multiverse.md` | E3b merged | done | main | Claude 2340ff8 + reviewed repair 87de4f6 integrated; combined 240 tests/check/build pass |
| E5 | Connectors + tie-out (Convex actions) | `prompts/engine/E5-connectors.md` | E2, P2 | todo | | |
| E6 | Agents: CREAO + Claude adapters | `prompts/engine/E6-agents.md` | S0 | doing | main | E6a merged at 63366ae; live adapters remain open |
| E7 | Wire actions: connect.run, recompute, week.advance; grade + learn | `prompts/engine/E7-wiring-learning.md` | E4, E5, E6 | todo | | |
| E8 | Held-out companies + proof numbers | `prompts/engine/E8-proof.md` | E7 | todo | | |

### First slices

Plan: `kb/tasks/launch-plan-2026-10-24.md`. These slices need the verified offline S0 gate, not live credentials.
E1 and E6 follow-up slices remain open. E3a, C1 and independently reviewed E3b aa1d876 are integrated with P3/P4 and I1. E4 87de4f6 is also independently reviewed and integrated; combined checks pass 240 tests, five typechecks, lint and a fresh production build. No engine writer is active.

| ID | Task card | Dependency | Status | Reserved branch | Worktree |
| --- | --- | --- | --- | --- | --- |
| E3a | `kb/tasks/E3a-forecast.md` | S0 offline checks | done | E3a-forecast | merged at 59fe62d; ../domino-E3a retained |
| E1a | `kb/tasks/E1a-kestrel.md` | S0 offline checks | done | E1a-kestrel | merged at 5762475 |
| E6a | `kb/tasks/E6a-agent-feasibility.md` | S0 offline checks; public docs | done | E6a-agent-feasibility | merged at 63366ae |

C1: done, `kb/tasks/C1-engine-context.md`, f80401d merged at 3c54e67 under explicit user authorization. Independent review and post-merge 103-test check/build passed. Existing data backfill is separate.

| ID | Task card | Dependency | Status | Planned branch | Worktree |
| --- | --- | --- | --- | --- | --- |
| E3b | `kb/tasks/E3b-dominoes.md` | C1 and E3a merged | done | E3b-dominoes | aa1d876 independently reviewed and integrated; original worktree retained |
| E4 | `kb/tasks/E4-multiverse.md` | E3b reviewed and merged | done | E4-multiverse | 87de4f6 reviewed and integrated; ../domino-E4 retained |

| I2 | `kb/tasks/I2-computed-prototype.md` | E4, P4 | done | I2-computed-prototype | e0b1871 reviewed, merged052e942 and deployed to dev; combined522 tests/build pass |
| E6b | `kb/tasks/E6b-provider-adapters.md` | E6a | doing | E6b-provider-adapters | Reviewed8f095c6 merged234fdc3; four live jobs pass, explain/brief repairs pending |
| C2 | `kb/tasks/C2-learning-context.md` | E4 | done | C2-learning-context | e5f6833 independently reviewed and merged; 280-test combined check |
| E7a | `kb/tasks/E7a-grade-learn.md` | C2 | done | E7a-grade-learn | 9efe1d8 reviewed and merged at 6c0bd2b; 306-test combined check |
| C3 | `kb/tasks/C3-forward-data.md` | C2, E7a reviewed | done | C3-forward-data | cf5a78c plus provider adoptiona8fe7b0 mergedf3ff458;635tests pass |

## Product (Micah)

| ID | Task | Prompt | Depends on | Status | Branch | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Product machine setup | `prompts/shared/00-setup.md` | — | review | main | CREAO local setup complete: all five .env fields, three private agents, API mock runs and checks pass; other service access remains unverified |
| P1 | Web shell + playground | `prompts/product/P1-web-shell.md` | S0 | done | codex/p1-web-shell | Seven routes, fixture previews, local Convex, checks/build/browser pass |
| P2 | Convex schema, queries, mutations, fixture seed | `prompts/product/P2-convex.md` | P1 | done | codex/p2-convex | 14 tables/queries, 5 mutations; seed and live queries verified; 56 tests/check/build pass |
| P3 | Multiverse timeline (hero) | `prompts/product/P3-multiverse-timeline.md` | P1 | done | codex/p3-multiverse | SVG fan, stable fix morph, selection and keyboard access; desktop/mobile verified |
| P4 | Main screen: resilience bar, risks, chain, fixes, proof | `prompts/product/P4-main-screen.md` | P2, P3 | done | codex/p4-main-screen | Live subscriptions, exact branch selection, proof and confirmed approval; 67 tests/check and browser pass |
| P5 | Branch detail, connect screen, add event, next week | `prompts/product/P5-flows.md` | P4 | todo | | |
| P6 | Learning + record screens; taste pass | `prompts/product/P6-learning-record-polish.md` | P5 | todo | | |
| P7 | Usability test and demo materials | `prompts/product/P7-user-test.md` | P6 | todo | | |
| P8 | Demo video and submission | `prompts/product/P8-submission.md` | E8, P7 | todo | | |
| T1 | Dark palette and original Domino logo | User request | P1 | done | codex/dark-theme | Shared tokens, header mark and favicon; checks/build/screenshot pass |

| C1-UI | Plain financial timeline copy | User request | P4 | done | codex/plain-timeline-copy | Integrated from origin/main 687b91f; distinct from engine contracts C1 |
| I1 | C1-compatible scenario selection | `kb/tasks/I1-ui-risk-selection.md` | P4, contracts C1 | done | integration-ui-selection | Claude helper/test fix independently reviewed; combined 147 tests and browser check pass |

| V1 | Timeline particle experiment | User request | P3 | done | codex/timeline-particles | Full-line probability-weighted emission; 72 tests/build pass; browser checked |
| V2 | Timeline date/value inspection | User request | V1 | done | codex/timeline-particles | Selected-scenario guides only inside plot; weekly values, keyboard/touch; 75 tests/build pass |

## Shared

| ID | Task | Prompt | When |
| --- | --- | --- | --- |
| G | Gate check | `prompts/shared/99-gate-check.md` | At every gate |

| I3 | `kb/tasks/I3-computed-controls.md` | I2 | done | I3-computed-controls | eea1398 reviewed/merged/deployed; browser event/sim success |

| E3c | `kb/tasks/E3c-forward-forecast.md` | C3 | doing | E3c-forward-forecast | Claude pure engine adoption |
| E1b | `kb/tasks/E1b-week-runtime.md` | C3 | doing | E1b-week-runtime | Claude deterministic simulator |
| E6c/E6d | provider repairs/C3 consumers | E6b,C3 | done | main | reviewed,635combinedtests; Claude textsmokes pass |
| E6e | `kb/tasks/E6e-text-artifacts.md` | E6d | done | E6e-text-artifacts |1bc9761 reviewed/merged,647tests, direct brief pass with intermittent format |

| E2a | `kb/tasks/E2a-mock-sources.md` | C3 | doing | E2a-mock-sources | Claude authenticated source handler/server |
