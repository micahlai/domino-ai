# FIELD chart date keys
- Goal: remove duplicate React date keys when today is Monday and shares forecast week date.
- Own: apps/web/components/field/dashboard/charts.tsx and focused chart tests only.
- Reproduce: live restart log /tmp/domino-field-next-3114.log contains duplicate key2023-11-27; cashLine includes today plus forecast same date.
- Fix: smallest stable identity includes point role/kind and date in all cash-line children/table; inspect actual/projected bars for same issue.
- Do not alter amounts, forecast, layout, APIs, globalstyles, map, other worker files, dependencies.
- Checks: regression rendering Monday/today+forecast without key warning, existing focused chart tests, scoped tsc/Biome/diff.
- Rules: AGENTS, separate branch/worktree; no providers/main/ports/push/merge/secrets/held-out.
- Result: implemented role+date keys for actual/projected cash bars and today/week cash-line circles, labels, and table rows. Added focused same-date rendering and key-identity tests in `apps/web/components/field/dashboard/chart-date-keys.test.tsx`. Checks passed: focused Vitest (4 tests), web typecheck, scoped Biome, and `git diff --check`. Static server rendering does not emit React duplicate-key warnings, so the exact live warning was not reproduced in this test environment; the regression checks role identity directly.
