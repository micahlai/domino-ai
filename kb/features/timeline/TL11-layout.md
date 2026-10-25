# TL11 timeline layout

User request, 2026-10-25. Continues `claude-timeline-chat` from `4af53a1`; supersedes the TL10 three-column dashboard arrangement. Financial behavior and existing interfaces stay the same.

- The saved timeline route fills the space below the app navigation. A compact header leaves the chart, cash scroller and time scroller as the primary workspace.
- The left scenario sidebar can collapse and widen. Scenario names wrap fully in its wide mode. Individual scenario disclosures hide dates, low points and supporting details until opened; comparison selection, ancestry and Build on remain available.
- The right Ask Domino sidebar can collapse and reopen without discarding a typed draft. Smaller screens expose the sidebars through accessible controls.
- Lowest point, lender's minimum, chosen week and cash flows live in initially collapsed bottom disclosures. Existing cash rules, scenario changes, event form and provenance remain reachable there.
- Keep saved numbers, scenario colors, parent-first comparison visibility, pan/zoom, keyboard selection and branch previews intact. No backend, contracts, schema or financial calculation changes.
- Follow-up: keep Build on and Building here visible outside scenario details. Horizontal wheel and time-scroller dragging pan continuously between weeks; only saved-week selection stays discrete. Gridlines stay anchored to date/cash coordinates and move with their axes.
- The chart key sits at the chart's top-left and expands into a vertical, collapsible list.
- Clicking a drawn scenario line places the focus dot on that branch at the clicked time. Between-week placement interpolates drawing geometry only; week details still use a saved week. Build on remains an explicit sidebar action.

Verification and commit details will be recorded in the feature handoff after review.
