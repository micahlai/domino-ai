import { describe, expect, it } from "vitest";
import { weeklyBoundaryFixtures as fx } from "./fixtures";
import {
  type WeeklySeedV1,
  canonicalJson,
  contentHashPreimage,
  firstForecastWeek,
  parseWeeklyResultRefJson,
  parseWeeklySeedJson,
} from "./index";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const seed = fx.validKestrelWeeklySeed as WeeklySeedV1;
const pins = fx.WEEKLY_BOUNDARY_FIXTURE_HASHES.validKestrelWeeklySeed;
const edited = (edit: (s: WeeklySeedV1) => void) => {
  const s = clone(seed);
  edit(s);
  const r = parseWeeklySeedJson(JSON.stringify(s));
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("WeeklySeedV1", () => {
  it("accepts the Kestrel fixture as JSON text and its hashes recompute", async () => {
    const r = parseWeeklySeedJson(JSON.stringify(seed));
    expect(r.success).toBe(true);
    expect(seed.scheduledItems).toHaveLength(4);
    expect(seed.findings).toHaveLength(1);
    expect(await sha256(contentHashPreimage(seed))).toBe(seed.contentHash);
    expect(seed.contentHash).toBe(pins.contentHash);
    expect(await sha256(canonicalJson(seed))).toBe(pins.fixtureHash);
  });

  it("tampered copy is schema-valid but its recomputed hash differs", async () => {
    const t = fx.tamperedKestrelWeeklySeed as WeeklySeedV1;
    expect(parseWeeklySeedJson(JSON.stringify(t)).success).toBe(true);
    expect(await sha256(contentHashPreimage(t))).not.toBe(t.contentHash);
  });

  it("rejects bad dueWeek, non-Monday, duplicate ids and unknown fields", () => {
    expect(
      edited((s) => {
        s.scheduledItems[0]!.dueWeek = "2027-02-01";
      }),
    ).toContain("dueWeek is outside asOf..asOf+12 weeks");
    expect(
      edited((s) => {
        s.scheduledItems[0]!.dueWeek = "2026-11-03";
      }),
    ).toContain("expected a Monday (ISO week start)");
    expect(
      edited((s) => {
        s.asOf = "2026-11-09";
      }),
    ).toContain("asOf must be the first forecast week (first Monday after snapshot.asOf)");
    expect(
      edited((s) => {
        s.findings[0]!.id = s.scheduledItems[1]!.id;
      }),
    ).toContain("repeated id");
    expect(
      edited((s) => {
        s.company.id = "tally";
      }),
    ).toContain("company id differs from the snapshot company");
    expect(
      edited((s) => {
        s.scheduledItems[0]!.cents = 100;
      }),
    ).toContain("a payable or payroll item is an outflow (negative cents)");
    expect(edited((s) => Object.assign(s.snapshot, { secret: "x" }))).toContain(
      "field is not part of the contract (unknown field or omitted default)",
    );
  });

  it("never throws on hostile text", () => {
    for (const t of [undefined, 1, "", "{", "[]", "null", "[".repeat(100)])
      expect(parseWeeklySeedJson(t).success).toBe(false);
  });

  it("matches the engine first forecast week", () => {
    expect(firstForecastWeek("2026-10-30")).toBe("2026-11-02");
    expect(firstForecastWeek("2026-11-02")).toBe("2026-11-09");
  });
});

describe("WeeklyResultRefV1", () => {
  const ref = {
    seedId: seed.id,
    seedHash: seed.contentHash,
    kind: "scenario",
    branchIds: ["timeline:branch/acme-late"],
    route: "/c/kestrel",
    health: { rating: "watch", lowPointCents: 125_000_000, lowPointWeek: "2026-11-30" },
  };
  it("accepts a valid ref and rejects field drift, bad ids and non-Monday weeks", () => {
    expect(parseWeeklyResultRefJson(JSON.stringify(ref)).success).toBe(true);
    const bad = [
      { ...ref, extra: 1 },
      { ...ref, seedId: "field:seed/x" },
      { ...ref, branchIds: ["field:branch/x"] },
      { ...ref, route: "c/kestrel" },
      { ...ref, health: { ...ref.health, lowPointWeek: "2026-12-01" } },
      { ...ref, health: { ...ref.health, lowPointCents: 1.5 } },
    ];
    for (const b of bad) expect(parseWeeklyResultRefJson(JSON.stringify(b)).success).toBe(false);
  });
});
