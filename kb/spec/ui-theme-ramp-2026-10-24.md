# Shared theme: clean finance dashboard (Ramp-inspired)

User direction, 2026-10-24: "Remake the UI theme to be cleaner like Ramp's. It should be a professional dashboard." This is an interpretation of that feel (light, calm, dense data), not a copy of Ramp's brand. No Ramp logo, colours or copy are used.

## What changed

- The default style is now the light theme (`ramp` id in `lib/style-registry.ts`, first in `STYLES`). `?style=original` and the stored choice still select Original, Hyphenate or shadcn. Invalid values now fall back to the light default.
- `/investigate` and `/case/2u` still pin `data-style="original"` (dark). Untouched.
- Tokens live in `app/globals.css`. Tailwind reads them through `tailwind.config.ts`; shadows are tokens too (`--shadow-xs` to `--shadow-lg`), so Original keeps Tailwind's stock depth.
- Primitives in `components/ui/` keep their APIs. New: `input.tsx`, `select.tsx` (native), `segmented.tsx` (radio group used like tabs), `page.tsx` (`PageHeader`, `Section`, `StatTile`). Badge gains `success` and `warning` variants.
- `AppShell`: white sticky top bar, logo, five page links with a 2px underline for the current page, then "2U case study" and a company switcher placeholder (names the company, does nothing yet).
- `/playground` has a new first section, Primitives (`components/ThemePrimitives.tsx`).

## Tokens (light default)

| Token | Value | Use |
| --- | --- | --- |
| `--background` | warm off-white `40 11% 96%` | Page |
| `--card`, `--popover` | white | Cards, menus, dialogs, top bar |
| `--foreground` | near-black `40 6% 9%` | Text |
| `--muted-foreground` | `40 4% 38%` (about 5.5:1 on white) | Labels, secondary text |
| `--primary` | near-black | Primary buttons, switch on, selected chips |
| `--primary-ink` | deep blue `221 60% 42%` | The one brand accent: links, focus ring, selected chart line. `text-primary`, `fill-primary` and `stroke-primary` read it |
| `--safe` / `--warning` / `--destructive` | muted green / amber / red | Meaning only: working, watch, broken rule. Text passes 4.5:1 on white |
| `--clay` | `24 62% 45%` | Recorded history in charts |
| `--border` / `--input` | `40 8% 89%` / `40 6% 82%` | 1px hairlines; inputs slightly stronger |
| `--radius` | 8px (`rounded-lg`), 6px (`rounded-md`) | Cards 8, controls 6 |
| `--control-h` / `--row-h` / `--card-pad` | 36px / 44px / 20px | Buttons and inputs / table rows / card padding |
| Shadows | `shadow-xs` on cards and controls, `shadow-lg` only for dialogs and sheets | Nearly flat |

Type: Inter. Headings get `-0.015em` tracking globally. Page title 28px semibold, section title 15px semibold, body 14px, labels 13px. Tables and `StatTile` values use `tabular-nums`.

## Do

- One page title (`PageHeader`). Group content in `Section`s; the heading sits above the card.
- Put KPIs in `StatTile`s in a grid (`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`). Pass pre-formatted values (`formatCents`) with a unit or date.
- Use `Section flush` around a `Table` so rows run edge to edge. Right-align money columns.
- Use the near-black `Button` for the one main action per area; `outline` for the rest.
- Use `Badge` `success` / `warning` / `destructive` for status, never the brand blue.

## Don't

- Don't use the blue ink for large fills or backgrounds. It marks links, focus and the selected item.
- Don't add gradients, glows or heavy shadows. Use a hairline border or spacing instead.
- Don't hardcode hex colours in feature code; use the tokens so Original and the other styles still work.
- Don't use green or red for decoration.

## Example

```tsx
<PageHeader eyebrow="Kestrel Data" title="Cash over the next 13 weeks" actions={<Button>Add event</Button>} />
<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <StatTile label="Lowest point" value={formatCents(low)} unit="Nov 16" delta="Under the limit" tone="negative" />
</div>
<Section title="Weekly cash" flush>
  <Table>…</Table>
</Section>
```

## Limits

- The look was built from the user's description and general knowledge of Ramp's public product style; no Ramp screens were inspected in this pass.
- Field and Timeline feature components were not edited. Some of them hardcode their own sizes or radii (for example `rounded-xl` cards), so their lanes should adopt these helpers.
- No dark variant of the new theme. Original remains the dark option.
- `Segmented` is a radio group, not ARIA tabs. Use links for page-level tabs.
