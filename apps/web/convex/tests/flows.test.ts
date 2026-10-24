import { fixtures } from "@domino/contracts/fixtures";
/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
describe("product flow queries", () => {
  it("exposes only this company's latest validated event choices", async () => {
    const t = convexTest(schema, modules);
    const { companyId } = await t.mutation(internal.dev.seedFixtures.seed, {});
    const inputs = await t.query(api.eventInputs.get, { companyId });
    expect(inputs).toEqual({
      asOf: fixtures.snapshot.asOf,
      customers: fixtures.snapshot.customers,
      invoices: fixtures.snapshot.invoices,
    });
    expect(await t.query(api.capabilities.get, {})).toEqual({
      connect: false,
      addEvent: false,
      nextWeek: false,
      simulate: false,
      explain: false,
    });
    expect(
      await t.mutation(api.explanations.request, { companyId, branchId: "br_acme_late" }),
    ).toEqual({ requested: false });
  });
  it("does not request explanations for a branch in another company", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { companyId } = await t.mutation(internal.dev.seedFixtures.seed, {});
      const other = await t.mutation(api.companies.create, {
        name: "Other company",
        profile: "orbit",
      });
      expect(await t.query(api.eventInputs.get, { companyId: other })).toBeNull();
      await expect(
        t.mutation(api.explanations.request, { companyId: other, branchId: "br_acme_late" }),
      ).rejects.toThrow(/belong/);
      expect(await t.query(api.eventInputs.get, { companyId })).not.toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
