import { CompanyModelSchema, ConstraintSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { auditSnapshot } from "@domino/engine";
import { PROFILE_IDS, type ProfileId } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { deriveDashboard } from "../../components/field/dashboard/derive";
import { emptyOverlay, newWorld, servedSnapshot } from "../fieldFeed";
import { type Step, pauseReason, stepDays } from "../lib/clock";
import { STORYLINES, nextBeat } from "../lib/storylines";

const ORIGIN = "2026-10-30";
const model = CompanyModelSchema.parse({
  version: 1,
  customerDelayDays: {},
  recurringSpend: [],
  rules: [],
});
const constraints = fixtures.constraints.map((c) => ConstraintSchema.parse(c));

function play(profile: ProfileId, days: number): Step[] {
  let world = newWorld(1, profile);
  let overlay = emptyOverlay();
  const steps: Step[] = [];
  for (let d = 0; d < days; d++) {
    const step = stepDays(world, overlay, ORIGIN);
    steps.push(step);
    world = step.world;
    overlay = step.overlay;
  }
  return steps;
}

const opening = (s: ReturnType<typeof servedSnapshot>) =>
  s.cashOnHand - s.bankTxns.reduce((n, t) => n + t.amount, 0);

describe.each(PROFILE_IDS)("simulated clock: %s", (profile) => {
  const steps = play(profile, 30);

  it("is deterministic day by day", () => {
    const again = play(profile, 30);
    expect(again.map((s) => s.entries)).toEqual(steps.map((s) => s.entries));
    expect(again.at(-1)?.overlay).toEqual(steps.at(-1)?.overlay);
    expect(steps.map((s) => s.day)).toEqual(steps.map((_, i) => i + 1));
  });

  it("fires each storyline beat exactly on its day", () => {
    const fired = steps.flatMap((s) => s.fired.map((f) => [s.day, f.beatId] as const));
    expect(fired).toEqual(STORYLINES[profile].map((b) => [b.day, b.id] as const));
    expect(nextBeat(profile, steps.at(-1)?.overlay.story)).toBeNull();
  });

  it("keeps every source tie-out: the bank balance moves by exactly the bank lines", () => {
    const first = servedSnapshot(newWorld(1, profile), emptyOverlay());
    for (const s of steps) {
      const served = servedSnapshot(s.world, s.overlay);
      expect(opening(served)).toBe(opening(first));
      expect(new Set(served.bankTxns.map((t) => t.id)).size).toBe(served.bankTxns.length);
    }
  });
});

describe("storyline effects", () => {
  it("Osprey: the day-9 notice ends the top customer's billing and raises a flag", () => {
    const steps = play("kestrel-crunch", 16);
    const notice = steps[8];
    expect(notice?.fired[0]).toMatchObject({ kind: "customer_notice", date: "2026-11-08" });
    const before = servedSnapshot(steps[7]!.world, steps[7]!.overlay);
    const after = servedSnapshot(notice!.world, notice!.overlay);
    const f = auditSnapshot({
      snapshot: after,
      previous: before,
      detectedAt: "2026-11-08T00:00:00Z",
    });
    expect(f.some((x) => x.kind === "missing_expected" && x.severity === "high")).toBe(true);
    const health = (s: Step) =>
      deriveDashboard({ snapshot: servedSnapshot(s.world, s.overlay), model, constraints });
    const low = (s: Step) => {
      const r = health(s);
      return r.ok ? (r.view.lowest?.usable ?? 0) : Number.NaN;
    };
    // The forecast low drops once the notice and its dispute are known.
    expect(low(notice!)).toBeLessThan(low(steps[7]!));
    const bonus = steps[14]!;
    expect(bonus.fired[0]).toMatchObject({ kind: "bonus_payroll" });
    expect(low(bonus)).toBeLessThan(low(steps[13]!));
  });

  it("Kestrel: the re-sent bill on day 11 is a duplicate escalation", () => {
    const steps = play("kestrel", 11);
    const before = servedSnapshot(steps[9]!.world, steps[9]!.overlay);
    const after = servedSnapshot(steps[10]!.world, steps[10]!.overlay);
    const f = auditSnapshot({
      snapshot: after,
      previous: before,
      detectedAt: "2026-11-10T00:00:00Z",
    });
    expect(f.filter((x) => x.kind === "duplicate" && x.severity === "high")).toHaveLength(1);
  });

  it("Merlin: slipped payers' bank credits land 30 days later", () => {
    const steps = play("kestrel-late", 40);
    const slip = steps[3]!.fired[0];
    if (slip?.kind !== "payers_slip") throw new Error("expected a slip");
    const last = servedSnapshot(steps.at(-1)!.world, steps.at(-1)!.overlay);
    const world = steps.at(-1)!.world.snapshot;
    const credits = (s: typeof last) =>
      s.bankTxns.filter(
        (t) =>
          slip.customerIds.some((c) => t.id.startsWith(`bank_ach_${c}_`)) && t.date >= slip.date,
      );
    for (const t of credits(world)) expect(t.date >= slip.date).toBe(true);
    const moved = credits(last).map((t) => t.date);
    expect(moved.every((d) => d >= "2026-12-03")).toBe(true);
  });

  it("pauses after 13 simulated weeks or 60 minutes", () => {
    const base = { day: 10, sessionStartDay: 0, playStartedAt: 0, now: 1_000 };
    expect(pauseReason(base)).toBeNull();
    expect(pauseReason({ ...base, day: 91 })).toMatch(/13 simulated weeks/);
    expect(pauseReason({ ...base, now: 60 * 60_000 })).toMatch(/60 minutes/);
    expect(pauseReason({ ...base, day: 364, sessionStartDay: 300 })).toMatch(/limit/);
  });
});
