import { describe, expect, it } from "vitest";
import { TODAY0, WEEK0, addDays } from "./basics.ts";
import {
  PROFILE_IDS,
  advanceProfileDays,
  advanceProfileWeek,
  createProfileCompany,
  profileWorldOn,
} from "./index.ts";

// The simulated clock's day-by-day step (convex/fieldClock.ts): pure, deterministic, and the
// same world a weekly advance reaches.
describe.each(PROFILE_IDS)("day-by-day %s", (id) => {
  const start = createProfileCompany(id, 1);

  it("matches the weekly world on week boundaries", () => {
    expect(profileWorldOn(id, 1, TODAY0)).toEqual(start);
    let daily = start;
    for (let d = 0; d < 7; d++) daily = advanceProfileDays(daily);
    expect(daily).toEqual(advanceProfileWeek(start));
    expect(daily).toEqual(createProfileCompany(id, 1, WEEK0 + 1));
  });

  it("is deterministic and only ever adds bank lines dated on the new day", () => {
    let world = start;
    for (let d = 1; d <= 14; d++) {
      const next = advanceProfileDays(world);
      expect(advanceProfileDays(world)).toEqual(next);
      expect(next.today).toBe(addDays(TODAY0, d));
      expect(next.week).toBe(WEEK0 + Math.floor(d / 7));
      const before = new Set(world.snapshot.bankTxns.map((t) => t.id));
      const added = next.snapshot.bankTxns.filter((t) => !before.has(t.id));
      for (const t of added) expect(t.date).toBe(next.today);
      const delta = added.reduce((n, t) => n + t.amount, 0);
      // Lines leave the observed window only from its start, never near today.
      expect(next.snapshot.cashOnHand - world.snapshot.cashOnHand).toBe(delta);
      world = next;
    }
  });

  it("refuses days before the creation date", () => {
    expect(() => profileWorldOn(id, 1, addDays(TODAY0, -1))).toThrow(/or later/);
    expect(() => advanceProfileDays(start, 0)).toThrow(/positive/);
  });
});
