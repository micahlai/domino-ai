# TL9 isolated chat acceptance

Status: accepted locally, ready to push as its own checkpoint; right-sidebar and repeated-payment repairs verified under [TL9U2](../../tasks/TL9U2-chat-sidebar.md). Separate `TL9-chat-checkpoint` worktree. Published `origin/TL7-checkpoint` remains1140c26; no TL9 push or merge into TL7. TL8 remains separately unimplemented financial-state rejoin.

## Verified foundation

- Backend274b3c9 and first UIe8d9875 independently accepted:38 backend tests,21 UI tests and32 independent probes. [Review](TL9-review.md) records repaired ambiguity, conditional, relative-date, discount and account-scoped wording. Unsupported meanings remain clarification rather than becoming exact financial instructions.
- Combined `pnpm check`:2,023 tests (contracts496, engine344, sim5, agents298, web880), five typechecks, lint407 files. Separate Convex typecheck and production build pass. Import inventory remains18 legacy crossings, zero in seam harness; no new cross-lane import.
- Lead boundary acceptance test uses actual Convex functions and frontend parser, checks no engine/network before confirmation or on reopen/retry, exact reviewed event save, parent link and unchanged source.
- Isolated3260 live API:21 checks pass. Missing amount/date/counterparty and invoice/days retain typed fields; exact original request snapshots survive later turns/confirmation; changed retry/stale revision/unreviewed confirm reject; wrong company cannot read; unsupported daily and ambiguous date wording creates no proposal.
- Actual cash event:remove_cash8,000,000 cents to Atlas Legal on2026-11-17. Rule-only child adds265,000,000-cent minimum, retains inherited event/forecast, explains4,100,000-cent shortfall. Original source remains byte-equal.
- Chrome first presentation:explicit start, short date/recipient replies, review checkbox gating, confirm/save, reload same transcript/result, and linked timeline low$2,609,000 pass. Desktop1512 and phone390 first layout had no page overflow. New sidebar presentation requires repeated browser acceptance.

## Runtime and scope

New anonymous3109/3260/3261 runtime uses an explicitly reviewed, labelled synthetic Kestrel neutral seed; no copied environment, credentials, provider config or database. Chat uses deterministic supported wording; no provider-backed unrestricted dialogue is claimed. Each conversation is pinned to one source/version and saves only its server-held reviewed proposal.

Source:`timeline:workspace/7b750204b9e2d963f740de1ecd2f68fe8bf37b11`. Live API cash:`timeline:workspace/7a2ea82141f4a4128dbf29b83d72348f47eb52c9`; rule:`timeline:workspace/4f57851c67657398940b8267817c0cc073b693c4`. Browser cash:`timeline:workspace/8b52087fab074d231797e5104d99b2b7c70ca0b0`.

No shared contracts, engine, root schema, dashboard, Field, main or stable TL7 source changes. Additive Timeline-owned chat tables only. Production authorization, real Field data and TL8 remain separate.

## Sidebar follow-up

- UI9e7e250 places chat to the right of the timeline, keeps saved scenarios accessible, and uses an in-page collapsible mobile section. Legacy chat links redirect preserving source/conversation/selection. Independent101 chat/workspace tests pass.
- UIdd06258 repairs a live initialization race: the composer waits until its durable conversation URL is ready, so a fast first reply survives. Independent24 chat tests pass.
- Live desktop1512: chart832px plus right chat352px, no overflow; rule clarification/review/save/reload passes. Phone390: no overflow, hide/show works, phone collapse followed by desktop resize leaves chat visible, legacy redirect preserves one chart/one chat.
- Live nested payment test found engine labels must be unique. Backend6291fd7 distinguishes new colliding labels by date/ordinal before review; ancestor labels and financial inputs remain unchanged. Two permanent regressions verify retained rules independent of object key order and repeated same-recipient/same-date payments exactly once.40 backend tests pass. Final combined/live checks pass.

## Final gate

Final source6291fd7 includes UI sidebar9e7e250, initialization repairdd06258 and repeated-payment repair6291fd7. `pnpm check` passes2,028 tests (web885, contracts496, engine344, sim5, agents298), five typechecks and lint408 files. Separate Convex typecheck and production build pass. Independent final40 backend/24 UI tests pass. Live nested save passes six more checks: distinct reviewed label, exact50,000-cent delta, ancestor once, rules retained, identical confirm retry, unchanged source. Chrome final saved receipt displays$500 onNov18 with distinct label and retained$2,650,000 rule beside the timeline; console has no errors and1512px page has no overflow.

[Final desktop](evidence/TL9-sidebar-final.png), [desktop review](evidence/TL9-sidebar-desktop.png), [live nested evidence](evidence/TL9-nested-live.json). Earlier phone390 checks include no overflow, collapse/resize visibility and fast first reply retention. This is bounded deterministic chat on labelled synthetic data; production authorization and unrestricted dialogue remain outside scope. No TL9 push or merge into TL7 performed.
