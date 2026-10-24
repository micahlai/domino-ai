# Requests

Ask for a change in someone else's area here. Newest first.
Format: `- [ ] YYYY-MM-DD From -> To: request (file or function). Why.` Tick it when done.

- [x] 2026-10-24 Codex brain -> Jayden + Micah: review C1 in kb/spec/engine-context-contract-proposal.md. The contracts-only branch adds explicit invoice linkage/classification, bill targets and evidenced consequences, domino/scoring contexts, and branch/fix risk IDs. Affects engine, sim fixture spreads, agent validation and Convex payload readers. Initial request was for preparation; merge is now authorized and complete. Seed-data updates remain separate. Resolved by reviewed C1, merged at 3c54e67 under explicit user authorization; engine adoption and data backfill remain separate.

- [ ] 2026-10-24 Micah -> Jayden: P2 is ready on `codex/p2-convex`. Replace `connect`, `engine`, `agents`, and `week.advance` internal action placeholders in E5/E7; honor the identifier and lastPull rules in `kb/spec/convex-api.md`. Why: public mutations now schedule those exact entry points.
- [ ] 2026-10-24 Codex -> Micah: confirm Vercel/Convex team access and fill the shared integration credentials in local environment files before live integrations. Local Convex and the P1 fixture playground are ready; cloud access is unverified.

- [x] 2026-10-24 Codex brain -> Jayden + Micah: approve an explicit Deal-to-Invoice linkage in contracts before full E3/E4 integration. Current Acme fixture has a signed deal and same-amount invoice with no join; E3a will reject ambiguous input rather than guess. Contract edits require their own card and joint review. Resolved by reviewed C1, merged at 3c54e67 under explicit user authorization; engine adoption and data backfill remain separate.
- [x] 2026-10-24 Codex brain -> Jayden + Micah: decide the inputs for event-root domino evidence, bill deadlines and runway calculations before E3b. Engine.dominoes currently receives no branch changes, model or baseline; constraints have no bill target. Do not fabricate causal claims. Resolved by reviewed C1, merged at 3c54e67 under explicit user authorization; engine adoption and data backfill remain separate.
- [x] 2026-10-24 Codex brain -> Jayden + Micah: review the resilience wording before E4/P3 integration. Resolved by Micah's 687b91f copy update: scenario counts and weighted score are distinct, with an explicit explanation that this is not a probability of company survival.

- [x] 2026-10-24 Jayden -> Micah: confirm Convex table names in `kb/spec/convex-api.md` before E5 starts. Confirmed for P2; P1 intentionally creates an empty schema.
