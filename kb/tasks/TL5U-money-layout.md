# TL5U: keep cash values readable at supported widths

- **Goal:** all four chosen-week cash values remain whole and readable on desktop and phone.
- **Folder:** apps/web/components/timeline/workspace ONLY plus this Result; TL2-timeline-screen.
- **Contracts used:** existing UI projection; no API/type changes.
- **Done when:** value layout adapts within narrow cards, never wraps inside a money value; focused UI/typecheck/lint pass; commit.
- **Notes:** root 1280px screenshot showed Starting cash $3,889,000.00 broken across lines in four-column panel. Use responsive container-friendly two-column/stacked layout and nowrap values. Preserve mobile chart containment. No Dashboard/backend/shared files. Lead does actual 1280/390px browser check.

## Result
- Done: focused UI 43 tests, web typecheck and scoped Biome check pass.
- What changed: chosen-week values use a card-width-aware auto-fit grid with a ten-rem preferred cell width, collapsing to one column when needed. Money values stay on one line, including usable cash in the introductory sentence.
- Watch out: lead verifies actual 1280px and 390px browser layouts after cherry-pick. No mobile chart containment, dashboard, backend or shared changes.
