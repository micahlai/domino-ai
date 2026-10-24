# G8: investigation-first product and company knowledge details

- **Goal:** one coherent front door into investigation, with inspectable saved company data and no developer/demo clutter in primary navigation.
- **Dependencies:** G6 accepted; G7 independently audited. QUEUED, do not launch before both gates. Same local UI writer as G6, no parallel UI worker.
- **Ownership:** apps/web/app/page.tsx, apps/web/components/AppShell.tsx, apps/web/components/investigate/**, related tests and this Result. No changes to G7 projector, backend, contracts, global styles, dependencies or shared coordination notes.
- **Read:** kb/spec/company-map-2026-10-24.md. Use /orchestrator /ponytail /taste /ui-ux-pro-max. Smallest shared-component change, no new theme/platform.
- **Behavior:** main CTA opens /investigate; primary product navigation highlights investigation and saved company knowledge/financial results. Remove Playground, theme selector, legacy Kestrel/demo and unfinished connect links from ordinary navigation while preserving direct routes. Show public historical 2U scope honestly. Wire G7 projection from existing getRun inputSnapshot to G6 knowledge node detail, with facts/sources/assumptions tabs or concise sections, costs/provenance/cutoff, accessible loading/error states. No invented learnings, no post-reveal evidence leaking into baseline knowledge. Keep financial chart and conversation visible/readable.
- **Acceptance:** relevant regression tests, typecheck/lint; Codex serialized fullcheck/build and desktop/mobile journey including reload, knowledge before/after reveal, alternative and provider-unavailable state. No self-claimed visual acceptance. Commit own changes and stop for audit; no push/main merge/provider calls.

## Result
- Pending.
