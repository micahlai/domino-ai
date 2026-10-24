# S3: one quarterly event and costed response
- **Goal:** engine-computed Baseline -> Event -> Response with justified financial links.
- **Dependency:** S1 accepted; QUEUED until exact public schemas are frozen.
- **Ownership:** packages/engine/src/period-scenario.ts, period-scenario.test.ts, index.ts export only and own Result. No contracts, data bundle, backend or UI.
- **Method:** compose quarterBridge and quarterAlternative. Event is total additional operating outflow over a wholly post-cutoff interval inside target quarter, applied once to total/usable end balances. Preserve nowcast exactly. Response reuses A1 costs/lag and may worsen outcome. No fabricated within-quarter observed path, invoices, automatic threshold or bankruptcy chain.
- **Checks:** zero event identity, exact once application, safe integer arithmetic and range direction, total/restricted/usable reconciliation, response cost+lag composition, no in-window benefits for A1, beneficial synthetic response labelled synthetic, cutoff/source/assumption closure, deterministic results, valid graph bases, optional rule only when explicitly supported. All required basis/dependency refs retained.
- **Done:** focused engine tests/typecheck/lint, parent independent financial/date audit and full suite. Commit then stop; no main/push/providers. Use orchestrator/ponytail/engine-tdd.
## Result
- Pending.
