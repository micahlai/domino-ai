# Domino design spec

Scope update (2026-10-24): preserve the completed chart UI. Historical dates, projected/observed distinction and progressive reveal follow `historical-case-study-plan.md`. The separate later agent canvas does not replace this financial timeline. Latest user visual scope: `ui-styles-motion-2026-10-24.md` adds Original/Ramp/Hyphenate/shadcn variants and meaningful activity motion; its specific palette/layout requirements supersede older single-style restrictions below.

Status: v1, 2026-10-24. Owner: Micah. Read with `build-spec.md`.
Style: clean, calm, dark. Mint is the primary accent. A person with no finance knowledge must understand
the main screen in 10 seconds.

---

## 1. Screens and routes

| Route | Screen | Purpose |
| --- | --- | --- |
| `/` | Landing | One sentence, one button: "Connect a company" |
| `/connect` | Connect | Domino finds, learns and checks each data source (live checklist) |
| `/c/[companyId]` | Multiverse (main) | The hero timeline, resilience score, risks, fixes |
| `/c/[companyId]/branch/[branchId]` | Branch detail | One future: chart, domino chain, fixes, proof |
| `/c/[companyId]/learning` | Learning | Forecast error falling week by week; learned rules with proof |
| `/c/[companyId]/record` | Record | Every approval, rejection and change |
| `/playground` | Playground | Every component with fixture data. Build here first. |

---

## 2. Main screen layout (`/c/[companyId]`)

```
+--------------------------------------------------------------------------------+
| Domino   Kestrel Data · week of Nov 2          [Add event] [Next week]          |
+--------------------------------------------------------------------------------+
|  Survives 7 of 11 futures  (64%)       [ ] Apply fixes        Breaking points ▸ |
|  "Kestrel breaks if Acme pays 38 or more days late."                            |
+--------------------------------------------------------------------------------+
|                                                                                |
|   PAST (26 weeks)                    | TODAY |        FUTURES (13 weeks)        |
|   solid line + event markers         |       |   many thin lines fan out        |
|   o Acme paid 24 days late           |       |   ✓ green ends / ✗ red breaks    |
|                                      |       |   - - - lender's limit $3M - - - |
|                                                                                |
+--------------------------------------------------------------------------------+
| Risks (ranked)            | Selected future: domino chain   | Fixes            |
| ● Acme pays late  70%     | 1. Acme pays 45 days late       | [card] [card]    |
| ● Northwind churns 25%    | 2. Usable cash drops, wk 4      |                  |
| ● Cloud bill +30%  30%    | 3. Lender's limit broken, wk 5  |                  |
+--------------------------------------------------------------------------------+
```

- Top: resilience bar. Middle: the multiverse timeline, full width, about 420 px tall. Bottom: three panels.
- On small screens, the bottom panels stack. The timeline scrolls horizontally if needed.

---

## 3. The multiverse timeline (hero component)

Component: `MultiverseTimeline`. Custom SVG, not Recharts, because we need full control of the fan-out and animation.
Libraries: `d3-scale` and `d3-shape` for math, `motion` (Framer Motion) for animation.

### 3.1 Props

```typescript
type MultiverseTimelineProps = {
  history: HistoryWeek[];              // past, oldest first
  pastEvents: PastEvent[];             // markers on the past side
  today: ISODate;
  report: ResilienceReport;            // universes to draw
  limit: Cents;                        // lender's minimum (red dashed line)
  selectedUniverseId?: Id;
  onSelectUniverse: (id: Id) => void;
  showFixes: boolean;                  // animate between report and reportWithFixes
};
```

### 3.2 Drawing rules

| Element | Look |
| --- | --- |
| Past line | Solid, 2 px, orange. Area below it lightly filled. |
| Past event markers | Small circles on the line. Red outline for bad events, green for good. Label on hover. |
| Today line | Vertical, 1 px, dashed. Label "Today" and its date at the bottom. |
| Base future | 2 px, off-white, continues the past line. |
| Other futures | 1.25 px. Opacity scaled by probability (0.25 to 0.9). Survives: muted green. Breaks: pink after the break point, muted before it. |
| Break marker | Small pink cross at `breaksAt`, on the line. |
| Survive marker | Small green check at the right end. |
| Selected future | 3 px, mint green, label at the right end. Others fade to 0.15. |
| Lender's limit | Pink dashed line on the future side only, label "Lender's limit $3M". |
| Y axis | Usable cash in $M, 4 ticks, light grid. No x-axis title; month labels only. |

### 3.3 Motion (this is the wow)

1. On load: the past line draws left to right (0.8 s). Then each future line grows out of the today point, one after another, 40 ms apart (the "multiverse" fan-out).
2. The resilience number counts up as lines finish.
3. "Apply fixes" toggle: every line morphs from its no-fix path to its with-fix path (0.6 s). Lines that now survive change from red to green. The score counts from 64% to 93%.
4. Hover a line: it brightens, a tooltip shows the universe label, chance, and low point.
5. Respect `prefers-reduced-motion`: skip the animation, show the end state.

### 3.4 Particle experiment (`codex/timeline-particles`)

Soft particles emit outward from the full length of each history and forecast curve, then fade. Allocate forecast particle counts in proportion to the supplied scenario probabilities within a shared budget; history uses a fixed baseline weight. Selection highlights a scenario's particles; fix previews move their emission origins with the chart geometry. Particle positions never change forecast values. Keep financial labels and paths readable; no flashes, portal effects, camera movement or background star field.

A single Canvas layer samples curve coordinates on geometry changes and reuses typed buffers while drawing. Scale the budget with viewport width, capped at 720 particles / 32 tracks. Cap pixel ratio at 1.5 and stop the animation loop offscreen, in hidden tabs, and for reduced motion. Use 30 fps for coarse pointers and back off from 60 fps if drawing is persistently expensive. Offer Pause motion / Resume motion. The SVG remains the accessible, selectable source of forecast data.

The playground's ParticleMotion section repeats sample curves 30 times to exercise rendering; those copies are not additional financial forecasts.

### 3.5 Weekly cash inspection

While the pointer is inside the plot, show dotted vertical and horizontal guides at the nearest supplied weekly point. Hide the guides when it leaves. Show the full date, including year, and exact cash to the cent. Use recorded history on the left and the selected scenario on the right; default to the base forecast when none is selected. Hovering other curves must not change the inspected scenario; clicking still selects them. Never interpolate money or present the synthetic Today anchor as a recorded weekly value.

Keep the last inspected week in the readout when the pointer leaves. An Inspect week range control provides keyboard arrows, Home/End and touch access to the values. Keep its date when changing scenarios or previewing fixes, and update the value from the current report. On narrow screens, choosing a week brings its chart position into the horizontal viewport. Avoid collisions with nearby month and endpoint labels. The existing company and playground timelines include this behavior.

---

## 4. Other components

| Component | Props (main) | Notes |
| --- | --- | --- |
| `ResilienceBar` | `report`, `reportWithFixes`, `showFixes`, `onToggle` | Big number, toggle, breaking-point sentence |
| `RiskList` | `risks: RiskEvent[]`, `selectedId`, `onSelect` | Sorted by chance × impact. Each row: dot, label, chance, impact in $K |
| `DominoChain` | `dominoes: Domino[]` | Numbered list. The step that breaks a rule is red. Each step has a proof icon. |
| `FixCard` | `fix: FixCandidate`, `gain: Cents`, `onSimulate`, `onApprove`, `onProof` | Title, "+$240K low point · low risk", cost note, three actions |
| `ProofDrawer` | `evidence: Evidence[]` | Right-side sheet. Source badge, ref, quote in a block, note |
| `BranchChart` | `branches: Branch[]`, `selectedId`, `limit` | Recharts line chart for the branch detail page |
| `ConnectChecklist` | `sources` | One row per source: found, learned, tie-out ✓ / needs review |
| `LearningChart` | `grades` | Error % by week, falling. Recharts. |
| `RuleCard` | `rule: LearnedRule` | Rule text, error before → after, proof |
| `AddEventDialog` | `onAdd(changes)` | Pick from a list of event templates; fields for customer, days, amount |
| `Headline` | `text` | One full sentence answer |

All components live in `apps/web/components/`. Each has a playground section with fixtures.

---

## 5. Design tokens

| Token | Value | Use |
| --- | --- | --- |
| Background | `#15110F` | Near-black brown page background |
| Surface | `#211B17` | Dark brown panels and popovers |
| Warm surface | `#3B312B` | Secondary controls and selected supporting areas |
| Border | `#493B32` | Subtle separators |
| Text | `#F4F1EB` | Main text |
| Text muted | `#BEB3AA` | Labels, captions |
| Accent / safe | `#68B99E` | Primary actions, selected future, surviving futures |
| Clay | `#D6A17E` | Supporting chart and history accents |
| Danger | `#D991A8` | Broken rules, lender's limit, breaking futures |
| Font | Inter | Everything |
| Radius | 8 px | Cards, buttons |
| Spacing | 4 px steps | Use Tailwind spacing scale |

Pink warning text is lightened to `#E6A5B9` for small text contrast. Green remains the primary color; pink and orange are supporting accents.

Dark mode uses a near-black brown base per Micah's revised direction. Charts use labels and outcome markers in addition to color. The Domino mark comes from `calhacks-2026/public/favicon.svg`, recolored without changing its geometry.

---

## 6. Words (copy rules)

| Do say | Do not say |
| --- | --- |
| Lender's limit | Covenant |
| Cash you can use | Liquidity, unrestricted cash |
| Cash forecast, scenario | Future, possible future, universe, multiverse |
| Meets requirements / outside limits | Survives / breaks / fails stress test |
| Pays 45 days late | DSO extension |
| Low point | Trough, minimum balance |

- Use “Preview fixes” for forecast comparisons; approval is a separate action.
- Describe the event sequence as “Projected impact,” not a chain reaction.
- The percentage is the weighted share of tested scenarios meeting requirements, not an unconditional probability.
- Every number has a unit and a date: "$2.9M on Nov 30".
- Every headline is a full answer, not a label.
- Expert words appear only inside the proof drawer.

---

## 7. Frontend workflow

1. Sketch and prototype directly in `/playground` with contract fixtures.
2. Review desktop and mobile screenshots against `skills/taste/SKILL.md`.
3. Build reusable props-only components from the tokens and behavior in this spec.
4. Wire reviewed components to Convex in the task that owns that screen.

Use Next.js on Vercel. Figma accounts, files, prototypes, and stage logs are outside the frontend scope.
