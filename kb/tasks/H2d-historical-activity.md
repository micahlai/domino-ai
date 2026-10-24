# H2d: Truthful historical activity feed
- **Goal:** Expose actual app operation events for H4 motion without inventing agent or tool activity.
- **Folder:** apps/web/convex/ including additive schema/generated bindings; exceptions this Result and contract-v1.md activity readiness section. No UI/engine edits.
- **Contracts used:** H2a optional activity schema; H2c existing historical operations. Stable IDs, sequence, runtime time, run/entity and authorized evidence references.
- **Done when:** Real run save/disclosure reveal/alternative completion emit validated events after successful commits, not from queries/renders; retries deduplicate; query scope and pre-reveal filtering cover labels/references; reconnect ordering and failures tested; pnpm check passes; actual API and full dependency SHA published.
- **Notes:** Follow kb/spec/ui-styles-motion-2026-10-24.md. Agent/tool lifecycle events only if actual product operations exist; do not create agents, generate tools, expose development workers or call paid providers to fill the UI. Instant operations need no fake running stage.
- **Handoff:** Sequential backend phase after H2c on H2-historical-backend. Publish an additive activity-ready checkpoint for H4; no shared cloud deployment or main merge.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
