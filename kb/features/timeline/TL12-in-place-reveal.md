# Accepted forecasts appear in place

User request, 2026-10-25. Continues TL11 on `claude-timeline-chat`.

- Accepting a reviewed chat, question, manual-event or rule proposal keeps the current workspace mounted. No route change is needed to view the accepted result.
- The confirmed saved run is selected automatically. The chart reads and validates that run before drawing it; pending reads have a status message and do not replace the chart with a loading screen.
- Reveal the new curve once when it first arrives. Repeated receipts, rerenders and old saved results do not replay the reveal. Reduced motion shows the final curve immediately.
- Explicitly opening a newly saved Worker, chat-result or risk/response scenario requests an entry reveal. Validate the selected child and actual saved parent before mounting its animated branch; consume the entry intent without reloading, preserving conversation/week context. Ordinary history links remain static.
- Preserve chart time/cash windows, focus, sidebars, typed drafts and the source run used by the conversation. Build on remains a separate explicit action.
- A late completion cannot update another company/run. Newly accepted results have priority within the six-comparison budget. If a chain itself is deeper than that budget, show the nearest parents with an explicit notice that older parents remain saved.
- Existing saved-result links remain available. No financial calculations, shared contracts or backend behavior change.
- Chat Send immediately displays the outgoing user bubble and clears the textbox. Pending/retry state preserves the exact command; validated transcript updates replace the optimistic bubble without duplication.
- Breach labels use separate positions and bounded text near chart edges. Dense/mobile layouts must preserve full receipt wording without colliding labels.
- Ask Domino is the sole named chat-sidebar toggle. It opens and collapses the same mounted panel, with visible text on phones, expanded state for assistive technology, and Escape focus return. No duplicate header or inner close buttons.

Verification is recorded in the Timeline handoff.
