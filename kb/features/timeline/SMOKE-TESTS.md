# Timeline smoke-test checkpoints

TL1–TL5 are ready locally on **TL5-checkpoint**. App: http://127.0.0.1:3107. Uses labelled synthetic Kestrel peer data and explicitly reviewed assumptions. [Acceptance evidence](TL5-acceptance.md).

| Checkpoint | What you can test | Status |
| --- | --- | --- |
| TL1 saved baseline | Verify/import weekly seed, save 13-week forecast, reopen; tampered seed rejects | Ready locally |
| TL1C constraints | Add/edit/remove cash minimum, months of runway or a targeted bill deadline; older runs retain original rules | Ready locally |
| TL2 events | Delay an invoice, add future money in/out or move a bill; compare parent and rule outcomes | Ready locally |
| TL3 questions | Evidence answers, natural-language event/rule proposals, confirmation, missing-input clarification and failure receipts | Ready locally |
| TL4 saved sessions | Nested events, exact question/result links, paginated catalog and quiet reopen | Ready locally |
| TL5 complete flow | Full journey below, desktop and phone | Accepted locally |
| TL6 financial output handoff | Health/risk/chart data for Field's dashboard through agreed seam | Follow-on |
| TL7 automatic analysis | Bounded risk/response generation and engine scoring | Follow-on |
| TL8 rejoin | Evidence-based financial-state branch rejoin | Follow-on |

## Try the complete flow

1. [Open the saved weekly baseline](http://127.0.0.1:3107/c/kestrel/timeline?runId=timeline%3Aworkspace%2Fedf763202b5cd8f444578c86fd944038008bec15). It has 26 observed weeks and 13 forecast weeks. Its low point is $2,689,000 in the week of Nov 16, 2026.
2. Move **Choose a forecast week** to Nov 2, 2026 (the slider supports Home and arrow keys). Ask **Why did cash drop this week?** The answer names $62,000 rent on Nov 5 and $600,000 payroll on Nov 6. Expand **Where this comes from** for record references.
3. Ask **What if we spend $80,000 to Atlas Legal on 2026-11-17? Keep usable cash above $2,650,000.** Review the separate expense and rule, check confirmation, then **Run this scenario** and **Open it**. Nothing runs before confirmation.
4. Inspect **Cash rules**: new breach, projected $2,609,000 versus the $2,650,000 minimum, $41,000 short on Sunday Nov 22. **Show proof** explains the rule source and weekly-close evaluation.
5. In **Add an event**, choose Acme's open invoice and 14 days late. Add the event, name the scenario, review and run. The nested result retains the $80,000 expense once and moves Acme's $240,000 receipt from Nov 25 to Dec 9. The earlier breach is labelled pre-existing in this child.
6. Try a rule-only prompt, **Keep usable cash above $2,500,000.** Confirm and open its result. Only rules change; cash is identical. The proposed full set retains prior rules. To replace/remove a rule, use **Cash rules to check**, write a note, review and save a new revision.
7. Try **What if we spend $80000?** or **Keep usable cash above $3,000,000 every day.** These ask for details/explain unsupported daily checks and produce no financial result. Complex ambiguous amounts/delays also clarify.
8. Open **All saved scenarios**, use **Show older scenarios**, reopen your result and reload. Values, rules, ancestry and saved questions remain unchanged. Reopening does not rerun the engine or language provider.

[Open the accepted expense/rule example](http://127.0.0.1:3107/c/kestrel/timeline?runId=timeline%3Aworkspace%2F4d9835e8174efa96ff9c5974380cb755e199ad14) or [its nested payment-delay scenario](http://127.0.0.1:3107/c/kestrel/timeline?runId=timeline%3Aworkspace%2F4652fa087fda2846167ffddd3d46688ba511a582).

## Fresh import and optional language reader

At http://127.0.0.1:3107/playground/timeline-seam, load Kestrel weekly seed, review neutral assumptions, save forecast and follow its workspace link. Load the tampered copy to see hash rejection. The playground also includes Timeline workspace previews.

Fixed supported wording uses the bounded grammar. Other wording can use the optional one-shot language reader; **How this was read** identifies the method. For example, **Please identify the cash trough for this saved forecast.** was verified through the configured provider. Financial answers still come from code and saved outputs. Provider errors, refusal, malformed/truncated replies and expired jobs are saved failures; no financial result is created. Those failure modes are covered with controlled test responses, without disrupting the live provider.

Cash floors check Sunday closing usable cash within these 13 weeks. Runway uses the engine's forecast cash-use method; an unavailable value remains unknown. Bill rules use allowed late days after the targeted bill's due date. Daily floors, category budgets and headcount constraints remain unsupported. Imported schedule markers keep their original dates and do not add cash; scenario effects appear in the saved financial values.

The shared Timeline navigation opens the older `/c/kestrel` prototype. Use the saved weekly links above for this checkpoint. Real Field exchange and dashboard integration remain separate gates.
