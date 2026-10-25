import { ConstraintSchema } from "@domino/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { AncestryPanel, CatalogList } from "./CatalogPanel";
import { QuestionsPanel, mergeReceipts } from "./QuestionsPanel";
import { ReceiptsPanel, WeekDetail } from "./RunPanels";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import {
  type CatalogEntry,
  GRAPH_LIMIT,
  ancestryOf,
  readCatalogPage,
  readGraph,
  readQuestion,
  readQuestions,
  readResultRef,
  readRun,
  workspaceHref,
  workspaceLinkFromSearch,
} from "./api";
import {
  buildChange,
  buildConstraints,
  dollarsText,
  emptyEvent,
  emptyRule,
  eventFromItem,
  eventOptions,
  parseDollars,
  ruleDraftFrom,
} from "./drafts";
import {
  fixtureBaseline,
  fixtureGraph,
  fixtureQuestions,
  fixtureRoot,
  fixtureRule,
  fixtureRules,
  fixtureScenario,
} from "./fixtures";
import { RequestLedger, describeWriteError, isConfirmed } from "./requests";

const key = { companyId: fixtureScenario.companyId, runId: fixtureScenario.runId };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("readRun boundary", () => {
  it("accepts every fixture node under its own link", () => {
    for (const r of [fixtureRoot, fixtureRules, fixtureScenario])
      expect(readRun(clone(r), { companyId: r.companyId, runId: r.runId }).state).toBe("ready");
  });

  it("separates loading, failed read, missing and unusable", () => {
    expect(readRun(undefined, key)).toEqual({ state: "loading" });
    expect(readRun(new Error("offline"), key)).toEqual({ state: "error" });
    expect(readRun(null, key)).toEqual({ state: "missing" });
    expect(readRun({ runId: key.runId }, key)).toEqual({ state: "unusable" });
  });

  it("never shows a record under another company or run", () => {
    expect(readRun(clone(fixtureScenario), { ...key, companyId: "other" }).state).toBe("unusable");
    expect(readRun(clone(fixtureScenario), { ...key, runId: fixtureRoot.runId }).state).toBe(
      "unusable",
    );
    const foreignBaseline = clone(fixtureScenario);
    foreignBaseline.baselineRunId = "timeline:baseline/other";
    expect(readRun(foreignBaseline, key).state).toBe("unusable");
  });

  it("rejects unknown fields instead of silently stripping them", () => {
    const extra = { ...clone(fixtureScenario), secret: "x" };
    expect(readRun(extra, key).state).toBe("unusable");
    const nested = clone(fixtureScenario) as unknown as { forecast: Record<string, unknown> };
    nested.forecast.extra = 1;
    expect(readRun(nested, key).state).toBe("unusable");
  });

  it("reopens supported fractional rules, model values and discount percentages", () => {
    const run = clone(fixtureScenario);
    const runway = { ...clone(fixtureRule), kind: "min_runway_months" as const, limit: 4.5 };
    run.constraints.push(runway);
    run.baseline.constraints.push(runway);
    run.baseline.model.customerDelayDays.acme = { mean: 2.5, p90: 7.5, samples: 4 };
    const discount = {
      kind: "discount_early_pay" as const,
      invoiceId: "inv_acme_2027",
      percent: 2.5,
      payOn: "2026-11-18",
    };
    run.ownChanges.push(discount);
    run.changes.push(discount);
    run.receipts.push({
      ...clone(run.receipts[0]!),
      constraintId: runway.id,
      kind: "min_runway_months",
      unit: "months",
      limit: 4.5,
      value: null,
      shortfall: null,
    });
    expect(readRun(run, key).state).toBe("ready");
  });

  it.each([0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe or fractional cents %s at each local money boundary",
    (money) => {
      const probes = [
        (r: typeof fixtureScenario) => {
          r.forecast.lowPoint.usable = money;
        },
        (r: typeof fixtureScenario) => {
          r.constraints[0]!.limit = money;
        },
        (r: typeof fixtureScenario) => {
          r.receipts[0]!.value = money;
        },
        (r: typeof fixtureScenario) => {
          r.receipts[0]!.shortfall = money;
        },
        (r: typeof fixtureScenario) => {
          r.comparison!.weekly[0]!.usableDelta = money;
        },
        (r: typeof fixtureScenario) => {
          r.baseline.history[0]!.usable = money;
        },
        (r: typeof fixtureScenario) => {
          r.baseline.model.recurringSpend = [{ label: "Cost", amount: money, everyDays: 7 }];
        },
        (r: typeof fixtureScenario) => {
          r.ownChanges = [{ kind: "add_cash", date: "2026-11-18", label: "Cash", amount: money }];
        },
        (r: typeof fixtureScenario) => {
          r.changes = [
            {
              kind: "shift_hire",
              label: "Hire",
              monthlyCost: money,
              fromDate: "2026-11-18",
              toDate: "2026-11-25",
            },
          ];
        },
      ];
      for (const corrupt of probes) {
        const run = clone(fixtureScenario);
        corrupt(run);
        expect(readRun(run, key).state).toBe("unusable");
      }
    },
  );

  it("rejects silently stripped nested baseline fields and nonfinite fractional fields", () => {
    const run = clone(fixtureScenario);
    Object.assign(run.baseline.model, { unexpected: 1 });
    expect(readRun(run, key).state).toBe("unusable");
    const nonfinite = clone(fixtureScenario);
    nonfinite.constraints.push({
      ...clone(fixtureRule),
      kind: "min_runway_months",
      limit: Number.POSITIVE_INFINITY,
    });
    expect(readRun(nonfinite, key).state).toBe("unusable");
  });

  it("rejects inconsistent lineage and comparisons", () => {
    const orphan = { ...clone(fixtureScenario), parentRunId: null };
    expect(readRun(orphan, key).state).toBe("unusable");
    const wrongParent = clone(fixtureScenario);
    if (wrongParent.comparison) wrongParent.comparison.parentRunId = fixtureRoot.runId;
    expect(readRun(wrongParent, key).state).toBe("unusable");
    const shortCompare = clone(fixtureScenario);
    shortCompare.comparison?.weekly.pop();
    expect(readRun(shortCompare, key).state).toBe("unusable");
  });

  it("rejects fractional money in a comparison", () => {
    const frac = clone(fixtureScenario);
    if (frac.comparison) frac.comparison.lowPointDelta = 1.5;
    expect(readRun(frac, key).state).toBe("unusable");
  });
});

describe("catalog, graph and questions boundaries", () => {
  const page = { page: clone(fixtureGraph), isDone: false, continueCursor: "c1" };

  it("reads a page and keeps the cursor", () => {
    const read = readCatalogPage(page, "kestrel");
    expect(read.state).toBe("ready");
    if (read.state === "ready") {
      expect(read.value.entries).toHaveLength(3);
      expect(read.value.continueCursor).toBe("c1");
    }
  });

  it("rejects a page with another company's entry or an unknown field", () => {
    expect(readCatalogPage(page, "other").state).toBe("unusable");
    const extra = { ...page, page: [{ ...clone(fixtureGraph[0]), extra: 1 }] };
    expect(readCatalogPage(extra, "kestrel").state).toBe("unusable");
    expect(readCatalogPage(new Error("x"), "kestrel").state).toBe("error");
  });

  it("bounds the graph and pins it to one baseline", () => {
    const g = { companyId: "kestrel", baselineRunId: fixtureBaseline.runId };
    expect(readGraph(clone(fixtureGraph), g).state).toBe("ready");
    expect(readGraph(clone(fixtureGraph), { ...g, baselineRunId: "x" }).state).toBe("unusable");
    const tooMany = Array.from({ length: GRAPH_LIMIT + 1 }, () => clone(fixtureGraph[0]));
    expect(readGraph(tooMany, g).state).toBe("unusable");
  });

  it("pins question receipts to the run they were asked about", () => {
    const qKey = { companyId: "kestrel", runId: fixtureRules.runId };
    expect(readQuestions(clone(fixtureQuestions), qKey).state).toBe("ready");
    expect(readQuestions(clone(fixtureQuestions), { ...qKey, runId: "x" }).state).toBe("unusable");
    const broken = { ...clone(fixtureQuestions[1]), proposal: null };
    expect(readQuestion(broken, qKey)).toBeUndefined();
    const stray = { ...clone(fixtureQuestions[0]), rawProviderText: "..." };
    expect(readQuestion(stray, qKey)).toBeUndefined();
  });

  it("accepts fractional runway and discount proposals without weakening cents checks", () => {
    const proposal = clone(fixtureQuestions[1]!);
    if (!proposal.proposal) throw new Error("fixture");
    proposal.proposal.constraints = [
      { ...clone(fixtureRule), kind: "min_runway_months", limit: 4.5 },
    ];
    proposal.proposal.changes = [
      { kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 1.5, payOn: "2026-11-18" },
    ];
    const context = { companyId: proposal.companyId, runId: proposal.runId };
    expect(readQuestion(proposal, context)).toBeDefined();
    for (const amount of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const unsafe = clone(proposal);
      unsafe.proposal!.changes = [
        { kind: "remove_cash", amount, label: "Expense", date: "2026-11-18" },
      ];
      expect(readQuestion(unsafe, context)).toBeUndefined();
      unsafe.proposal!.changes = [];
      unsafe.proposal!.constraints = [{ ...clone(fixtureRule), limit: amount }];
      expect(readQuestion(unsafe, context)).toBeUndefined();
    }
    Object.assign(proposal.proposal.constraints[0]!.evidence, { unknown: true });
    expect(readQuestion(proposal, context)).toBeUndefined();
  });

  it("parses the result pointer text strictly", () => {
    const ref = {
      seedId: fixtureBaseline.seed.id,
      seedHash: fixtureBaseline.seedHash,
      kind: "scenario",
      branchIds: [fixtureScenario.runId],
      route: workspaceHref("kestrel", { runId: fixtureScenario.runId }),
    };
    expect(readResultRef(JSON.stringify(ref)).state).toBe("ready");
    expect(readResultRef(JSON.stringify({ ...ref, extra: 1 })).state).toBe("unusable");
    expect(readResultRef(null).state).toBe("missing");
  });
});

describe("links", () => {
  it("round-trips runId and baselineRunId and refuses both at once", () => {
    const href = workspaceHref("kestrel", { runId: "timeline:run/a b" });
    expect(href).toBe("/c/kestrel/timeline?runId=timeline%3Arun%2Fa+b");
    expect(workspaceLinkFromSearch(href.split("?")[1] ?? "")).toEqual({
      kind: "run",
      runId: "timeline:run/a b",
    });
    expect(workspaceLinkFromSearch("baselineRunId=b")).toEqual({
      kind: "bootstrap",
      baselineRunId: "b",
    });
    expect(workspaceLinkFromSearch("runId=a&baselineRunId=b")).toEqual({ kind: "conflict" });
    expect(workspaceLinkFromSearch("")).toEqual({ kind: "catalog" });
  });
});

describe("ancestry", () => {
  it("walks root to node and lists children", () => {
    const a = ancestryOf(fixtureGraph, fixtureRules.runId);
    expect(a.path.map((e) => e.runId)).toEqual([fixtureRoot.runId, fixtureRules.runId]);
    expect(a.children.map((e) => e.runId)).toEqual([fixtureScenario.runId]);
    expect(a.broken).toBe(false);
    expect(a.truncated).toBe(false);
  });

  it("reports a missing parent and a cycle instead of looping", () => {
    const missing = ancestryOf(fixtureGraph.slice(1), fixtureScenario.runId);
    expect(missing.broken).toBe(true);
    const loop: CatalogEntry[] = [
      { ...(fixtureGraph[0] as CatalogEntry), runId: "a", parentRunId: "b" },
      { ...(fixtureGraph[0] as CatalogEntry), runId: "b", parentRunId: "a" },
    ];
    expect(ancestryOf(loop, "a").broken).toBe(true);
  });

  it("says when the bounded graph may be truncated", () => {
    const full = Array.from({ length: GRAPH_LIMIT }, (_, i) => ({
      ...(fixtureGraph[0] as CatalogEntry),
      runId: `r${i}`,
    }));
    expect(ancestryOf(full, "r0").truncated).toBe(true);
    const html = renderToStaticMarkup(
      <AncestryPanel graph={{ state: "ready", value: full }} runId="r0" hrefFor={(id) => id} />,
    );
    expect(html).toContain("ancestry-truncated");
  });
});

describe("requests and confirmation", () => {
  it("reuses one request id for an uncertain retry of the same payload", () => {
    let n = 0;
    const ledger = new RequestLedger(() => `id-${++n}`);
    expect(ledger.idFor("same")).toBe("id-1");
    expect(ledger.idFor("same")).toBe("id-1");
    expect(ledger.idFor("other")).toBe("id-2");
  });

  it("uses a new id only for an explicit retry after a definite failure", () => {
    let n = 0;
    const ledger = new RequestLedger(() => `id-${++n}`);
    ledger.idFor("q");
    expect(ledger.renew("q")).toBe("id-2");
    expect(ledger.idFor("q")).toBe("id-2");
  });

  it("resets confirmation when the reviewed input changes", () => {
    const first = JSON.stringify([buildConstraints([ruleDraftFrom(fixtureRule)])]);
    expect(isConfirmed(first, first)).toBe(true);
    const edited = JSON.stringify([
      buildConstraints([{ ...ruleDraftFrom(fixtureRule), limit: "1" }]),
    ]);
    expect(isConfirmed(first, edited)).toBe(false);
    expect(isConfirmed(null, first)).toBe(false);
    expect(isConfirmed(null, null)).toBe(false);
  });

  it("never claims an unconfirmed write was not saved", () => {
    expect(describeWriteError(new Error("network"))).toMatch(/may or may not have been saved/);
  });
});

describe("drafts", () => {
  it("parses dollars into exact integer cents without floating point", () => {
    expect(parseDollars("3,000,000")).toBe(300_000_000);
    expect(parseDollars("$1.5")).toBe(150);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars("1234567.89")).toBe(123_456_789);
    for (const bad of ["", "0", "-5", "1.234", "1,00", "1e6", "abc", "99999999999999999"])
      expect(parseDollars(bad)).toBeUndefined();
    expect(dollarsText(300_000_050)).toBe("3000000.50");
    expect(parseDollars(dollarsText(123_456_789))).toBe(123_456_789);
  });

  it("builds valid rules, keeps saved ids and evidence, and never collides ids", () => {
    const built = buildConstraints([
      ruleDraftFrom(fixtureRule),
      { ...emptyRule("min_cash"), limit: "1,000" },
      { ...emptyRule("min_runway_months"), limit: "4.5" },
      { ...emptyRule("pay_by_date"), limit: "0", billId: "bill_rent_nov" },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value[0]).toEqual(fixtureRule);
    expect(new Set(built.value.map((c) => c.id)).size).toBe(4);
    for (const c of built.value) expect(ConstraintSchema.safeParse(c).success).toBe(true);
    expect(built.value[1]?.limit).toBe(100_000);
  });

  it("explains incomplete rules in plain words", () => {
    const built = buildConstraints([{ ...emptyRule("pay_by_date"), limit: "x" }]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.errors.join(" ")).toMatch(/choose the bill/);
  });

  it("rejects events dated in recorded history", () => {
    const first = fixtureScenario.forecast.weeks[0]?.weekStart ?? "";
    const past = buildChange(
      { ...emptyEvent("add_cash"), date: "2026-10-01", amount: "10", label: "Refund" },
      first,
    );
    expect(past.ok).toBe(false);
    const ok = buildChange(
      { ...emptyEvent("delay_invoice"), invoiceId: "inv_acme_2027", days: "30" },
      first,
    );
    expect(ok).toEqual({
      ok: true,
      value: { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 30 },
    });
    expect(buildChange({ ...emptyEvent("delay_bill"), billId: "b", days: "0" }, first).ok).toBe(
      false,
    );
  });

  it("offers only open invoices and unpaid bills, and turns a chosen item into a draft", () => {
    const opts = eventOptions(fixtureBaseline.seed);
    expect(opts.invoices.map((o) => o.id)).toContain("inv_acme_2027");
    expect(opts.invoices.map((o) => o.id)).not.toContain("inv_acme_hist_1");
    const item = fixtureBaseline.seed.scheduledItems.find((i) => i.id === "sched_inv_acme_2027");
    expect(item && eventFromItem(item, opts)?.invoiceId).toBe("inv_acme_2027");
    const payroll = fixtureBaseline.seed.scheduledItems.find((i) => i.kind === "payroll");
    expect(payroll && eventFromItem(payroll, opts)).toBeUndefined();
  });
});

const refuse = async () => ({ ok: false as const, message: "no" });
const actions: WorkspaceActions = {
  catalogHref: "/c/kestrel/timeline",
  hrefFor: (id) => workspaceHref("kestrel", { runId: id }),
  simulate: refuse,
  reviseRules: refuse,
  ask: refuse,
  confirmProposal: refuse,
  relink: refuse,
};

describe("workspace view", () => {
  const render = (run = fixtureScenario) =>
    renderToStaticMarkup(
      <WorkspaceView
        run={run}
        parent={run.parentRunId ? { state: "ready", value: fixtureRules } : null}
        graph={{ state: "ready", value: fixtureGraph }}
        questions={{ state: "ready", value: [] }}
        resultRef={{ state: "missing" }}
        actions={actions}
      />,
    );

  it("links the exact selected run to its saved calculation", () => {
    const html = render();
    expect(html).toContain(
      `href="${timelineCalculationHref(fixtureScenario.companyId, fixtureScenario.runId)}"`,
    );
    expect(html).toContain('data-testid="action-calculation"');
  });

  it("dates books from the snapshot and hides unsupported automatic risks on event scenarios", () => {
    const scenarioHtml = render(fixtureScenario);
    expect(scenarioHtml).toContain("Books as of Oct 30, 2026");
    expect(scenarioHtml).not.toContain("Books as of Nov 2, 2026");
    expect(scenarioHtml).not.toContain('data-testid="action-risks"');
    expect(render(fixtureRoot)).toContain('data-testid="action-risks"');
    expect(render(fixtureRules)).toContain('data-testid="action-risks"');
    const explicit = renderToStaticMarkup(
      <WorkspaceView
        run={fixtureScenario}
        parent={{ state: "ready", value: fixtureRules }}
        graph={{ state: "ready", value: fixtureGraph }}
        questions={{ state: "ready", value: [] }}
        resultRef={{ state: "missing" }}
        actions={actions}
        risksHref="/c/kestrel/timeline/analysis?runId=exact&analysisId=saved"
      />,
    );
    expect(explicit).toContain('data-testid="action-risks"');
    expect(explicit).toContain("analysisId=saved");
  });

  it("shows the saved risk and fix low points side by side with its original Field explanation", () => {
    const fix = clone(fixtureScenario);
    fix.runId = "timeline:workspace/field-fix";
    fix.label = "With fix: Delay bill";
    fix.parentRunId = fixtureScenario.runId;
    fix.forecast = clone(fixtureRoot.forecast);
    fix.baseline.assumptionNote +=
      "\nField trace: /field/analysis?companyId=field-company&runId=analyst-old&scenarioId=risk-old&fixKind=delay_bill";
    const risk = clone(fixtureScenario);
    risk.label = "If: Acme pays 30 days late";
    const html = renderToStaticMarkup(
      <WorkspaceView
        run={fix}
        parent={{ state: "ready", value: risk }}
        graph={{ state: "ready", value: fixtureGraph }}
        questions={{ state: "ready", value: [] }}
        resultRef={{ state: "missing" }}
        actions={actions}
      />,
    );
    expect(html).toContain('data-testid="field-fix-comparison"');
    expect(html).toContain("Without this fix");
    expect(html).toContain("With this fix");
    expect(html).toContain('data-testid="field-origin-link"');
    expect(html).toContain("Why that suggestion");
    expect(html).toContain("runId=analyst-old&amp;scenarioId=risk-old&amp;fixKind=delay_bill");
  });

  it("shows the saved low point, rule result, server difference and both lines", () => {
    const html = render();
    expect(html).toContain("Kestrel Data");
    expect(html).toContain("$3,117,000.00");
    expect(html).toContain("Low point: -$110,000.00");
    expect(html).toContain('data-status="breached"');
    expect(html).toContain("Outside the rule");
    expect(html).toContain("New in this scenario");
    expect(html).toContain("-$240,000.00");
    expect(html).toContain('data-testid="parent-line"');
    expect(html).toContain("Lender&#x27;s limit $3,150,000.00");
  });

  it("draws 26 recorded weeks and 13 selectable forecast weeks", () => {
    const html = render();
    expect(fixtureBaseline.history).toHaveLength(26);
    expect(html.match(/data-testid="chart-week-/g)).toHaveLength(13);
  });

  it("keeps forecast styling neutral and marks only saved breach weeks", () => {
    const clean = render(fixtureRoot);
    expect(clean).toMatch(/class="stroke-primary"[^>]*data-testid="forecast-line"/);
    expect(clean).not.toContain('data-breached="true"');
    expect(clean).not.toContain("stroke-safe");
    expect(clean).not.toContain("fill-safe");
    const breached = render();
    expect(breached.match(/data-breached="true"/g)).toHaveLength(1);
    expect(breached).toContain("Week below a cash minimum");
    expect(breached).toContain('data-testid="breach-note"');
  });

  it("states the 13-week and original-schedule scope and group attribution", () => {
    const run = clone(fixtureScenario);
    run.receipts[0]!.actionLabels = ["Atlas expense", "Cash injection"];
    const receipts = renderToStaticMarkup(<ReceiptsPanel run={run} />);
    expect(receipts).toContain("Scenario inputs checked together: Atlas expense; Cash injection");
    expect(receipts).toContain("does not attribute the breach to an individual input");
    expect(receipts).toContain("Sunday closing usable cash");
    expect(render(fixtureRules)).toContain("No breach found in these 13 weeks");
    expect(render(fixtureRules)).not.toContain("Meets the rule");
    expect(render()).toContain(
      "Scheduled items (original imported dates; scenario changes are in the cash line)",
    );
    const detail = renderToStaticMarkup(
      <WeekDetail
        run={run}
        weekStart={run.forecast.weeks[0]!.weekStart}
        selectedItemId={null}
        onSelectItem={() => undefined}
      />,
    );
    expect(detail).toContain("These items keep their original weeks");
  });

  it("starts every confirmation unchecked and every write disabled", () => {
    const html = render();
    expect(html).toMatch(/data-testid="rule-confirm"[^>]*/);
    expect(html).not.toMatch(/checked=""[^>]*data-testid="(rule|event)-confirm"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="event-run"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="rule-save"/);
  });

  it("says when there is nothing to compare", () => {
    expect(render(fixtureRoot)).toContain("nothing earlier to compare with");
  });
});

describe("questions panel", () => {
  const render = (questions: Parameters<typeof QuestionsPanel>[0]["questions"]) =>
    renderToStaticMarkup(
      <QuestionsPanel
        questions={questions}
        selectedWeek="2026-11-23"
        selectedItemId="sched_inv_acme_2027"
        onClearContext={() => undefined}
        actions={actions}
      />,
    );

  it("renders every receipt state honestly", () => {
    const html = render({ state: "ready", value: fixtureQuestions });
    expect(html).toContain('data-status="answered"');
    expect(html).toContain("Saved low point");
    expect(html).toContain("Suggested scenario: Acme pays 30 days late");
    expect(html).toContain("Nothing has been calculated yet");
    expect(html).toContain("Which customer, and how many days late?");
    expect(html).toContain("No question service is set up here");
    expect(html).toContain('data-testid="reask-q4"');
    expect(html).toContain("Reading the saved scenario...");
    expect(html).toContain('data-testid="question-context"');
  });

  it("shows a linked proposal as saved instead of offering to run it again", () => {
    const proposal = fixtureQuestions[1];
    if (!proposal) throw new Error("fixture");
    const linked = { ...clone(proposal), linkedRunId: fixtureScenario.runId };
    const html = render({ state: "ready", value: [linked] });
    expect(html).toContain('data-testid="proposal-linked"');
    expect(html).not.toContain("proposal-confirm-q2");
  });

  it("shows the stored reading method and current backend failure codes", () => {
    const codes = [
      ["PROVIDER_UNAVAILABLE", "no language reader is set up"],
      ["PROVIDER_TIMEOUT", "language reader took too long"],
      ["PROVIDER_ERROR", "language reader could not be reached"],
      ["PROVIDER_REFUSED", "language reader declined"],
      ["PROVIDER_TRUNCATED", "reply was cut off"],
      ["PROVIDER_MALFORMED", "reply was not usable"],
      ["LEASE_EXPIRED", "stopped before it finished"],
      ["INTERNAL", "could not be finished"],
    ];
    for (const [errorCode, message] of codes) {
      const q = clone(fixtureQuestions[3]!);
      q.errorCode = errorCode!;
      q.operation.title = "Read with the bounded Timeline grammar";
      const html = render({ state: "ready", value: [q] });
      expect(html).toContain(message);
      expect(html).toContain("Read with the bounded Timeline grammar");
      expect(html).toContain("How this was read");
      expect(html).not.toContain(`(${errorCode})`);
    }
  });

  it("keeps a failed list read visible", () => {
    expect(render({ state: "error" })).toContain("Earlier questions could not be shown");
  });

  it("merges the latest answer without duplicating saved ones", () => {
    const [a, b] = fixtureQuestions;
    if (!a || !b) return;
    expect(mergeReceipts([a], [a, b]).map((q) => q.id)).toEqual([a.id, b.id]);
  });
});

describe("catalog list", () => {
  const ready = {
    state: "ready" as const,
    value: { entries: fixtureGraph, isDone: false, continueCursor: "c" },
  };

  it("pages older scenarios and links each one", () => {
    const html = renderToStaticMarkup(
      <CatalogList pages={[ready]} onMore={() => undefined} hrefFor={(id) => `/open/${id}`} />,
    );
    expect(html).toContain('data-testid="catalog-more"');
    expect(html).toContain("/open/timeline:run/kestrel-acme-late");
  });

  it("keeps loaded pages while a later page fails", () => {
    const html = renderToStaticMarkup(
      <CatalogList
        pages={[ready, { state: "error" }]}
        onMore={() => undefined}
        hrefFor={(id) => id}
      />,
    );
    expect(html).toContain("Acme pays 30 days late");
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("catalog-more");
  });

  it("says plainly when nothing is saved", () => {
    const html = renderToStaticMarkup(
      <CatalogList
        pages={[{ state: "ready", value: { entries: [], isDone: true, continueCursor: "" } }]}
        onMore={() => undefined}
        hrefFor={(id) => id}
      />,
    );
    expect(html).toContain("No saved scenarios yet");
  });
});
