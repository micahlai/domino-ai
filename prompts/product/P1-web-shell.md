# P1 · Web shell + playground (Micah)

Tool: Claude Code. Branch: `P1-web-shell`. Folder: `apps/web`. Depends on: S0.
Skill files (in skills/): kb-sync, ui-build.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md, skills/ui-build/SKILL.md. Read AGENTS.md and kb/spec/design-spec.md §1, §5.

Create apps/web:
1. Next.js (App Router, TypeScript, Tailwind) in apps/web with package name "@domino/web". Use pnpm.
   Add "dev", "build", "typecheck" (tsc --noEmit) and "test" (vitest run --passWithNoTests) scripts so turbo picks them up.
2. shadcn/ui initialised (Button, Card, Badge, Sheet, Dialog, Switch, Tooltip, Skeleton, Separator, Table).
   Inter font. Tokens from design-spec §5 in tailwind config / CSS variables.
3. Convex: add the convex package, apps/web/convex/ folder with an empty schema.ts, ConvexClientProvider in the root layout.
   Run npx convex dev once so _generated exists (do not commit secrets).
4. transpilePackages: ["@domino/contracts"] in next.config. Import fixtures from "@domino/contracts/fixtures".
5. lib/format.ts: formatCents(cents) -> "$2.9M", "$240K", "$4,800"; formatDate(iso) -> "Nov 30". Unit tests.
6. Routes from design-spec §1 as empty pages with headings. /playground renders section stubs for every component in design-spec §4
   and the hero, each fed by fixtures.
7. Root "pnpm dev" must start Next and Convex together (turbo).

When done: pnpm check passes, the playground loads, board row P1, handoff.
```
