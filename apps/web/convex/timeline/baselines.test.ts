/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import {
  type CompanyModel,
  type Constraint,
  type WeeklySeedV1,
  canonicalJson,
  contentHashPreimage,
} from "@domino/contracts";
import { weeklyBoundaryFixtures as wfx } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { timelineTables } from "../schemas/timeline.schema";
import { METHOD_VERSION } from "./baselines";
import { baselineRefs as r } from "./refs";

// Vite writes this folder's files as "./x.ts"; convex-test resolves paths from the convex root.
const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob(["../**/*.ts", "../_generated/*.js", "!../**/*.test.ts", "!./*.test.ts"]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;

const seed = wfx.validKestrelWeeklySeed as WeeklySeedV1;
const SEED_JSON = JSON.stringify(seed, null, 2);
const NEUTRAL: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const NOTE = "Neutral model: no customer delays or recurring spend. No extra rules.";
const MIN_CASH: Constraint = {
  id: "user_min_cash",
  label: "Keep usable cash above $3.5M",
  kind: "min_cash",
  limit: 350_000_000,
  evidence: { source: "document", ref: "timeline:assumption", note: "Stated by the user" },
};

afterEach(() => vi.restoreAllMocks());

type SaveArgs = FunctionArgs<typeof r.save>;
const args = (over: Partial<SaveArgs> = {}): SaveArgs => ({
  requestId: "req-baseline-1",
  seedJson: SEED_JSON,
  modelJson: JSON.stringify(NEUTRAL),
  constraintsJson: "[]",
  assumptionNote: NOTE,
  reviewed: true,
  ...over,
});
const save = (t: T, a: SaveArgs) => t.mutation(r.save, a);
const rows = (t: T) => t.run((ctx) => ctx.db.query("timelineBaselines").collect());

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** A seed edited after export and re-hashed, so only identity checks can reject it. */
async function rehashed(edit: (s: WeeklySeedV1) => WeeklySeedV1) {
  const next = edit(structuredClone(seed));
  return JSON.stringify({ ...next, contentHash: await sha256Hex(contentHashPreimage(next)) });
}

describe("timeline baselines", () => {
  it("saves the pinned Kestrel seed as an engine baseline and reopens it", async () => {
    const t = setup();
    const out = await save(t, args({ constraintsJson: JSON.stringify([MIN_CASH]) }));
    expect(out).toMatchObject({ companyId: "kestrel", created: true });
    expect(out.runId).toMatch(/^timeline:baseline\/[0-9a-f]{40}$/);

    const saved = await t.query(r.get, { companyId: "kestrel", runId: out.runId });
    if (!saved) throw new Error("expected a saved baseline");
    expect(saved.seedHash).toBe(
      wfx.WEEKLY_BOUNDARY_FIXTURE_HASHES.validKestrelWeeklySeed.contentHash,
    );
    expect(saved.companyName).toBe("Kestrel Data");
    expect(saved.methodVersion).toBe(METHOD_VERSION);
    expect(saved.seed).toEqual(seed);
    expect(saved.model).toEqual(NEUTRAL);
    expect(saved.constraints).toEqual([MIN_CASH]);
    const forecast = engine.forecast(seed.snapshot, NEUTRAL, []);
    expect(saved.forecast).toEqual(forecast);
    expect(saved.forecast.weeks).toHaveLength(13);
    expect(saved.forecast.weeks[0]?.weekStart).toBe(seed.asOf);
    expect(saved.dominoes).toEqual(
      engine.dominoes(forecast, [MIN_CASH], seed.snapshot, { model: NEUTRAL, changes: [] }),
    );
    expect(saved.history).toEqual(engine.history(seed.snapshot, 26));
    expect(saved.pastEvents).toEqual(engine.pastEvents(seed.snapshot, NEUTRAL));
    expect(Date.parse(saved.savedAt)).not.toBeNaN();
    expect(Object.keys(saved).sort()).toEqual(
      [
        "runId",
        "companyId",
        "companyName",
        "seedHash",
        "inputHash",
        "methodVersion",
        "assumptionNote",
        "model",
        "constraints",
        "seed",
        "forecast",
        "dominoes",
        "history",
        "pastEvents",
        "savedAt",
      ].sort(),
    );
  });

  it("reads saved output without running the engine, scoped to its company", async () => {
    const t = setup();
    const { runId } = await save(t, args());
    const spies = (["forecast", "dominoes", "history", "pastEvents"] as const).map((k) =>
      vi.spyOn(engine, k),
    );
    const saved = await t.query(r.get, { companyId: "kestrel", runId });
    expect(saved?.runId).toBe(runId);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(await t.query(r.get, { companyId: "other", runId })).toBeNull();
    expect(await t.query(r.get, { companyId: "kestrel", runId: "timeline:baseline/x" })).toBeNull();
  });

  it("rejects the tampered seed and writes nothing", async () => {
    const t = setup();
    await expect(
      save(t, args({ seedJson: JSON.stringify(wfx.tamperedKestrelWeeklySeed) })),
    ).rejects.toThrow(/contentHash does not match/);
    expect(await rows(t)).toHaveLength(0);
  });

  it.each([
    ["unreviewed", { reviewed: false }, /Review the assumptions/],
    ["bad request id", { requestId: "x" }, /requestId/],
    ["blank note", { assumptionNote: "  " }, /Assumption note/],
    ["seed not JSON", { seedJson: "{" }, /Seed:/],
    ["seed too large", { seedJson: " ".repeat(900_001) }, /too large/],
    ["model not JSON", { modelJson: "nope" }, /Model is not valid JSON/],
    ["model unknown field", { modelJson: JSON.stringify({ ...NEUTRAL, extra: 1 }) }, /not part/],
    [
      "unknown customer delay",
      {
        modelJson: JSON.stringify({
          ...NEUTRAL,
          customerDelayDays: { cus_nobody: { mean: 3, p90: 9, samples: 4 } },
        }),
      },
      /not in the seed/,
    ],
    [
      "fractional spend",
      {
        modelJson: JSON.stringify({
          ...NEUTRAL,
          recurringSpend: [{ label: "Tools", amount: 10.5, everyDays: 30 }],
        }),
      },
      /Model: recurringSpend/,
    ],
    [
      "inflow as spend",
      {
        modelJson: JSON.stringify({
          ...NEUTRAL,
          recurringSpend: [{ label: "Tools", amount: -100, everyDays: 30 }],
        }),
      },
      /positive integer cents/,
    ],
    ["constraints not array", { constraintsJson: "{}" }, /Constraints:/],
    [
      "fractional min cash",
      { constraintsJson: JSON.stringify([{ ...MIN_CASH, limit: 1.5 }]) },
      /integer cents/,
    ],
    ["repeated rule id", { constraintsJson: JSON.stringify([MIN_CASH, MIN_CASH]) }, /repeated/],
    [
      "pay by date without bill",
      { constraintsJson: JSON.stringify([{ ...MIN_CASH, kind: "pay_by_date", limit: 0 }]) },
      /must name a bill/,
    ],
    [
      "pay by date unknown bill",
      {
        constraintsJson: JSON.stringify([
          { ...MIN_CASH, kind: "pay_by_date", limit: 0, billId: "bill_missing" },
        ]),
      },
      /exist exactly once/,
    ],
    [
      "constraint unknown field",
      { constraintsJson: JSON.stringify([{ ...MIN_CASH, severity: "high" }]) },
      /not part/,
    ],
  ])("rejects %s without writing", async (_name, over, message) => {
    const t = setup();
    await expect(save(t, args(over))).rejects.toThrow(message);
    expect(await rows(t)).toHaveLength(0);
  });

  it("accepts a pay-by-date rule on a real bill", async () => {
    const t = setup();
    const rule = {
      ...MIN_CASH,
      id: "rent",
      kind: "pay_by_date",
      limit: 5,
      billId: "bill_rent_nov",
    };
    const { runId } = await save(t, args({ constraintsJson: JSON.stringify([rule]) }));
    const saved = await t.query(r.get, { companyId: "kestrel", runId });
    expect(saved?.constraints).toEqual([rule]);
  });

  it("returns the saved run on retry, conflicts on changed payload, survives concurrency", async () => {
    const t = setup();
    const first = await save(t, args());
    const again = await save(t, args({ seedJson: JSON.stringify(seed) }));
    expect(again).toEqual({ ...first, created: false });
    await expect(save(t, args({ constraintsJson: JSON.stringify([MIN_CASH]) }))).rejects.toThrow(
      /different inputs/,
    );
    await expect(save(t, args({ assumptionNote: "Other note" }))).rejects.toThrow(/different/);

    const [a, b] = await Promise.all([
      save(t, args({ requestId: "req-concurrent" })),
      save(t, args({ requestId: "req-concurrent" })),
    ]);
    expect(a.runId).toBe(b.runId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await rows(t)).toHaveLength(2);
  });

  it("changed assumptions make a new run and leave the old one unchanged", async () => {
    const t = setup();
    const old = await save(t, args());
    const before = await t.query(r.get, { companyId: "kestrel", runId: old.runId });
    const model = {
      ...NEUTRAL,
      version: 1,
      recurringSpend: [{ label: "Cloud", amount: 5_000_000, everyDays: 14 }],
    };
    const next = await save(
      t,
      args({ requestId: "req-baseline-2", modelJson: JSON.stringify(model) }),
    );
    expect(next.runId).not.toBe(old.runId);
    const saved = await t.query(r.get, { companyId: "kestrel", runId: next.runId });
    expect(saved?.seedHash).toBe(before?.seedHash);
    expect(saved?.inputHash).not.toBe(before?.inputHash);
    expect(saved?.forecast.lowPoint.usable).toBeLessThan(before?.forecast.lowPoint.usable ?? 0);
    expect(await t.query(r.get, { companyId: "kestrel", runId: old.runId })).toEqual(before);
  });

  it("rejects a different seed content under an already saved seed id", async () => {
    const t = setup();
    await save(t, args());
    const edited = await rehashed((s) => ({ ...s, exportedAt: "2026-10-30T19:00:00-07:00" }));
    await expect(save(t, args({ requestId: "req-baseline-3", seedJson: edited }))).rejects.toThrow(
      /different seed/,
    );
    expect(await rows(t)).toHaveLength(1);
  });

  it("rolls back when the engine fails after validation", async () => {
    const t = setup();
    vi.spyOn(engine, "dominoes").mockImplementation(() => {
      throw new Error("engine failed");
    });
    await expect(save(t, args())).rejects.toThrow(/engine failed/);
    expect(await rows(t)).toHaveLength(0);
  });

  it("writes no Field tables", async () => {
    const t = setup();
    await save(t, args({ constraintsJson: JSON.stringify([MIN_CASH]) }));
    const counts = await t.run(async (ctx) => {
      const out: Record<string, number> = {};
      // Every table outside this lane's fragment, without importing Field's schema.
      const others = Object.keys(schema.tables).filter((n) => !(n in timelineTables));
      for (const name of others as (keyof typeof schema.tables)[])
        out[name] = (await ctx.db.query(name).collect()).length;
      return out;
    });
    expect(Object.keys(counts)).toHaveLength(11);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    // The stored seed is canonical text, so its hash preimage is reproducible.
    const [row] = await rows(t);
    expect(row?.seedText).toBe(canonicalJson(seed));
  });
});
