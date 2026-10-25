# Timeline scales and contextual scenario creation

Implementation integrated on TL5-checkpoint: chart217b957 at8773177; contextual editorcb7f094 at196d154. User explicitly authorized TL7 merge into TL5, then requested axis scales and in-timeline scenario creation. Source/checks accepted; final live visual/save-flow check pending a user tab reload after browser-policy rejection of a stale connection-error page.

- Chart has actual saved-week date axis, exact currency-axis guides, negative/flat range support and retained comparison/week controls. No interpolated financial readout.
- Below the chart, selected-week context and Add scenario open an inline editor. Fresh cash events start from selected week; invoice/bill timing remains record-based. True forecast start remains the validation minimum.
- Hiding retains draft/queued changes; chart navigation never rewrites entered dates. Review binds exact queued changes/name; changed queue requires renewed review. Scheduled-item prefill is explicit. Discard is explicit. Existing simulation/save path unchanged.
- Combined pnpm check passes1,963 tests (web820), five typechecks and lint391. Production build passes. Lead reran15 focused scale/composer tests. [Source review](TL7XC-review.md).
- Backend3240 query confirms original Atlas Legal scenario still has13 weeks, low$2,609,000 and$41,000 shortfall. Existing data/env retained. No main/Field/dashboard/contracts/engine/root-schema/global styles or provider changes; no push.
- Runtime restarted on existing3107/3240/3241 after interrupted session. Visual browser access blocked at stale internal error page; user reload requested. Desktop/phone draft-retention, date default and real save are not yet claimed.

Use [TL5 smoke preview](http://127.0.0.1:3107/c/kestrel/timeline?runId=timeline%3Aworkspace%2F4d9835e8174efa96ff9c5974380cb755e199ad14). Select a forecast week, Add scenario, choose money in/out, inspect/edit date, queue event, hide/reopen, change chart week and verify date/queue remain. Review and Run as a new scenario to save. Daily financial actions are never executed.
