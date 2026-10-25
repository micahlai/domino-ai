/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryResponse } from "../../components/field/dashboard/data";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
// By name: _generated/api picks this module up only after the next codegen.
const summary = makeFunctionReference<"query", Record<string, never>, SummaryResponse>(
  "fieldDashboard:summary",
);

afterEach(() => {
  vi.useRealTimers();
});

describe("fieldDashboard.summary", () => {
  it("is null with no feed, then runs the engine on the latest ingested snapshot", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    expect(await t.query(summary, {})).toBeNull();

    const { companyId } = await t.mutation(api.field.setup, {});
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();

    const r = await t.query(summary, {});
    expect(r).toMatchObject({
      companyId,
      sources: { total: 6, connected: 6 },
      openFindings: 0,
      lastIngestStatus: "ok",
    });
    if (!r?.result?.ok) throw new Error("expected a dashboard view");
    const v = r.result.view;
    expect(v.asOf).toBe(r.asOf);
    expect(v.lenderMinimum).toEqual({ label: "Lender's minimum", cents: 300_000_000 });
    expect(v.cashLine).toHaveLength(14);
    expect(v.bars.filter((b) => b.kind === "projected")).toHaveLength(13);
  });
});
