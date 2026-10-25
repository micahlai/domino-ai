import { canonicalJson } from "@domino/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixtureRoot, fixtureScenario } from "../workspace/fixtures";
import { type AnalysisActions, AnalysisView } from "./AnalysisView";
import { analysisHref, canAnalyze, canRetry, readAnalyses, readAnalysis, readOutput } from "./api";
import { fixtureAnalysis, fixtureAttempt, fixtureAnalysisRun as fixtureRules } from "./fixtures";
import { type FinancialOutput, healthFor } from "./output";

const key = {
  companyId: fixtureRules.companyId,
  runId: fixtureRules.runId,
  analysisId: fixtureAnalysis.analysisId,
};
const mutate = (f: (r: typeof fixtureAnalysis) => void) => {
  const r = structuredClone(fixtureAnalysis);
  f(r);
  return r;
};
const unreadable = (raw: unknown) =>
  expect(readAnalysis(raw, key, fixtureRules).state).toBe("unusable");
describe("frozen analysis reads", () => {
  it("reads exact saved receipt with fractional weights and discount", () => {
    expect(readAnalysis(fixtureAnalysis, key, fixtureRules)).toEqual({
      state: "ready",
      value: fixtureAnalysis,
    });
    expect(readAnalyses([fixtureAnalysis], key, fixtureRules).state).toBe("ready");
  });
  it.each(["queued", "running", "succeeded", "partial", "failed"] as const)(
    "accepts real %s operation lifecycle",
    (status) => {
      const r = fixtureAttempt(status);
      expect(readAnalysis(r, { ...key, analysisId: r.analysisId }).state).toBe("ready");
    },
  );
  it("separates pending, failed reads and missing records", () => {
    expect(readAnalysis(undefined, key).state).toBe("loading");
    expect(readAnalysis(new Error(), key).state).toBe("error");
    expect(readAnalysis(null, key).state).toBe("missing");
  });
  it("pins company, source, analysis, fingerprint and rules", () => {
    for (const field of [
      "companyId",
      "runId",
      "analysisId",
      "inputHash",
      "constraintVersion",
    ] as const)
      unreadable(
        mutate((r) => {
          r[field] = "different";
        }),
      );
  });
  it("rejects unknown top-level and nested stripped fields", () => {
    unreadable({ ...fixtureAnalysis, secret: "extra" });
    unreadable(
      mutate((r) => {
        Object.assign(r.risks[0]!.evidence[0]!, { secret: "extra" });
      }),
    );
  });
  it("rejects unsafe or fractional money without rejecting fractional weights", () => {
    unreadable(
      mutate((r) => {
        r.risks[0]!.forecast.weeks[0]!.usable = Number.MAX_SAFE_INTEGER + 1;
      }),
    );
    unreadable(
      mutate((r) => {
        r.responses[0]!.gainCents = 1.5;
      }),
    );
    unreadable(
      mutate((r) => {
        r.risks[0]!.receipts[0]!.limit = 1.5;
      }),
    );
  });
  it("rejects impossible dates, missing week and false low point", () => {
    unreadable(
      mutate((r) => {
        r.risks[0]!.forecast.weeks[0]!.weekStart = "2026-02-30";
      }),
    );
    unreadable(
      mutate((r) => {
        r.risks[0]!.forecast.weeks.pop();
      }),
    );
    unreadable(
      mutate((r) => {
        r.risks[0]!.forecast.lowPoint.usable = -123;
      }),
    );
  });
  it("rejects orphaned responses, duplicates and more than two responses per risk", () => {
    unreadable(
      mutate((r) => {
        r.responses[0]!.riskId = "missing";
      }),
    );
    unreadable(
      mutate((r) => {
        r.risks.push(r.risks[0]!);
      }),
    );
    unreadable(
      mutate((r) => {
        r.responses.push({ ...r.responses[0]!, id: "second" }, { ...r.responses[0]!, id: "third" });
      }),
    );
  });
  it("rejects lifecycle contradictions and impossible resilience counts/index", () => {
    unreadable(
      mutate((r) => {
        r.finishedAt = null;
      }),
    );
    unreadable(
      mutate((r) => {
        r.operation.status = "running";
      }),
    );
    unreadable(
      mutate((r) => {
        r.resilience!.weightedScenarioIndex = 50;
      }),
    );
    unreadable(
      mutate((r) => {
        r.resilience!.survivedCount = 99;
      }),
    );
  });
  it("rejects mixed-company history, repeated ids and overflow rather than dropping them", () => {
    expect(readAnalyses([{ ...fixtureAnalysis, companyId: "other" }], key).state).toBe("unusable");
    expect(readAnalyses([fixtureAnalysis, fixtureAnalysis], key).state).toBe("unusable");
    expect(
      readAnalyses(
        Array.from({ length: 21 }, () => fixtureAnalysis),
        key,
      ).state,
    ).toBe("unusable");
  });
  it("restricts analysis to baselines and rules-only runs, and retries to terminal failures", () => {
    expect(canAnalyze(fixtureRoot)).toBe(true);
    expect(canAnalyze(fixtureRules)).toBe(true);
    expect(canAnalyze(fixtureScenario)).toBe(false);
    expect(canAnalyze({ ...fixtureRules, changes: fixtureScenario.changes })).toBe(false);
    expect(canRetry(fixtureAttempt("partial"))).toBe(true);
    expect(canRetry(fixtureAttempt("failed"))).toBe(true);
    expect(canRetry(fixtureAttempt("running"))).toBe(false);
  });
  it("encodes both ids in saved links", () => {
    const href = analysisHref("a/b", "timeline:run/a&b", "timeline:analysis/a?b");
    expect(href).toBe(
      "/c/a%2Fb/timeline/analysis?runId=timeline%3Arun%2Fa%26b&analysisId=timeline%3Aanalysis%2Fa%3Fb",
    );
  });
});

const actions: AnalysisActions = {
  start: vi.fn(async () => ({ ok: true as const })),
  retry: vi.fn(async () => ({ ok: true as const })),
  exportOutput: vi.fn(async () => ({ ok: false as const, message: "fixture" })),
};
function screen(receipt = fixtureAnalysis, over: Partial<Parameters<typeof AnalysisView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(AnalysisView, {
      run: fixtureRules,
      selected: { state: "ready", value: receipt },
      history: { state: "ready", value: [receipt] },
      actions,
      ...over,
    }),
  );
}
describe("analysis screens stay read-only until reviewed", () => {
  it("does not call mutations or output on opening saved results", () => {
    const html = screen();
    expect(actions.start).not.toHaveBeenCalled();
    expect(actions.retry).not.toHaveBeenCalled();
    expect(actions.exportOutput).not.toHaveBeenCalled();
    expect(html).toContain('data-testid="analysis-review"');
    expect(html).toMatch(/disabled=""[^>]*data-testid="analysis-start"/);
    expect(html).toContain("not a probability of survival");
    expect(html).toContain("50%");
    expect(html).toContain("Open this saved risk timeline");
    expect(html).toContain("Show proof");
  });
  it("describes partial results/retry and unknown rule scope plainly", () => {
    const html = screen(fixtureAttempt("partial"));
    expect(html).toContain("Some results could not be completed");
    expect(html).toContain("Start another attempt");
    expect(html).toContain("unknown or beyond-horizon rule is not confirmed compliance");
  });
  it("shows bounded waiting and expired failure without hiding the saved history", () => {
    expect(screen(fixtureAttempt("queued"))).toContain("Analysis is in progress");
    const html = screen(fixtureAttempt("failed"));
    expect(html).toContain("LEASE_EXPIRED");
    expect(html).toContain("Saved analysis attempts");
  });
  it("explains why an event scenario cannot launch", () => {
    const html = screen(fixtureAnalysis, {
      run: fixtureScenario,
      selected: null,
      history: { state: "ready", value: [] },
    });
    expect(html).toContain("This timeline already includes events");
    expect(html).toMatch(/disabled=""[^>]*data-testid="analysis-start"/);
  });
  it("offers costs and all financial values behind accessible controls", () => {
    const html = screen();
    expect(html).toContain("Inspect exact weekly cash");
    expect(html).toContain("Show simulated event inputs");
    expect(html).toContain("With fix: Offer early-payment terms");
    expect(html).toContain("Developer data");
    expect(html).toContain("weekly close");
  });
});

describe("download boundaries", () => {
  it("refuses missing, wrong-version, malformed and overlarge financial output", () => {
    for (const raw of [
      null,
      {},
      "no",
      canonicalJson({ schemaVersion: 2, companyId: key.companyId, runId: key.runId }),
      " ".repeat(900_001),
    ])
      expect(readOutput(raw, key)).toBeUndefined();
  });
});

describe("confirmed write delivery", () => {
  it("reuses the same id after a lost reply, then uses a new id after confirmed success", async () => {
    const { RequestLedger } = await import("../workspace/requests");
    const { requestAnalysis } = await import("./requests");
    let next = 0;
    const ledger = new RequestLedger(() => `request-${++next}`);
    const start = vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockResolvedValue({
      companyId: key.companyId,
      analysisId: "timeline:analysis/saved",
      created: true,
    });
    const retry = vi.fn();
    const args = { companyId: key.companyId, runId: key.runId };
    expect((await requestAnalysis(args, null, ledger, { start, retry })).ok).toBe(false);
    expect((await requestAnalysis(args, null, ledger, { start, retry })).ok).toBe(true);
    expect((await requestAnalysis(args, null, ledger, { start, retry })).ok).toBe(true);
    expect(start.mock.calls.map((x) => x[0].requestId)).toEqual([
      "request-1",
      "request-1",
      "request-2",
    ]);
    expect(start.mock.calls[0]![0]).toEqual({ ...args, requestId: "request-1", reviewed: true });
    expect(retry).not.toHaveBeenCalled();
  });
  it("pins retries to the old receipt and rejects mismatched results", async () => {
    const { RequestLedger } = await import("../workspace/requests");
    const { requestAnalysis } = await import("./requests");
    const ledger = new RequestLedger(() => "fixed");
    const start = vi.fn();
    const retry = vi.fn(async () => ({
      companyId: "wrong-company",
      analysisId: "timeline:analysis/other",
      created: true,
    }));
    expect((await requestAnalysis(key, "timeline:analysis/old", ledger, { start, retry })).ok).toBe(
      false,
    );
    expect(retry).toHaveBeenCalledWith({
      companyId: key.companyId,
      analysisId: "timeline:analysis/old",
      requestId: "fixed",
      reviewed: true,
    });
    expect(start).not.toHaveBeenCalled();
  });
});

function financialFixture(): FinancialOutput {
  const runId = "timeline:workspace/export-fixture";
  const route = `/c/${encodeURIComponent(key.companyId)}/timeline?runId=${encodeURIComponent(runId)}`;
  return {
    schemaVersion: 1,
    methodVersion: "timeline_financial_output@1.0.0",
    companyId: key.companyId,
    runId,
    baselineRunId: "timeline:baseline/fixture",
    seedId: fixtureRules.baseline.seed.id,
    seedHash: fixtureRules.baseline.seedHash,
    inputHash: fixtureRules.inputHash,
    constraintVersion: fixtureRules.constraintVersion,
    savedAt: fixtureRules.savedAt,
    resultRef: {
      seedId: fixtureRules.baseline.seed.id,
      seedHash: fixtureRules.baseline.seedHash,
      kind: "forecast",
      branchIds: [runId],
      route,
      health: {
        rating: "ok",
        lowPointCents: fixtureRules.forecast.lowPoint.usable,
        lowPointWeek: fixtureRules.forecast.lowPoint.weekStart,
      },
    },
    health: healthFor(fixtureRules.forecast, fixtureRules.receipts),
    receipts: fixtureRules.receipts,
    chart: {
      history: fixtureRules.baseline.history,
      forecast: fixtureRules.forecast,
      lowPoint: fixtureRules.forecast.lowPoint,
      runwayMonths: null,
    },
    scenarios: [],
    scenariosTruncated: false,
  };
}
describe("strict financial export", () => {
  it("offers verified JSON only for the same run, with fractional runway receipts preserved", () => {
    const output = financialFixture();
    const outputKey = { companyId: output.companyId, runId: output.runId };
    const json = canonicalJson(output);
    expect(readOutput(json, outputKey)).toBe(json);
    const fractional = structuredClone(output);
    fractional.receipts = [
      {
        ...fractional.receipts[0]!,
        kind: "min_runway_months",
        unit: "months",
        limit: 4.5,
        value: null,
        shortfall: null,
        status: "unable",
        relation: "unable",
      },
    ];
    fractional.health = healthFor(fractional.chart.forecast, fractional.receipts);
    fractional.resultRef.health!.rating = "watch";
    expect(readOutput(canonicalJson(fractional), outputKey)).toBeDefined();
    expect(readOutput(json, { ...outputKey, runId: "timeline:workspace/another" })).toBeUndefined();
  });
  it("rejects hidden fields, unsafe cash, missing rule proof and a pointer to another run", () => {
    const output = financialFixture();
    const outputKey = { companyId: output.companyId, runId: output.runId };
    expect(
      readOutput(canonicalJson({ ...output, privateField: "extra" }), outputKey),
    ).toBeUndefined();
    expect(
      readOutput(canonicalJson({ ...output, receipts: undefined }), outputKey),
    ).toBeUndefined();
    const unsafe = structuredClone(output);
    unsafe.chart.forecast.weeks[0]!.usable = Number.MAX_SAFE_INTEGER + 1;
    expect(readOutput(canonicalJson(unsafe), outputKey)).toBeUndefined();
    const wrong = structuredClone(output);
    wrong.resultRef.branchIds = ["timeline:workspace/elsewhere"];
    expect(readOutput(canonicalJson(wrong), outputKey)).toBeUndefined();
  });
});

describe("per-rule proof identity", () => {
  it("accepts separate set and individual rule versions for both risks and responses", () => {
    expect(fixtureAnalysis.constraintVersion).not.toBe(fixtureRules.receipts[0]!.constraintVersion);
    expect(readAnalysis(fixtureAnalysis, key, fixtureRules).state).toBe("ready");
    expect(readAnalyses([fixtureAnalysis], key, fixtureRules).state).toBe("ready");
  });
  it("rejects changed versions, ids, kinds and limits against source proof", () => {
    for (const field of ["constraintVersion", "constraintId", "kind", "limit"] as const) {
      for (const kind of ["risks", "responses"] as const) {
        const raw = mutate((r) => {
          const proof = r[kind][0]!.receipts[0]!;
          if (field === "limit") proof.limit++;
          else if (field === "kind") proof.kind = "pay_by_date";
          else proof[field] = "wrong";
        });
        expect(readAnalysis(raw, key, fixtureRules).state).toBe("unusable");
        expect(readAnalyses([raw], key, fixtureRules).state).toBe("unusable");
      }
    }
  });
  it("rejects missing or extra rule proof rather than implying full compliance", () => {
    for (const kind of ["risks", "responses"] as const) {
      const missing = mutate((r) => {
        r[kind][0]!.receipts = [];
      });
      unreadable(missing);
      expect(readAnalyses([missing], key, fixtureRules).state).toBe("unusable");
      const extra = mutate((r) => {
        r[kind][0]!.receipts.push({ ...r[kind][0]!.receipts[0]!, constraintId: "extra" });
      });
      unreadable(extra);
    }
  });
  it("accepts the backend evidence cap of100 and rejects101", () => {
    const hundred = mutate((r) => {
      for (const x of [...r.risks, ...r.responses])
        x.evidence = Array.from({ length: 100 }, (_, i) => ({
          source: "document",
          ref: `record-${i}`,
          note: "Bounded record evidence.",
        }));
    });
    expect(readAnalysis(hundred, key, fixtureRules).state).toBe("ready");
    unreadable(
      mutate((r) => {
        r.risks[0]!.evidence = Array.from({ length: 101 }, (_, i) => ({
          source: "document",
          ref: `record-${i}`,
          note: "Bounded record evidence.",
        }));
      }),
    );
  });
});
