# Domino design spec

Status: v1, 2026-10-24. Owner: Micah. Read with `build-spec.md`.
Style: clean, calm, light. One accent color. A person with no finance knowledge must understand
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
| Past line | Solid, 2 px, dark grey. Area below it lightly filled. |
| Past event markers | Small circles on the line. Red outline for bad events, green for good. Label on hover. |
| Today line | Vertical, 1 px, dashed. Label "Today" at the top. |
| Base future | 2 px, dark grey, continues the past line. |
| Other futures | 1.25 px. Opacity scaled by probability (0.25 to 0.9). Survives: grey-green. Breaks: red after the break point, grey before it. |
| Break marker | Small red cross at `breaksAt`, on the line. |
| Survive marker | Small green check at the right end. |
| Selected future | 3 px, accent blue, label at the right end. Others fade to 0.15. |
| Lender's limit | Red dashed line on the future side only, label "Lender's limit $3M". |
| Y axis | Usable cash in $M, 4 ticks, light grid. No x-axis title; month labels only. |

### 3.3 Motion (this is the wow)

1. On load: the past line draws left to right (0.8 s). Then each future line grows out of the today point, one after another, 40 ms apart (the "multiverse" fan-out).
2. The resilience number counts up as lines finish.
3. "Apply fixes" toggle: every line morphs from its no-fix path to its with-fix path (0.6 s). Lines that now survive change from red to green. The score counts from 64% to 93%.
4. Hover a line: it brightens, a tooltip shows the universe label, chance, and low point.
5. Respect `prefers-reduced-motion`: skip the animation, show the end state.

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
| Background | white `#FFFFFF` | Page |
| Surface | `#F8F9FA` | Panels |
| Border | `#E5E7EB` | Card and panel borders |
| Text | `#111827` | Main text |
| Text muted | `#6B7280` | Labels, captions |
| Accent | `#2563EB` | Selected future, primary button |
| Danger | `#DC2626` | Broken rules, lender's limit, breaking futures |
| Safe | `#16A34A` | Surviving futures, working fixes |
| Font | Inter (or Geist) | Everything |
| Radius | 8 px | Cards, buttons |
| Spacing | 4 px steps | Use Tailwind spacing scale |

Dark mode is not in scope.

---

## 6. Words (copy rules)

| Do say | Do not say |
| --- | --- |
| Lender's limit | Covenant |
| Cash you can use | Liquidity, unrestricted cash |
| Future, possible future | Scenario, universe (except in the pitch) |
| Survives / breaks | Passes / fails stress test |
| Pays 45 days late | DSO extension |
| Low point | Trough, minimum balance |

- Every number has a unit and a date: "$2.9M on Nov 30".
- Every headline is a full answer, not a label.
- Expert words appear only inside the proof drawer.

---

## 7. Figma workflow (Figma track)

1. **Ideation:** sketch the main screen in Figma Design (30 min). Log it.
2. **Prototyping:** build the multiverse timeline as a clickable prototype in Figma Make (fan-out + fix toggle). Log it.
3. **Handoff:** turn on Figma's Dev Mode MCP server; coding agents read the frames and tokens. Log it.
4. **Code generation:** agents build components from the frames; we fix by hand. Log what broke.

Write each stage in `kb/stage-log.md` right after it ends.
