# H4a styles checkpoint: result and reference record (repair 1 applied)

Branch H4-ui-styles-motion from accepted H3 97925fd. Phase scope: registry, tokens, selector, persistence, URL override, SSR, portal/canvas colors, chart label fix, plus repair 1 (build fix, URL rules, navigation resync, shape tokens, comparison playground). Not done: activity components, any browser run or production build (C0 owns).

## Behavior
- Registry `apps/web/lib/style-registry.ts` (pure, no React; the server layout imports only this) and client store `lib/style.ts`: `original` (default), `ramp`, `hyphenate`, `shadcn`. Truth is `<html data-style>`; no provider, no remount, no data refetch. Switching only changes CSS variables.
- Precedence (changed in repair 1): if `?style=` is present it decides alone: valid id wins, invalid or empty means Original even when a choice is stored. Only an absent param uses the stored choice (`localStorage` `domino-style`), then Original. URL value is not stored. A valid URL works when `getItem` throws (storage is only read when the param is absent). An explicit selection is stored (kept in memory too if storage is blocked) and, if `?style=` is present, rewrites it with `history.replaceState`.
- Navigation resync: `components/StyleSync.tsx` (renders null, inside `<Suspense fallback={null}>` in AppShell) calls `useSearchParams` and re-derives the attribute on client navigation, back/forward and a removed override. It only sets `<html data-style>`; selector and canvas follow via the store and the existing MutationObserver. No remount, no data fetch.
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

Shape tokens (repair 1, `--control-h`, `--row-h`, `--card-pad`, `--overlay`) feed Button, Table head, Card and Dialog/Sheet scrims. Original equals the old sizes. Ramp: control 2.5rem, row 2.25rem, card pad 1.25rem (inferred density, not measured). Other styles keep defaults.

Comparison playground: `components/StyleComparison.tsx`, section `StyleComparison` at `/playground`. One fixed preview state (table, buttons, badge, open source panel, error and empty notes) drawn once per style by scoping `data-style` on a wrapper around the shared primitives. No queries, nothing stored, no app copies. The live Radix dialog/tooltip layers still follow only the page style. Hyphenate's grid background applies to the live page only, not the scoped panels.

Gaps: no per-style navigation layout or typography beyond palette, radius, border, shape tokens and Hyphenate background. The Ramp and Hyphenate looks follow only the public pages named above; nothing here claims a match to their private product screens. Not pixel-matched; no browser screenshots by this worker. Hyphenate danger (`340 80% 42%`) is close to its burgundy text; rely on labels/icons.

## Verified
- Repair 1, focused only: `tsc --noEmit`, `biome check apps/web`, `vitest run` in apps/web: 122 pass. New or changed rules: present-but-invalid URL beats stored value; valid URL with throwing `getItem` (pre-paint script); navigation resync incl. removed override; no attribute write when unchanged; explicit choice survives navigation with blocked storage; registry and layout stay free of the client store; every non-Original style defines all semantic colours and `--overlay`; comparison renders all four styles with source, error and empty states.
- Original 115-test checkpoint run covered registry, script parity, setStyle, blocked storage and SSR default.
- Not verified (C0): `next build` (the failure in /tmp/domino-H4a-build.log should be gone because layout no longer imports a module using `useSyncExternalStore`, and `useSearchParams` sits in Suspense, but I did not build), full `pnpm check`, browser, 375px header wrap (made `min-w-0`/`flex-wrap` on the selector and header group, not seen rendered), contrast, hydration/console, reduced motion.

## Activity gates (unchanged)
Live: none. Fixture: none yet. Unavailable: activity feed; waits on accepted H2 activity schema. Existing Motion (chart sweep, timeline) kept as is. No fake events.

## Files
New: `lib/style.ts`, `lib/style-registry.ts`, `lib/style.test.ts`, `components/StyleSelector.tsx`, `components/StyleSync.tsx`, `components/StyleComparison.tsx` (+ test). Repair 1 also changed `components/Playground.tsx`, `components/ui/{button,card,table,dialog,sheet}.tsx` (token classes only). Changed: `app/globals.css`, `app/layout.tsx`, `components/AppShell.tsx`, `components/historical/{HistoricalChart,HistoricalReplay}.tsx`, `components/multiverse/{MultiverseTimeline,TimelineParticles}.tsx`. Reused: Tailwind tokens, existing Radix primitives (untouched).
