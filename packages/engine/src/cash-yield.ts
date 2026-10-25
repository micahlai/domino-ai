import type { Change, Forecast } from "@domino/contracts";
import { addDays } from "./dates";
import { ratio, roundCents } from "./money";

const DAYS_PER_YEAR = 365n;
const BPS = 10_000n;

/**
 * Interest a scenario gains or gives up on the cash it holds above or below its parent line.
 *
 * Without this, a one-time payment only shifts the curve down: every later week adds the same
 * flows, so the lines stay parallel. Cash also earns interest, so a lower balance falls further
 * behind each week. Each week accrues `annualBps` simple interest over 7 days on that week's
 * closing gap, including interest already gained or lost, and books it on the week's last day.
 * Only the difference to the parent is charged, so the parent line itself never changes.
 */
export function cashYieldChanges(
  parent: Forecast,
  scenario: Forecast,
  annualBps: number,
): Change[] {
  if (!Number.isInteger(annualBps) || annualBps < 0)
    throw new Error(`interest rate must be whole basis points >= 0, got ${annualBps}`);
  if (
    parent.weeks.length !== scenario.weeks.length ||
    parent.weeks.some((w, i) => w.weekStart !== scenario.weeks[i]?.weekStart)
  )
    throw new Error("parent and scenario forecasts must cover the same weeks");
  const changes: Change[] = [];
  let carried = 0n;
  scenario.weeks.forEach((week, i) => {
    const gap = BigInt(week.closing - (parent.weeks[i]?.closing ?? 0)) + carried;
    // Round the size, then apply the sign, so a gain and a loss of equal size match.
    const size = roundCents(
      ratio((gap < 0n ? -gap : gap) * BigInt(annualBps) * 7n, BPS * DAYS_PER_YEAR),
    );
    if (size === 0) return;
    carried += gap < 0n ? -BigInt(size) : BigInt(size);
    const date = addDays(week.weekStart, 6);
    changes.push(
      gap < 0n
        ? {
            kind: "remove_cash",
            date,
            amount: size,
            label: `Interest not earned on lower cash, week of ${week.weekStart}`,
          }
        : {
            kind: "add_cash",
            date,
            amount: size,
            label: `Extra interest on higher cash, week of ${week.weekStart}`,
          },
    );
  });
  return changes;
}
