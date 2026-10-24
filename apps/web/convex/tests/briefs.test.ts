import { fixtures } from "@domino/contracts/fixtures";
/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
describe("saved weekly briefs", () => {
  it("starts empty, upserts one brief per company/week, and picks the newest week", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await t.mutation(internal.dev.seedFixtures.seed, {});
    expect(await t.query(api.briefs.latest, { companyId })).toBeNull();
    const data = {
      companyId,
      week: "2026-10-26",
      text: "Original saved brief",
      evidence: [fixtures.constraints[0]?.evidence],
    };
    const first = await t.mutation(internal.briefs.save, data);
    expect(await t.mutation(internal.briefs.save, { ...data, text: "Updated saved brief" })).toBe(
      first,
    );
    await t.mutation(internal.briefs.save, {
      ...data,
      week: "2026-10-19",
      text: "Older week saved later",
    });
    expect(await t.query(api.briefs.latest, { companyId })).toMatchObject({
      week: "2026-10-26",
      text: "Updated saved brief",
      evidence: data.evidence,
    });
    expect(await t.run((ctx) => ctx.db.query("briefs").collect())).toHaveLength(2);
  });
  it("rejects impossible/non-Monday dates, future weeks, blank text and invalid evidence", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await t.mutation(internal.dev.seedFixtures.seed, {});
    const data = { companyId, week: "2026-10-26", text: "Saved brief", evidence: [] };
    for (const week of ["2026-10-27", "2026-02-30", "2026-11-02"])
      await expect(t.mutation(internal.briefs.save, { ...data, week })).rejects.toThrow();
    await expect(t.mutation(internal.briefs.save, { ...data, text: "  " })).rejects.toThrow();
    await expect(
      t.mutation(internal.briefs.save, { ...data, evidence: [{ source: "not-a-source" }] }),
    ).rejects.toThrow();
    expect(await t.query(api.briefs.latest, { companyId })).toBeNull();
  });
});
