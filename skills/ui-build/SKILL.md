---
name: ui-build
description: Build Domino screens and components fast and consistently with Next.js, Tailwind, shadcn/ui, Convex and fixtures. Use for any work in apps/web.
---

# UI build

## Order of work

1. Read `kb/spec/design-spec.md` for the component (props, look, motion, words).
2. Build the component in `apps/web/components/<Name>.tsx` with props only (no data fetching).
3. Add a section to `/playground` that renders it with `@domino/contracts/fixtures`. Check it there first.
4. Then wire it into the page with Convex `useQuery` (functions in `kb/spec/convex-api.md`).
5. Run the checklist in `skills/taste/SKILL.md` on a screenshot before you call it done.

## Rules

- Use shadcn/ui components as they are (Button, Card, Sheet, Dialog, Badge, Switch, Tooltip). Do not design new primitives.
- Tailwind only. Colors and spacing from design-spec §5.
- Money: format only in the UI with one helper `formatCents(cents)` -> "$2.9M" / "$240K". Never do money math in the UI.
- Every number shows a unit and, if it is in time, a date.
- Loading: show a skeleton and a plain status line ("Reading the loan agreement..."). Never a blank screen.
- Charts: the hero timeline is custom SVG (d3-scale, d3-shape, motion). Other charts use Recharts.
- Respect `prefers-reduced-motion`.
- Components never import from `packages/engine` or `packages/agents`. Data comes from props or Convex.
