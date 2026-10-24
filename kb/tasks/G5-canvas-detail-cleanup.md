# G5: truthful output and instruction details

- **Goal:** remove the early-alternative fake-reveal adapter workaround and misleading journey label; display the stored CREAO instruction scope honestly.
- **Owner:** sole UI writer in domino-G3. Only components/historical/live.ts, HistoricalReplay.tsx and their focused tests; components/investigate/live/FinancialOutput.tsx, adapt.ts and their focused tests; this Result. No graph/layout, contracts/backend/globalstyles/dependencies.
- **Reuse:** buildView currently gates alternative on revealed, so FinancialOutput fabricates an empty reveal and strips fields. Smallest shared-builder change should allow validated saved alternative without any reveal or observed fields; remove savedAlternativeView fake-reveal workaround. Preserve alternativeIssue ownership/cutoff checks, existing historical journey, explicit costs/limits/postHoc warning. No money math.
- **Labels:** displayed alternative must not say not revealed yet. Availability of reported observations and alternative are independent; avoid implying reveal when only alternative exists. Keep baseline/reveal/response views truthful.
- **Profile:** acceptedG2d profile includes instructionsScope explaining supplied per-run rules vs unknown remote app system/skills/memory. Surface this stored note in agent details using existing metadata/detail slots, not invented text/model. Keep app IDs/technical fields collapsed. No secrets.
- **Acceptance:** focused tests for baseline, earlyalternative, revealedalternative, invalidalternative; future observed values/evidence/date remain absent before reveal even if rawcase is postreveal. Verify stored instruction scope survives adapter. No genericframework, packages or redundant components.
- **Skills:** /orchestrator /ponytail full, taste/ui-ux-pro-max. OneSonnet/high nochildren, bounded30min. Focusedtests/typecheck/lint only; nofullsuite/build/server/browser/livecalls/keys/push/merge/sharednotes. Commitlocal Result thenstop. Otheragents present, preserve their edits.

## Result
- Pending.
