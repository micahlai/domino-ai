/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { parseWeeklyResultRefJson } from "@domino/contracts";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOutput } from "../../components/timeline/analysis/api";
import { parseFinancialOutputJson } from "../../components/timeline/analysis/output";
import { api } from "../_generated/api";
import schema from "../schema";
import { analysisRefs } from "../timeline/analysis/refs";

// TL7 joint seam: Field books -> Timeline verified import -> saved run -> pointer back to Field.
const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**", "!../**/*.test.ts"]);

afterEach(() => {
  vi.useRealTimers();
});

async function crunchCompany() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
  return { t, companyId };
}

describe("fieldTimeline", () => {
  it("imports Osprey's latest books into Timeline and links the saved run back", async () => {
    const { t, companyId } = await crunchCompany();
    expect(await t.query(api.fieldTimeline.latest, { companyId })).toBeNull();
    await expect(
      t.action(api.fieldTimeline.openInTimeline, { companyId, reviewed: false }),
    ).rejects.toThrow(/Review/);

    const opened = await t.action(api.fieldTimeline.openInTimeline, { companyId, reviewed: true });
    expect(opened.timelineCompanyId).toBe("kestrel-crunch");
    expect(opened.route).toBe(
      `/c/kestrel-crunch/timeline?runId=${encodeURIComponent(opened.runId)}`,
    );
    expect(opened.analysisId).not.toBeNull();

    const exported = await t.query(api.field.exportSeed, { companyId });
    const link = await t.query(api.fieldTimeline.latest, { companyId });
    expect(link).toMatchObject({
      runId: opened.runId,
      seedId: exported.seedId,
      seedHash: exported.contentHash,
      current: true,
      analysisError: null,
    });

    // Same seed hash and result identity end to end.
    const ref = parseWeeklyResultRefJson(
      await t.query(api.timeline.workspace.resultRef, {
        companyId: "kestrel-crunch",
        runId: opened.runId,
      }),
    );
    expect(ref.success && ref.data.seedHash).toBe(exported.contentHash);

    // Field's lender minimum is frozen with the run, so Timeline rates the crunch at risk.
    const key = { companyId: "kestrel-crunch", runId: opened.runId };
    const text = await t.action(api.timeline.output.get, key);
    expect(readOutput(text, key)).toBe(text);
    const out = parseFinancialOutputJson(text);
    if (!out.success) throw new Error("invalid TL6 output");
    expect(out.data.health.rating).toBe("at_risk");
    expect(
      out.data.receipts.some((r) => r.constraintId === "con_lender_min" && r.status === "breached"),
    ).toBe(true);

    // Same books and assumptions reopen the same run instead of saving a copy.
    const again = await t.action(api.fieldTimeline.openInTimeline, { companyId, reviewed: true });
    expect(again).toMatchObject({ runId: opened.runId, created: false });
    expect(again.analysisId).toBe(opened.analysisId);
  });

  it("runs Timeline's automatic analysis to saved risk scenarios", async () => {
    const { t, companyId } = await crunchCompany();
    const opened = await t.action(api.fieldTimeline.openInTimeline, { companyId, reviewed: true });
    // Run the scheduled job directly (as Timeline's own acceptance test does); advancing fake
    // timers would also fire its 120-second expiry.
    const key = { companyId: opened.timelineCompanyId, analysisId: opened.analysisId ?? "" };
    await t.action(analysisRefs.execute, key);
    const receipt = await t.query(api.timeline.analysis.get, key);
    expect(receipt?.status).toBe("succeeded");
    expect(receipt?.risks.length).toBeGreaterThan(0);
  });
});
