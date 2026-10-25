# Timeline smoke-test checkpoints

Run against the Timeline lane's own local backend. Current app URL is http://127.0.0.1:3107. A checkpoint is ready only after its implementation, checks and lead browser verification pass; this list does not claim completion.

| Checkpoint | What you can try | Expected result | Current status |
| --- | --- | --- | --- |
| TL1 saved baseline | Open /playground/timeline-seam, load labelled Kestrel weekly data, review assumptions, save, open saved link and reload | 13 weekly cash points and low point persist identically. Tampered seed rejects; repeated save does not duplicate a request. | Implementing |
| TL1C constraints | Add a minimum usable-cash rule, edit its limit, reopen the old saved calculation | New rule/version is visible; new evaluation reflects the edit while old saved rules/results stay fixed. Supported bill deadline/runway rules have explicit units and scope. | Planned |
| TL2 events and comparison | Delay an invoice or add a future expense; compare parent/scenario | New branch shows computed cash effect and any rule violation with date/value/limit; historical data is untouched. Existing breach is distinguished from newly caused breach. | Planned |
| TL3 questions | Ask why cash dropped; ask what if Acme pays 14 days late; supply an incomplete event prompt | Answer cites selected timeline records; complete event matches the form calculation; incomplete request asks for details. A prompt-defined constraint is shown for confirmation. | Planned |
| TL4 saved sessions/catalog | Add follow-up events, open catalog, copy a result link, reload | Conversation/event ancestry and exact results reopen without rerunning the model or engine. | Planned |
| TL5 core acceptance | Complete the full question -> rule -> event -> future event -> compare -> reopen journey | Main flow plus invalid input/provider failure/retry work on desktop/mobile. | Planned |
| TL6 dashboard | Open home and inspect cash/low point/health reason | Numbers match saved run and supported health rules. | Follow-on |
| TL7 automatic analysis | Run analysis and open a saved risky scenario/response | Recorded job status, engine-scored effect/cost and explanation; failures/retries visible. | Follow-on |
| TL8 rejoin | Create nested branches that recover or fail | Rejoin follows agreed financial-state rule; failure ends at computed breach with cause. | Follow-on |

Already available from the older prototype: /c/kestrel supports the computed scenario chart and explicit event/fix controls when the local runtime is running. That preview is separate from the new saved weekly import workflow.
