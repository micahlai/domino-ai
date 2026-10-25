# Timeline calculation links, Oct 25 2026

- Checkout: `domino-field-operating-ui`, branch `field/timeline-calculation-links`, combined base `01964ca`.
- Added exact selected-run How we got here action, per-run links in ScenarioNav and ScenarioSidebar, and a saved parent-vs-fix low-point comparison using existing engine outputs. New scenario saves already navigate to the returned run ID, so the action follows the new selection.
- The suggestion simulation baseline note now carries a validated local Field trace URL. Workspace and calculation pages surface that exact origin link through later scenario edits.
- Recorded Field and Timeline calculation routes use a frozen AppShell header with no selected-company hook, picker, current source strip or simulation clock.
- Verified: locked install completed after offline cache miss; 88 focused tests, changed-file Biome, web tsc, Convex tsc and diff check pass. No local server/browser or provider call in this branch.
- Next: root integrates this commit, checks real saved links/comparison in browser, then independent audit. No merge/push or runtime change here.
