# TL7XC independent UI review

## TL7X chart scales

Source accepted stable `217b957` against `bb04d82`. No source blockers. Changes are only WorkspaceChart, scale helper/tests and author task Result. No backend/contracts/engine/services/env/providers/TL5/main/push changes by reviewer.

Safe-cent labels use exact integer BigInt conversion, while numeric domain/tick calculations serve SVG geometry only. Flat ranges have nonzero padded domain, clamped at safe-integer limits; D3 proposed ticks are filtered to safe integer cents. Negative, near-safe-limit and mixed ranges remain finite and contain supplied values. At most3 actually drawn comparisons influence domain; hidden parent/fourth curve cannot distort scales. Dates are sampled from supplied saved weeks by index, bounded to7 with both endpoints/year context. Tick position uses same x scale as actual curves. Left padding grows for longest cash tick, date labels use separate bottom band, and forecast-start label moved outside plot into caption. Existing week controls, rule labels, comparison links and strong selected curve retained.

Independent verification at stable SHA:
-58 checked-in focused tests passed (9 scales,6 saved comparisons,43 workspace).
-3 scratch tests passed covering extreme/tight/flat/mixed ranges including positive/negative MAX_SAFE_INTEGER, exact round-trip of compact currency to every cent, and0..65 date arrays with unique ascending actual ticks/endpoints.
-`git diff --check bb04d82..217b957` passed; worker tree clean.
-Author reports full pnpm check1957 tests/five typechecks/lint387 and production build pass. Lead owns integrated full checks.

Actual desktop/mobile text collisions and connected controls require lead browser acceptance. Especially inspect existing long rule labels near cash ticks; no new browser/service actions by reviewer.

## TL7C contextual composer

Lead reviewed stable `cb7f094` and integrated it at196d154. No source blocker: ScenarioComposer retains mounted EventForm while hidden; chart-week props set only fresh cash draft dates, and buildChange keeps the actual forecast firstWeek minimum. No effect synchronizes draft on week changes. Queued changes and exact confirmation payload are retained on chart navigation/hiding; changing queue/name requires renewed confirmation. Item suggestions replace an unqueued draft only through an explicit button. Pending guards lock inputs; exceptions preserve draft and display retry guidance. The detached EventForm card is removed and one contextual editor lives directly under the chart. No backend/contracts/schema/global style changes.

Lead independently reran6 composer tests and9 scale tests, all15 pass. Integrated full check passes1,963 tests, five package typechecks and lint391; production build passes. Real backend reads confirm original TL5 low point260900000 cents and shortfall4100000 cents remain unchanged. Connected browser visual/save-flow gate is pending: browser policy blocked observation of stale connection-error tab; user asked to reload the now-running3107 page. No workaround attempted.

## Live browser gate completed2026-10-25

User reloaded in Chrome, granting fresh successful access. Lead verified actual1512px/390px layout, selected-week default, keyboard-edited date retention, hidden/mounted draft and reviewed queue retention, confirmed simulation/navigation, saved event exactness and reload. Browser native date fill did not commit React state in the automation surface; keyboard date editing did, and that committed date persisted correctly. Saved resultaca904d0ddd1a388af53fb1a99a09af81b79fd98 contains exactly$100 on2026-12-23 plus original parent changes once. Actual backend weekly equality confirmed. Final console warning/error list empty. Small mobile Remove label wrap and thin small buttons repaired with shrink prevention/minimum32px height; repeated full1963check/build pass. No remaining acceptance blocker. Screenshots and URLs in TL7XC-acceptance.md.
