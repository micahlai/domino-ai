# TL7S-R: independent saved-scenario UI review

- **Goal:** review sidebar/chart changes for truthful saved data, scope, bounded loading and usable selection.
- **Folder:** read-only TL7-scenario-sidebar worktree source; scratch /tmp/TL7S-review; this Result filled by lead.
- **Contracts used:** existing WorkspaceRun/CatalogEntry/Forecast and get/graph; no contracts changed.
- **Done when:** concrete blockers with repro or accepted stableSHA; focus on scope/seed/week validation, max3 comparison queries, current/parent deduplication, saved curves/date alignment, keyboard links, loading/failure and long-label/mobile containment. Run relevant tests independently.
- **Notes:** review/ui-build/taste and apps/web/AGENTS apply. No edits/commits/services/env/provider/TL5/main/push. Lead handles browser and full checks after integration. User authorizes parallel Timeline work; Codex only. No delegation.

## Result
- Done: accepted repair34053b7;49 focused tests and5 independent scratch probes pass. Lead live desktop/mobile selection, navigation, keyboard and clear flow pass; full1948 tests/build pass after integration.
- What changed: none by reviewer; audit copied to kb/features/timeline/TL7S-review.md. Lead acceptance/screenshots in TL7S-acceptance.md.
- Watch out: initial53ea673 source acceptance was withdrawn after live browser found unstable subscriptions. Primitive-ID memo repair is now verified in the actual connected screen. TL5 stays597fcc0; no merge authorized.
