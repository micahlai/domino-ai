# Clean UI, four styles and truthful motion

User addition, 2026-10-24: clean up UI using existing component assets/libraries; preserve the current look as one option; add Ramp, Hyphenate and generic shadcn options; make agent/tool/timeline activity satisfying through motion. User confirmed Hyphenate means https://hyphenate.ai/. This expands the UI scope after the historical core; it does not replace the financial chart with a canvas or authorize arbitrary tool generation.

## Call and counterargument

One semantic component tree, four style configurations and one shared motion system. H3 owns historical functionality. After H3 checkpoints and releases UI ownership, H4 works in a separate worktree branched from that exact H3 commit. H4 is the next phase of the UI slot, not a fourth concurrent writer. All styles remain available for later selection; Original stays the default.

Counterargument: a separate implementation for each style could match every reference more literally, but would multiply bugs, state handling and maintenance. Use shared components with explicit layout/density variants where tokens alone are insufficient. Match observed Ramp details closely; do not claim pixel equivalence for screens that were not inspected.

## Style targets

| Selector label / ID | Target | Required differentiation |
| --- | --- | --- |
| Original / original | Preserve Domino's current warm dark surfaces, mint accent, logo and readable financial chart | Capture a before screenshot. Clean up inconsistent spacing/controls without losing the current visual identity. |
| Ramp / ramp | Match the publicly observable Ramp product design as closely as the same Domino workflow permits | Reference-led light surfaces, neutral text, lime accent, navigation/table density, spacing, borders, typography and control geometry. Inspect actual public product images, not just the marketing hero. |
| Hyphenate / hyphenate | Match https://hyphenate.ai/ and its public product visuals | Public platform page shows warm light surfaces, burgundy text/controls, orange highlights and fine structured backgrounds. Adapt that vocabulary to a clear financial workspace; distinguish observed references from inferred app details. |
| shadcn / shadcn | Restrained default shadcn dashboard | Neutral palette, standard component proportions, quiet borders, conventional navigation and familiar interaction states. This deliberately generic option is requested by the user. |

Keep Domino branding/content and identical financial data in all four. Do not import reference-site logos, marketing claims or customer data into the application. Avoid unnecessary decorative chrome; the financial chart and evidence are still the center. The brand accent must not replace consistent positive/negative financial meaning.

## Reference record

- [Ramp expense management](https://ramp.com/expense-management): public UI examples and typography/control references. [Ramp reporting](https://ramp.com/reporting) is a further product-reference target for H4 to inspect. [Interactive tour](https://ramp.com/explore-product) was email-gated during this planning pass; no email was submitted. Do not pretend private screens were seen. H4 records actual reference URLs, viewport, inspection date and compared screenshot surfaces in its Result/report.
- [Hyphenate platform](https://hyphenate.ai/platform): inspected public page; warm background, dark red typography, orange accent and thin patterned lines. Public app imagery is a reference, not evidence of authenticated product behavior.
- [shadcn theming](https://ui.shadcn.com/docs/theming): use semantic CSS variables. Adapt to the installed Tailwind 3 and existing HSL tokens; do not copy a newer setup that requires an upgrade.
- [Motion accessibility](https://motion.dev/docs/react-accessibility): respect reduced-motion preferences through Motion's supported controls and hooks. Check installed APIs before using a current-doc example.

## Reuse and code budget

Already installed: shadcn-style Radix Button, Card, Dialog, Sheet, Tooltip, Switch, Badge, Table, Skeleton and Separator; Tailwind 3, class-variance-authority, Lucide, d3-scale/d3-shape and motion 14.6. Existing timeline already uses motion/react and useReducedMotion.

Audit components before replacement. Reuse those primitives for menus, dialogs, tabs/segmented selection, evidence panels, status rows and skeletons; add a small accessible wrapper only when needed. Do not rerun shadcn init, bulk overwrite primitives, add a second component system or add framer-motion alongside motion. Keep the custom financial SVG geometry and tested selection logic. No chart rewrite just for appearance.

Use a small validated style registry and semantic tokens for surface/text/border/accent/status/chart colors, typography, spacing, density and radius. Prefer CVA variants and small shared shell variants over four page copies, deep CSS overrides or per-theme business logic. Audit hardcoded SVG/canvas colors so chart/tooltip/portal layers honor every style. Keep chart scale, records and calculations unchanged across styles.

## Theme selection and review

- A keyboard-accessible Style selector offers all four options on the real app and playground, with readable selected state. Persist the choice locally; do not create backend preference tables for this experiment.
- Support a validated URL override such as ?style=ramp for reproducible review screenshots. Invalid values fall back to Original. Define URL override precedence over stored preference in the implementation report.
- Switching style must preserve company, cutoff, saved run, reveal status, selected branch, input values and open evidence. It must not reload data, resave forecasts or remount financial state. Dialog/tooltip portals must use the same tokens.
- Handle SSR/hydration and the initial theme explicitly. Test reload and direct links without wrong-theme flashes, hydration warnings or a blank shell. No arbitrary CSS/HTML from URL or storage.
- Add a comparison playground that renders the same snapshot/state for each style. Only the active style needs live queries; do not multiply backend/provider requests by four. Show screenshots of the same viewport and state, including an open evidence panel and an error/empty state.

## Motion grammar

Use the installed motion/react and existing CSS transitions. Motion explains state changes; it does not imply extra work happened.

| Actual event | Visual treatment |
| --- | --- |
| Forecast/run successfully created | Reveal the new branch/path, settle its label and highlight the new result briefly |
| Disclosure revealed | Introduce observed points and the comparison panel while retaining the saved projected line |
| Alternative successfully computed | Expand one response branch and its cost/tradeoff panel; keep the selected state stable |
| A real agent task starts/completes/fails | Add/update its activity row or node with status, timestamp and evidence/output link |
| A real tool is registered/added or invoked | Introduce/update the tool entry or connection with the actual operation label; do not confuse invocation with creation |
| Source loaded or validated | Update the relevant source row and progress state from a confirmed result |

Use stable IDs, layout transitions and bounded enter/exit animation. Prefer transform/opacity and modest shared timing presets. Preserve focus and do not animate sorting while a user is interacting. Keep exact money labels readable; animation must not fabricate intermediate observed financial values. No constantly bouncing cards, artificial delays or simultaneous animation on every surface. Reduced-motion mode is fully usable and honors the existing pause/visibility behavior.

Activity updates must be deduplicated by event ID, ordered by a defined sequence, resilient to reconnect/retry, and must not replay old entrances on theme changes. Initial history may render quietly; only newly received actual events animate. Cap rendered history, preserve the user's scroll position and use polite status announcements sparingly. Actual failures must stay failures until a real retry succeeds.

## Backend seam and honesty

H2a owns a minimal optional activity contract, and H2c owns event emission/query wiring, so H4 never invents API contracts. Freeze the schema with stable event ID, run/task/entity reference, kind/status, sequence, runtime timestamp and authorized evidence/output references. Runtime event time is separate from the historical financial/publication date. A derived count or status may use UI presentation logic; financial calculations stay backend-owned.

Emit only real historical app operations that are implemented, such as a saved run, revealed disclosure or computed branch. Emit durable events within the successful mutation/action lifecycle, never by writing inside a Convex query or on every render. A read-only case load can animate its confirmed local query result without inventing a durable job. Emit success only after the operation commits; do not let a failed or retried write create a false completion. Enforce idempotent emission and the same pre-reveal filtering on event metadata as on result payloads. Do not leak hidden source names, figures or evidence through activity labels. An instantaneous operation may have only a completion event; do not invent a long-running job.

Agent/tool events are supported by the visual component and contract but emitted only if an actual product agent/tool lifecycle exists. Do not present the development Claude subagents as Domino's product agents. A tool registration can be an explicit real registration of an existing tool; it does not require implementing generated tools. Do not turn every deterministic function call into a fictitious agent spawn.

If the feed is unavailable, show an honest idle/unavailable state in the app. The playground may include a clearly labelled Simulation preview with a Replay button for agent/tool/timeline transitions. This is a component test, not a claim of live agent execution. H4's Result distinguishes live, fixture and unavailable events.

The full pan/zoom agent page with persistent conversation remains a separate stage. H4 delivers polished activity components and an inspectable activity panel now; the later canvas reuses them. Do not implement fake chat replies to fill space.

## Verification and delivery

- Run existing relevant tests, full pnpm check and production build; serialized through C0. Add focused tests for style persistence/invalid values/state preservation and activity deduplication/order/reconnect behavior where behavior changes.
- Inspect all four styles at desktop and narrow mobile widths, with keyboard focus, drawer/dialog/tooltip layers, long labels, loading/error/empty states, source labels and observed/projected chart semantics. Capture the same populated state in all four; also check reduced motion.
- Confirm no runtime/console/hydration errors and no extra backend calls from style switching. Preserve old operational UI regression checks and the historical save/reveal flow.
- Keep a component reuse/changed-files list and reference comparison report in kb/coordination/historical/ui-styles-result.md. Report limitations in reference matching; tests do not prove visual fidelity.
- Branch H4-ui-styles-motion in ../domino-H4 from the exact accepted H3 commit. Commit/checkpoint Original cleanup + selector, four styles, then live activity motion separately. Push for review; merge only into the preview under C0, never main.
