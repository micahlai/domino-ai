import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import {
  BranchSchema,
  CentsSchema,
  ChangeSchema,
  CompanyModelSchema,
  ConstraintSchema,
  FixCandidateSchema,
  RiskEventSchema,
  SnapshotSchema,
} from "./index";

describe("fixtures match the contracts", () => {
  it("snapshot", () => expect(() => SnapshotSchema.parse(fixtures.snapshot)).not.toThrow());
  it("constraints", () => {
    for (const c of fixtures.constraints) ConstraintSchema.parse(c);
  });
  it("model", () => expect(() => CompanyModelSchema.parse(fixtures.model)).not.toThrow());
  it("branches", () => {
    for (const b of fixtures.branches) BranchSchema.parse(b);
  });
  it("risks", () => {
    for (const r of fixtures.risks) RiskEventSchema.parse(r);
  });
  it("fixes", () => {
    for (const f of fixtures.fixes) FixCandidateSchema.parse(f);
  });
});

describe("forecast arithmetic in fixtures", () => {
  it("each week balances: opening + inflow - outflow = closing", () => {
    for (const b of fixtures.branches) {
      for (const w of b.forecast.weeks) {
        expect(w.opening + w.inflow - w.outflow).toBe(w.closing);
        expect(w.closing - fixtures.snapshot.restrictedCash).toBe(w.usable);
      }
    }
  });
  it("every fix branch has an event branch as parent", () => {
    const byId = new Map(fixtures.branches.map((b) => [b.id, b]));
    for (const b of fixtures.branches.filter((x) => x.kind === "fix")) {
      expect(byId.get(b.parentId ?? "")?.kind).toBe("event");
    }
  });
});

describe("contract rules", () => {
  it("money must be integer cents", () => {
    expect(() => CentsSchema.parse(10.5)).toThrow();
    expect(CentsSchema.parse(1050)).toBe(1050);
  });
  it("rejects unknown change kinds", () => {
    expect(() => ChangeSchema.parse({ kind: "wire_money", amount: 100 })).toThrow();
  });
});

describe("multiverse fixtures", () => {
  it("parse", async () => {
    const { ResilienceReportSchema, HistoryWeekSchema, PastEventSchema } = await import("./index");
    ResilienceReportSchema.parse(fixtures.resilience);
    ResilienceReportSchema.parse(fixtures.resilienceWithFixes);
    for (const h of fixtures.history) HistoryWeekSchema.parse(h);
    for (const p of fixtures.pastEvents) PastEventSchema.parse(p);
  });
  it("fixes make the company more resilient", () => {
    expect(fixtures.resilienceWithFixes.survivalRate).toBeGreaterThan(
      fixtures.resilience.survivalRate,
    );
    expect(fixtures.resilienceWithFixes.survivedCount).toBeGreaterThan(
      fixtures.resilience.survivedCount,
    );
  });
  it("history has 26 Mondays ending before today", () => {
    expect(fixtures.history).toHaveLength(26);
    expect(fixtures.history.at(-1)?.weekStart).toBe("2026-10-26");
  });
});
