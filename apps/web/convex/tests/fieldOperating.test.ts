/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { parseWeeklySeedJson } from "@domino/contracts";
import {
  OPERATING_PRIMARY_COMPANY_IDS,
  OPERATING_SCENARIO_IDS,
  operatingProvenance,
} from "@domino/sim";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**", "!../**/*.test.ts"]);

afterEach(() => vi.useRealTimers());

describe("fieldOperating", { timeout: 60_000 }, () => {
  it("ensures all twelve primary worlds without replacing the two legacy worlds", async () => {
    const t = convexTest(schema, modules);
    const choices = [
      ...OPERATING_PRIMARY_COMPANY_IDS.flatMap((company) =>
        OPERATING_SCENARIO_IDS.map((scenario) => ({ company, scenario })),
      ),
      { company: "asana-inspired" as const, scenario: "baseline" as const },
      { company: "gitlab-inspired" as const, scenario: "baseline" as const },
    ];
    const ids = new Set<string>();
    for (const selection of choices) {
      const created = await t.mutation(api.fieldOperating.ensure, selection);
      expect(created.created).toBe(true);
      expect(ids.has(created.companyId)).toBe(false);
      ids.add(created.companyId);
      expect(await t.query(api.fieldOperating.context, { companyId: created.companyId })).toEqual(
        operatingProvenance(selection),
      );
      expect(await t.mutation(api.fieldOperating.ensure, selection)).toEqual({
        ...created,
        created: false,
      });
    }
    expect(await t.query(api.fieldOperating.list, {})).toHaveLength(choices.length);
  });

  it("creates only the selected scenario, returns the same feed, and exposes its provenance", async () => {
    const t = convexTest(schema, modules);
    const legacy = await t.mutation(api.field.setup, { profile: "kestrel" });
    const selection = { company: "2u", scenario: "baseline" } as const;
    const first = await t.mutation(api.fieldOperating.ensure, selection);
    const again = await t.mutation(api.fieldOperating.ensure, selection);
    expect(first.created).toBe(true);
    expect(again).toEqual({ ...first, created: false });
    expect(await t.query(api.fieldOperating.list, {})).toEqual([
      {
        companyId: first.companyId,
        ...selection,
        name: first.name,
        replayOf: null,
        started: false,
      },
    ]);
    expect(await t.query(api.fieldOperating.context, { companyId: first.companyId })).toEqual(
      operatingProvenance(selection),
    );
    expect(await t.query(api.fieldOperating.context, { companyId: legacy.companyId })).toBeNull();
    expect(await t.query(api.field.status, { companyId: legacy.companyId })).not.toBeNull();
    const tools = await t.query(api.connections.list, { companyId: first.companyId });
    expect(tools?.tools.find((tool) => tool.tool === "plaid")?.status).toBe("connected");
    expect(tools?.tools.find((tool) => tool.tool === "nessie")?.status).toBe("disconnected");
  });

  it("replays a company as a fresh idle copy without touching the original", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const selection = { company: "2u", scenario: "late-payments" } as const;
    const original = await t.mutation(api.fieldOperating.ensure, selection);
    await t.mutation(api.fieldAgents.start, { companyId: original.companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const copy = await t.mutation(api.fieldOperating.replay, { companyId: original.companyId });
    expect(copy.replayOf).toBe(original.companyId);
    expect(copy.companyId).not.toBe(original.companyId);
    // ensure still returns the original; the copy is idle and the original keeps its data.
    expect((await t.mutation(api.fieldOperating.ensure, selection)).companyId).toBe(
      original.companyId,
    );
    expect((await t.query(api.fieldAgents.state, { companyId: copy.companyId }))?.phase).toBe(
      "idle",
    );
    expect((await t.query(api.fieldAgents.state, { companyId: original.companyId }))?.started).toBe(
      true,
    );
    const listed = await t.query(api.fieldOperating.list, {});
    expect(listed.map((r) => [r.companyId, r.replayOf, r.started])).toEqual([
      [original.companyId, null, true],
      [copy.companyId, original.companyId, false],
    ]);
    // A replay of a replay still points at the original.
    const again = await t.mutation(api.fieldOperating.replay, { companyId: copy.companyId });
    expect(again.replayOf).toBe(original.companyId);
  });

  it("starts with only the chosen sources and refuses to drop the bank", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { companyId } = await t.mutation(api.fieldOperating.ensure, {
      company: "asana-current",
      scenario: "baseline",
    });
    const tools = (await t.query(api.fieldAgents.state, { companyId }))!.tools;
    await expect(
      t.mutation(api.fieldAgents.start, {
        companyId,
        sources: tools.filter((tool) => tool !== "plaid"),
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.fieldAgents.start, {
        companyId,
        sources: tools.filter((tool) => tool !== "stripe"),
      }),
    ).rejects.toThrow();
    const keep = tools.filter((tool) => tool !== "ramp");
    await t.mutation(api.fieldAgents.start, { companyId, sources: keep });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const state = await t.query(api.fieldAgents.state, { companyId });
    expect(state?.tools).toEqual(keep);
    expect(state?.phase).toBe("ready");
  });

  it("exports the ingested operating books under a unique scenario identity", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const baseline = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "baseline",
    });
    await t.mutation(api.fieldAgents.start, { companyId: baseline.companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const exported = await t.query(api.field.exportSeed, { companyId: baseline.companyId });
    const parsed = parseWeeklySeedJson(exported.json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.company.id).toBe("operating/2u/baseline");
    expect(parsed.data.snapshot.companyId).toBe("operating/2u/baseline");
    expect(parsed.data.snapshot.cashOnHand).toBeGreaterThan(0);
    const opened = await t.action(api.fieldTimeline.openInTimeline, {
      companyId: baseline.companyId,
      reviewed: true,
    });
    expect(opened.timelineCompanyId).toBe("operating/2u/baseline");
    expect(opened.route).toContain("/c/operating%2F2u%2Fbaseline/timeline");
    const saved = await t.query(api.timeline.baselines.get, {
      companyId: opened.timelineCompanyId,
      runId: opened.baselineRunId,
    });
    expect(saved?.seed.snapshot).toEqual(parsed.data.snapshot);
    expect(saved?.assumptionNote).toContain(
      "Based on 2U public filings, with reconstructed operating data.",
    );
    expect(saved?.assumptionNote).toContain("The imported rules are illustrative");

    const late = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "late-payments",
    });
    expect(late.companyId).not.toBe(baseline.companyId);
    expect(await t.query(api.fieldOperating.list, {})).toHaveLength(2);
  });

  it("gives a fresh demo copy its own Timeline baseline after its first books", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const original = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "baseline",
    });
    const copy = await t.mutation(api.fieldOperating.resetDemo, {
      companyId: original.companyId,
    });
    expect(await t.query(api.fieldTimeline.latest, { companyId: copy.companyId })).toBeNull();
    for (let i = 0; i < 4; i++) {
      vi.runOnlyPendingTimers();
      await t.finishInProgressScheduledFunctions();
    }
    const link = await t.query(api.fieldTimeline.latest, { companyId: copy.companyId });
    expect(link?.timelineCompanyId).toBe("operating/2u/baseline");
    expect(link?.seedId).toContain(copy.companyId);
    expect(await t.query(api.fieldTimeline.latest, { companyId: original.companyId })).toBeNull();
  });
});
