# H4a styles checkpoint: result and reference record

Branch H4-ui-styles-motion from accepted H3 97925fd. Phase scope: registry, tokens, selector, persistence, URL override, SSR, portal/canvas colors, chart label fix. Not done: comparison playground, activity components, any browser run (C0 owns).

## Behavior
- Registry `apps/web/lib/style.ts`: `original` (default), `ramp`, `hyphenate`, `shadcn`. Truth is `<html data-style>`; no provider, no remount, no data refetch. Switching only changes CSS variables.
- Precedence: valid `?style=` > stored choice (`localStorage` `domino-style`) > Original. URL value is not stored. An explicit selection is stored and, if `?style=` is present, rewrites it with `history.replaceState`. Invalid URL/stored values fall back (stored value is used if the URL one is invalid).
- SSR: server and first client render are `original`; an inline pre-paint script (built from the registry) sets the attribute before first paint. `<html suppressHydrationWarning>` covers only that attribute.
- Selector: native radio group in the shared header (all pages, playground included). Keyboard: arrows, one tab stop.
- Portals (Radix dialog/sheet/tooltip) render under body and inherit the same variables. Canvas particles re-read variables through a MutationObserver (no remount); light styles use `multiply` instead of `lighter`.
- New token `--primary-ink` (accent for text/lines/chart marks; Original = mint, so unchanged). `.text-primary` and chart/timeline strokes use it, because Ramp lime is unreadable as text on white. Buttons keep `--primary`. Risk colors stay `destructive`/`safe` in every style.
- Chart fix: Knowledge cutoff and Disclosure published labels now sit on two rows (`HistoricalChart.tsx`, top margin 28 to 44). Geometry/scale untouched.

## Reference record (inspected 2026-10-24; no signup, no email)
| Style | Directly read | Inferred |
| --- | --- | --- |
| Ramp | ramp.com/expense-management CSS: page `#f4f2f0`, text `#0c0a08`, border `#d2cecb`, lime `#e4f222`, green `#18a957`, orange `#e96516`. One public product image (policy card): white rounded card, bordered square fields, pill chips on warm gray. | Lime-on-dark buttons, dark-green ink, 0.75rem radius, nav treatment. Fonts (Lausanne, IBM Plex) not used; Inter kept. ramp.com/reporting images and the gated tour were not seen. |
| Hyphenate | hyphenate.ai/platform CSS: burgundy `#790005`, orange `#ff6716`, off-white `#fdfcfa`, `#990b17`, green `#7dc57d`. Public OG image: dark burgundy field, faint grid, orange wordmark. | Light warm page `38 38% 94%`, burgundy text, grid background, 0.25rem radius, ink orange `20 100% 33%`, chart second series blue-gray. Fonts (saans, bwGradual) not used. App screens not seen. |
| shadcn | shadcn default zinc theme values (docs: ui.shadcn.com/docs/theming), Tailwind 3 HSL tokens. | `--safe`, `--clay`, danger text. |
| Original | Existing tokens, unchanged. Baseline `/tmp/domino-H3-r1-desktop.png`. | |

Gaps: no per-style density, navigation layout or typography beyond palette, radius, border and Hyphenate background. Not pixel-matched; no browser screenshots by this worker. Hyphenate danger (`340 80% 42%`) is close to its burgundy text; rely on labels/icons.

## Verified
- `tsc --noEmit`, `biome check apps/web`, `vitest run` in apps/web: 115 pass (new `lib/style.test.ts`: registry, invalid values, URL vs storage, pre-paint script parity, setStyle attribute/storage/URL, blocked storage, SSR default).
- Not verified: browser, contrast, mobile, console/hydration, reduced motion, build, full check.

## Activity gates (unchanged)
Live: none. Fixture: none yet. Unavailable: activity feed; waits on accepted H2 activity schema. Existing Motion (chart sweep, timeline) kept as is. No fake events.

## Files
New: `lib/style.ts`, `lib/style.test.ts`, `components/StyleSelector.tsx`. Changed: `app/globals.css`, `app/layout.tsx`, `components/AppShell.tsx`, `components/historical/{HistoricalChart,HistoricalReplay}.tsx`, `components/multiverse/{MultiverseTimeline,TimelineParticles}.tsx`. Reused: Tailwind tokens, existing Radix primitives (untouched).
