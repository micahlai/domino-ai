# FIELD chart date keys
- Goal: remove duplicate React date keys when today is Monday and shares forecast week date.
- Own: apps/web/components/field/dashboard/charts.tsx and focused chart tests only.
- Reproduce: live restart log /tmp/domino-field-next-3114.log contains duplicate key2023-11-27; cashLine includes today plus forecast same date.
- Fix: smallest stable identity includes point role/kind and date in all cash-line children/table; inspect actual/projected bars for same issue.
- Do not alter amounts, forecast, layout, APIs, globalstyles, map, other worker files, dependencies.
- Checks: regression rendering Monday/today+forecast without key warning, existing focused chart tests, scoped tsc/Biome/diff.
- Rules: AGENTS, separate branch/worktree; no providers/main/ports/push/merge/secrets/held-out.
- Result: pending.
