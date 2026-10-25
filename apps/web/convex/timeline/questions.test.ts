/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { WeeklySeedV1 } from "@domino/contracts";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { defineSchema, makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { LEASE_MS, questionIdFor } from "./questions";
import {
  MIN_CASH,
  fakeRuns,
  kestrelSeed,
  makeRun,
  putRun,
} from "./questions.fake-workspace.test-support";
import { formatCents, formatDate } from "./questions/parse";
import type { QuestionReceipt } from "./questions/receipt";
import { resolve } from "./questions/resolve";
import { timelineQuestionsTable } from "./questions/table";

// Vite writes this folder's files as "./x.ts"; convex-test resolves paths from the convex root.
// timeline/workspace is TL2B's; a fake serving engine-built runs stands in for it here.
const modules: Record<string, () => Promise<unknown>> = {
  ...Object.fromEntries(
    Object.entries(
      import.meta.glob(["../**/*.ts", "../_generated/*.js", "!../**/*.test.ts", "!./*.test.ts"]),
    ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
  ),
  "../timeline/workspace.ts": () => import("./questions.fake-workspace.test-support"),
};
// The real schema gains timelineQuestions from TL2B; until then the frozen table is added here.
const testSchema = defineSchema({ ...schema.tables, timelineQuestions: timelineQuestionsTable });
const setup = () => convexTest(testSchema, modules);
type T = ReturnType<typeof setup>;

const q = {
  ask: makeFunctionReference<
    "action",
    {
      companyId: string;
      runId: string;
      requestId: string;
      prompt: string;
      selectedWeek?: string;
      selectedItemId?: string;
    },
    QuestionReceipt
  >("timeline/questions:ask"),
  list: makeFunctionReference<"query", { companyId: string; runId: string }, QuestionReceipt[]>(
    "timeline/questions:list",
  ),
  link: makeFunctionReference<
    "mutation",
    { companyId: string; questionId: string; resultRunId: string },
    { linkedRunId: string }
  >("timeline/questions:link"),
  claim: makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    { claimed: boolean; receipt: QuestionReceipt }
  >("timeline/questions:claim"),
  finalize: makeFunctionReference<"mutation", Record<string, unknown>, QuestionReceipt>(
    "timeline/questions:finalize",
  ),
};

const BASE = "timeline:run/kestrel-base";
const base = makeRun({ runId: BASE });
it("resolver cannot substitute a selection for an omitted explicit date", () => {
  const intent = {
    kind: "question" as const,
    topic: "week" as const,
    weekText: null,
    itemText: null,
  };
  const explicit = resolve(base, [intent], {
    questionId: "null-date-regression",
    prompt: "What happens in the week of Nov 17, 2027?",
    selectedWeek: "2026-11-16",
    selectedItemId: null,
  });
  expect(explicit.status).toBe("clarification");
  expect(explicit.citations).toEqual([]);
  const selected = resolve(base, [intent], {
    questionId: "selected-date-regression",
    prompt: "What happens this week?",
    selectedWeek: "2026-11-16",
    selectedItemId: null,
  });
  expect(selected.status).toBe("answered");
  expect(selected.citations[0]?.ref).toBe("forecast:week/2026-11-16");
});
let counter = 0;
const rid = () => `req-question-${++counter}`;
const ask = (
  t: T,
  prompt: string,
  over: Partial<{
    runId: string;
    requestId: string;
    companyId: string;
    selectedWeek: string;
    selectedItemId: string;
  }> = {},
) => t.action(q.ask, { companyId: "kestrel", runId: BASE, requestId: rid(), prompt, ...over });
const rows = (t: T) => t.run((ctx) => ctx.db.query("timelineQuestions").collect());

/** A provider reply carrying `output` as its one structured text block. */
const reply = (output: unknown, stop = "end_turn") =>
  new Response(
    JSON.stringify({
      stop_reason: stop,
      content: [{ type: "text", text: JSON.stringify(output) }],
    }),
    { status: 200 },
  );

beforeEach(() => {
  fakeRuns.clear();
  putRun(base);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("timeline questions: evidence answers", () => {
  it("bounds evidence narratives and citations for long record and rule labels", async () => {
    const t = setup();
    const run = structuredClone(base);
    run.runId = "timeline:run/long-labels";
    run.receipts = Array.from({ length: 12 }, (_, index) => ({
      ...base.receipts[0]!,
      constraintId: `rule_${index}`,
      label: "A long rule label ".repeat(50),
    }));
    putRun(run);
    const rules = await ask(t, "Are any rules broken?", { runId: run.runId });
    expect(rules.status).toBe("answered");
    expect(rules.answer.length).toBeLessThanOrEqual(2_000);
    expect(rules.citations.every((c) => c.label.length <= 200)).toBe(true);
    expect(rules.answer).toContain("Showing 6 of 12 rules");
  });
  it("explains why the selected week drops using effective cash movements", async () => {
    const t = setup();
    const run = makeRun({
      runId: "timeline:run/ancestor-late",
      kind: "scenario",
      ownChanges: [{ kind: "remove_cash", date: "2026-12-09", amount: 10_000, label: "Legal fee" }],
      changes: [
        { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 14 },
        { kind: "remove_cash", date: "2026-12-09", amount: 10_000, label: "Legal fee" },
      ],
    });
    putRun(run);
    const r = await ask(t, "Why did cash drop this week?", {
      runId: run.runId,
      selectedWeek: "2026-12-07",
    });
    expect(r.status).toBe("answered");
    expect(r.answer).toContain("Effective cash movements");
    expect(r.answer).toContain("inv_acme_2027");
    expect(r.answer).toContain("Dec 9, 2026");
    expect(r.answer).not.toContain("Nov 25, 2026");
    expect(r.citations.map((c) => c.ref)).toContain("record:invoice/inv_acme_2027");
    expect(r.citations.map((c) => c.ref)).toContain(`run:${run.runId}`);
    const item = await ask(t, "When is the Acme invoice due?", { runId: run.runId });
    expect(item.answer).toContain("Nov 25, 2026");
    expect(item.answer).toContain("Effective projection in this run: $240,000 in on Dec 9, 2026");
  });

  it("uses model timing and fails closed when effective evidence differs from saved totals", async () => {
    const t = setup();
    const run = structuredClone(makeRun({ runId: "timeline:run/model-delay" }));
    const invoice = run.baseline.seed.snapshot.invoices.find((i) => i.id === "inv_acme_2027");
    if (!invoice) throw new Error("fixture invoice missing");
    run.baseline.model.customerDelayDays[invoice.customerId] = { mean: 7, p90: 7, samples: 1 };
    run.forecast = engine.forecast(run.baseline.seed.snapshot, run.baseline.model, []);
    putRun(run);
    const r = await ask(t, "Why did cash drop this week?", {
      runId: run.runId,
      selectedWeek: "2026-11-30",
    });
    expect(r.status).toBe("answered");
    expect(r.answer).toContain("Dec 2, 2026");
    const changed = structuredClone(run);
    changed.runId = "timeline:run/inconsistent-evidence";
    const first = changed.forecast.weeks[0];
    if (first) first.closing++;
    putRun(changed);
    const mismatch = await ask(t, "Why did cash drop this week?", {
      runId: changed.runId,
      selectedWeek: "2026-11-30",
    });
    expect(mismatch.status).toBe("clarification");
    expect(mismatch.answer).toContain("could not verify");
    expect(mismatch.citations).toEqual([]);
  });
  it("answers the low point from the saved forecast, with a citation, and saves it", async () => {
    const t = setup();
    const r = await ask(t, "What is our lowest cash week?");
    const low = base.forecast.lowPoint;
    expect(r.status).toBe("answered");
    expect(r.answer).toContain(formatCents(low.usable));
    expect(r.answer).toContain(formatDate(low.weekStart));
    expect(r.citations).toEqual([
      { ref: `forecast:week/${low.weekStart}`, label: `Week of ${formatDate(low.weekStart)}` },
    ]);
    expect(r).toMatchObject({
      proposal: null,
      errorCode: null,
      linkedRunId: null,
      id: await questionIdFor("kestrel", r.requestId),
    });
    expect(r.operation).toMatchObject({
      status: "succeeded",
      ownerDomain: "timeline",
      outputRefs: [r.id],
    });
    expect(r.operation.title).toMatch(/fixed patterns/);
    expect(await t.query(q.list, { companyId: "kestrel", runId: BASE })).toEqual([r]);
  });

  it("answers a selected week from saved outputs and scheduled items", async () => {
    const t = setup();
    const week = base.forecast.weeks[0];
    if (!week) throw new Error("no week");
    const r = await ask(t, "What happens this week?", { selectedWeek: week.weekStart });
    expect(r.status).toBe("answered");
    expect(r.answer).toContain(formatCents(week.closing));
    expect(r.answer).toContain("Payroll");
    expect(r.citations.map((c) => c.ref)).toContain("record:payroll/pay_1106");
  });

  it("answers an item by name and by selected id from the seed record", async () => {
    const t = setup();
    const byName = await ask(t, "When is the Acme invoice due?");
    expect(byName.status).toBe("answered");
    expect(byName.answer).toContain("inv_acme_2027");
    expect(byName.answer).toContain(formatCents(24_000_000));
    expect(byName.answer).toContain("Nov 25, 2026");
    expect(byName.citations[0]?.ref).toBe("record:invoice/inv_acme_2027");
    const bySelection = await ask(t, "Tell me about this item", {
      selectedItemId: "sched_bill_rent_nov",
    });
    expect(bySelection.answer).toContain("Office landlord bill bill_rent_nov");
  });

  it("reports rule receipts as saved, never recomputing them", async () => {
    const t = setup();
    const r = await ask(t, "Are any rules broken?");
    const receipt = base.receipts[0];
    if (!receipt) throw new Error("fixture needs a receipt");
    expect(r.answer).toContain(receipt.label);
    expect(r.citations).toEqual([{ ref: "rule:user_min_cash", label: receipt.label }]);
  });
});

describe("timeline questions: proposals", () => {
  it("reads the core event and rule prompt with sentence punctuation", async () => {
    const r = await ask(
      setup(),
      "What if we spend $80,000 to Atlas Legal on 2026-11-17? Keep usable cash above $2,650,000.",
    );
    expect(r.status).toBe("proposal");
    expect(r.proposal?.changes).toEqual([
      {
        kind: "remove_cash",
        amount: 8_000_000,
        date: "2026-11-17",
        label: "Payment to Atlas Legal",
      },
    ]);
    expect(r.proposal?.constraints?.at(-1)).toMatchObject({ kind: "min_cash", limit: 265_000_000 });
  });
  it("keeps fractional runway and ordinary sentence punctuation exact", async () => {
    const t = setup();
    const runway = await ask(t, "Keep at least 4.5 months of runway.");
    expect(runway.status).toBe("proposal");
    expect(runway.proposal?.constraints?.at(-1)).toMatchObject({
      kind: "min_runway_months",
      limit: 4.5,
    });
    const cash = await ask(t, "Keep usable cash above $2600000.");
    expect(cash.status).toBe("proposal");
    expect(cash.proposal?.constraints?.at(-1)).toMatchObject({
      kind: "min_cash",
      limit: 260_000_000,
    });
  });
  it("proposes exactly one late invoice change and calculates nothing", async () => {
    const t = setup();
    const r = await ask(t, "What if Acme pays 14 days late?");
    expect(r.status).toBe("proposal");
    expect(r.proposal).toEqual({
      label: "Acme Logistics invoice ($240K, due Nov 25), paid 14 days late",
      changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 14 }],
      constraints: null,
      constraintNote: null,
    });
    expect(r.answer).toMatch(/Nothing is calculated until you confirm/);
    const weeks = await ask(t, "What if Northwind Health pays 2 weeks late?");
    expect(weeks.proposal?.changes).toEqual([
      { kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 14 },
    ]);
  });

  it("proposes a one-time expense plus a minimum cash rule on top of the run's rules", async () => {
    const t = setup();
    const r = await ask(
      t,
      "What if we pay $80,000 to Atlas Legal on Nov 18 and keep usable cash above $3M?",
    );
    expect(r.status).toBe("proposal");
    expect(r.proposal?.changes).toEqual([
      {
        kind: "remove_cash",
        date: "2026-11-18",
        amount: 8_000_000,
        label: "Payment to Atlas Legal",
      },
    ]);
    expect(r.proposal?.constraints).toEqual([
      MIN_CASH,
      {
        id: `q_${r.id.split("/")[1]}_2`,
        label: "Keep usable cash above $3,000,000",
        kind: "min_cash",
        limit: 300_000_000,
        evidence: { source: "document", ref: r.id, note: expect.any(String) },
      },
    ]);
    expect(r.proposal?.constraintNote).toContain("keep usable cash above $3M");
  });

  it("reads $1.2M and an ISO date exactly", async () => {
    const t = setup();
    const r = await ask(t, "What if we receive $1.2M from Blue Ridge Capital on 2026-12-01?");
    expect(r.proposal?.changes).toEqual([
      {
        kind: "add_cash",
        date: "2026-12-01",
        amount: 120_000_000,
        label: "Cash from Blue Ridge Capital",
      },
    ]);
  });
});

describe("timeline questions: clarification", () => {
  it.each([
    "What if Acme pays 1.5 days late?",
    "Pay $80,00 to Atlas on Nov 18, 2026",
    "What if we pay $80, 000 to Atlas Legal on 2026-11-17?",
    "What if we pay $80 000 to Atlas Legal on 2026-11-17?",
    "What if we pay $80, 00 to Atlas Legal on 2026-11-17?",
    "Pay -$80 to Atlas on Nov 18, 2026",
    "Keep usable cash below $3M",
    "Keep cash above $3M",
    "Do not pay $80 to Atlas on Nov 18, 2026",
    "What if we pay $45,000 to Northlight Marketing for the existing bill on Nov 20?",
    "What if we collect $240,000 from Acme for the existing invoice on Nov 20?",
    "Could you model an $80000 payment to Atlas Legal dated November17,2026?",
    "What if we spend $80000 to Atlas Legal on 2026-11-17 but receive $10000 from Acme on 2026-11-18?",
    "What if we spend $80000 to Atlas Legal on 2026-11-17 including $10000 fees?",
    "What if we pay $80000 to Atlas Legal on 2026-11-17 or 2026-11-18?",
    "What if Acme pays 14 days late but Northwind Health pays 21 days late?",
  ])("preserves unsupported meaning by clarifying %s", async (prompt) => {
    const r = await ask(setup(), prompt);
    expect(r.status).toBe("clarification");
    expect(r.proposal).toBeNull();
    expect(r.citations).toEqual([]);
  });
  it.each([
    ["vague rule", "Keep cash healthy", /minimum usable cash amount/],
    ["missing expense details", "Add an expense", /the amount, the date and who is paid/],
    ["missing delay", "What if Acme pays late?", /how many days late/],
    ["missing counterparty", "What if we pay $5,000 on Nov 20?", /who is paid/],
    ["daily cash floor", "Keep at least $100k in the bank every day", /not day by day/],
    ["headcount budget", "What if we set a headcount budget of 5 hires?", /Headcount/],
    ["observed history", "What if we pay $5,000 to Atlas Legal on 2026-10-20?", /observed history/],
    [
      "beyond horizon",
      "What if we pay $5,000 to Atlas Legal on 2027-06-01?",
      /after this run's 13-week forecast/,
    ],
    ["unknown counterparty", "What if Zephyr pays 10 days late?", /which invoice/],
    ["inexact cents", "What if we pay $10.005 to Atlas Legal on Nov 20?", /exact amount/],
  ])("asks for more on %s and proposes nothing", async (_name, prompt, message) => {
    const t = setup();
    const r = await ask(t, prompt);
    expect(r.status).toBe("clarification");
    expect(r.answer).toMatch(message);
    expect(r.proposal).toBeNull();
    expect(r.operation.status).toBe("succeeded");
  });
});

describe("timeline questions: provider", () => {
  // The earlier one-shot reader; the Claude assistant path is covered in assistant.test.ts.
  beforeEach(() => vi.stubEnv("TIMELINE_ASSISTANT", "off"));
  const unknown = "Could you sort out the thing with the agency bill being slow?";

  it("saves a failure without any call when the provider is not configured", async () => {
    const t = setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await ask(t, unknown);
    expect(r).toMatchObject({
      status: "failed",
      errorCode: "PROVIDER_UNAVAILABLE",
      proposal: null,
      citations: [],
    });
    expect(r.answer).toMatch(/Nothing was calculated/);
    expect(r.operation).toMatchObject({ status: "failed", outputRefs: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an explicit upper limit before asking the provider", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchSpy = vi.fn(async () =>
      reply({ intents: [{ kind: "min_cash_rule", amountText: "$3M" }] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const r = await ask(setup(), "Could you enforce usable cash below $3M?");
    expect(r.status).toBe("clarification");
    expect(r.answer).toMatch(/upper.*limits?/);
    expect(r.proposal).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Could you enforce usable cash above $3M every day?",
      { kind: "min_cash_rule", amountText: "$3M" },
      /daily/,
      0,
    ],
    [
      "Could the Northwind Health payment land 10 days behind schedule while we keep usable cash above $3M at all times?",
      { kind: "late_invoice", itemText: "Northwind Health", daysText: "10 days" },
      /not day by day/,
      1,
    ],
    [
      "Could you enforce a headcount budget and keep usable cash above $3M?",
      { kind: "min_cash_rule", amountText: "$3M" },
      /Headcount/,
      1,
    ],
    [
      "Could the Northwind Health payment land 10 days behind schedule with a hiring budget?",
      { kind: "late_invoice", itemText: "Northwind Health", daysText: "10 days" },
      /Headcount/,
      1,
    ],
  ])(
    "does not let provider intents drop unsupported qualifiers from %s",
    async (prompt, intent, message, expectedCalls) => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      const fetchSpy = vi.fn(async () => reply({ intents: [intent] }));
      vi.stubGlobal("fetch", fetchSpy);
      const r = await ask(setup(), prompt);
      expect(fetchSpy).toHaveBeenCalledTimes(expectedCalls as number);
      expect(r.status).toBe("clarification");
      expect(r.answer).toMatch(message);
      expect(r.proposal).toBeNull();
      expect(r.operation.status).toBe("succeeded");
    },
  );

  it.each([
    [
      "Could you arrange an $80000 payment to Atlas Legal dated 2026-11-17 including $10000 fees?",
      [
        {
          kind: "cash_change",
          direction: "out",
          amountText: "$80000",
          dateText: "2026-11-17",
          counterpartyText: "Atlas Legal",
        },
      ],
      0,
    ],
    [
      "Could you arrange an $80000 payment to Atlas Legal dated 2026-11-17 and enforce usable cash above $3000000?",
      [
        {
          kind: "cash_change",
          direction: "out",
          amountText: "$3000000",
          dateText: "2026-11-17",
          counterpartyText: "Atlas Legal",
        },
        { kind: "min_cash_rule", amountText: "$80000" },
      ],
      1,
    ],
    [
      "Could you arrange an $80000 payment to Atlas Legal dated 2026-11-17 and a $10000 deposit from Acme dated 2026-11-18?",
      [
        {
          kind: "cash_change",
          direction: "out",
          amountText: "$80000",
          dateText: "2026-11-18",
          counterpartyText: "Atlas Legal",
        },
        {
          kind: "cash_change",
          direction: "in",
          amountText: "$10000",
          dateText: "2026-11-17",
          counterpartyText: "Acme",
        },
      ],
      1,
    ],
  ])(
    "rejects dropped or cross-clause provider amounts and dates in %s",
    async (prompt, intents, expectedCalls) => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      const fetchSpy = vi.fn(async () => reply({ intents }));
      vi.stubGlobal("fetch", fetchSpy);
      const r = await ask(setup(), prompt);
      expect(fetchSpy).toHaveBeenCalledTimes(expectedCalls as number);
      expect(r.status).toBe("clarification");
      expect(r.proposal).toBeNull();
    },
  );

  it.each([
    [
      { kind: "late_invoice", itemText: "Acme", daysText: "21 days" },
      { kind: "late_invoice", itemText: "Northwind Health", daysText: "14 days" },
    ],
    [{ kind: "late_invoice", itemText: "Acme", daysText: "14 days" }],
  ])("rejects swapped or dropped provider delay counts %o", async (...intents) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchSpy = vi.fn(async () => reply({ intents }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await ask(
      setup(),
      "Could the Acme payment land 14 days behind schedule and the Northwind Health payment land 21 days behind schedule?",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("clarification");
    expect(r.proposal).toBeNull();
  });

  it.each([
    ["refused", () => reply({}, "refusal"), "PROVIDER_REFUSED"],
    ["truncated", () => reply({}, "max_tokens"), "PROVIDER_TRUNCATED"],
    [
      "http error",
      () => new Response('{"error":"secret detail"}', { status: 500 }),
      "PROVIDER_ERROR",
    ],
    [
      "malformed",
      () => reply({ intents: [{ kind: "unclear", note: "extra" }] }),
      "PROVIDER_MALFORMED",
    ],
    [
      "invented amount",
      () => reply({ intents: [{ kind: "min_cash_rule", amountText: "$2M" }] }),
      "PROVIDER_MALFORMED",
    ],
  ])("saves %s replies as failures without raw provider text", async (_name, make, code) => {
    const t = setup();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => make()),
    );
    const r = await ask(t, unknown);
    expect(r).toMatchObject({ status: "failed", errorCode: code, proposal: null });
    expect(JSON.stringify(r)).not.toMatch(/secret detail|extra|test-key/);
  });

  it("uses provider intent only after checking it against the run, then reloads with no call", async () => {
    const t = setup();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      reply({ intents: [{ kind: "late_invoice", itemText: "agency", daysText: null }] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const prompt = "Could the agency invoice be slow by 10 days?";
    // "agency" names no invoice: the resolver refuses to guess.
    const vague = await ask(t, prompt);
    expect(vague.status).toBe("clarification");

    fetchSpy.mockImplementation(async () =>
      reply({
        intents: [{ kind: "late_invoice", itemText: "Northwind Health", daysText: "10 days" }],
      }),
    );
    const requestId = "req-provider-proposal";
    const r = await ask(t, "Could the Northwind Health payment land 10 days behind schedule?", {
      requestId,
    });
    expect(r.status).toBe("proposal");
    expect(r.proposal?.changes).toEqual([
      { kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 10 },
    ]);
    expect(r.operation.title).toMatch(/Claude/);
    const body = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
    expect(body.output_config.format.type).toBe("json_schema");
    expect(JSON.stringify(body)).not.toMatch(/forecast\.weeks|opening|lowPoint/);

    // Reload: no key, no network, same saved receipt.
    vi.unstubAllEnvs();
    fetchSpy.mockClear();
    const again = await ask(t, "Could the Northwind Health payment land 10 days behind schedule?", {
      requestId,
    });
    expect(again).toEqual(r);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("timeline questions: request binding and isolation", () => {
  it("scopes question, rule and operation identities by company and request", async () => {
    const t = setup();
    const other: WeeklySeedV1 = structuredClone(kestrelSeed);
    other.company = { id: "zephyr", name: "Zephyr Co" };
    other.snapshot.companyId = "zephyr";
    putRun(makeRun({ seed: other, runId: BASE }));
    const requestId = "req-company-identity";
    const a = await ask(t, "Keep usable cash above $3M", { requestId });
    const b = await ask(t, "Keep usable cash above $3M", { requestId, companyId: "zephyr" });
    expect(a.id).not.toBe(b.id);
    expect(a.operation.id).not.toBe(b.operation.id);
    expect(a.proposal?.constraints?.at(-1)?.id).not.toBe(b.proposal?.constraints?.at(-1)?.id);
    expect(await ask(t, "Keep usable cash above $3M", { requestId })).toEqual(a);
  });
  it("returns the saved receipt for a repeated request and rejects conflicting reuse", async () => {
    const t = setup();
    const requestId = "req-same-question";
    const first = await ask(t, "What is our lowest cash week?", { requestId });
    const again = await ask(t, "What is our lowest cash week?", { requestId });
    expect(again).toEqual(first);
    expect(await rows(t)).toHaveLength(1);
    await expect(ask(t, "Are any rules broken?", { requestId })).rejects.toThrow(/already used/);
    putRun(makeRun({ runId: "timeline:run/kestrel-other", parentRunId: BASE, kind: "rules" }));
    await expect(
      ask(t, "What is our lowest cash week?", { requestId, runId: "timeline:run/kestrel-other" }),
    ).rejects.toThrow(/already used/);
    expect(await rows(t)).toHaveLength(1);
  });

  it("pins each question to its own run and company", async () => {
    const t = setup();
    const lateRun = makeRun({
      runId: "timeline:run/kestrel-late",
      parentRunId: BASE,
      kind: "scenario",
      ownChanges: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 21 }],
    });
    putRun(lateRun);
    const other: WeeklySeedV1 = structuredClone(kestrelSeed);
    other.company = { id: "zephyr", name: "Zephyr Co" };
    const firstCustomer = other.snapshot.customers[0];
    if (firstCustomer) firstCustomer.name = "Zephyr Secret Customer";
    putRun(makeRun({ seed: other, runId: BASE }));

    const onLate = await ask(t, "When is the Acme invoice due?", { runId: lateRun.runId });
    expect(onLate.answer).toContain("This run moves it 21 days later.");
    const onBase = await ask(t, "When is the Acme invoice due?");
    expect(onBase.answer).not.toContain("days later");
    expect((await t.query(q.list, { companyId: "kestrel", runId: BASE })).map((r) => r.id)).toEqual(
      [onBase.id],
    );
    expect(
      (await t.query(q.list, { companyId: "kestrel", runId: lateRun.runId })).map((r) => r.id),
    ).toEqual([onLate.id]);
    expect(await t.query(q.list, { companyId: "zephyr", runId: BASE })).toEqual([]);

    // Provider context carries only the selected run's names.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      reply({ intents: [{ kind: "unclear" }] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await ask(t, "Could you sort out the thing with the agency bill being slow?");
    expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).not.toMatch(/Zephyr/);

    await expect(ask(t, "What is our lowest cash week?", { companyId: "nobody" })).rejects.toThrow(
      /No saved run/,
    );
    await expect(
      ask(t, "What is our lowest cash week?", { runId: "timeline:run/missing" }),
    ).rejects.toThrow(/No saved run/);
  });

  it("rejects a run that fails the strict workspace projection and writes nothing", async () => {
    const t = setup();
    putRun({ ...base, runId: "timeline:run/drift", extraField: true });
    await expect(
      ask(t, "What is our lowest cash week?", { runId: "timeline:run/drift" }),
    ).rejects.toThrow(/integrity/);
    putRun({
      ...base,
      runId: "timeline:run/mislabeled",
      companyId: "kestrel",
      baselineRunId: "timeline:baseline/other",
    });
    await expect(
      ask(t, "What is our lowest cash week?", { runId: "timeline:run/mislabeled" }),
    ).rejects.toThrow(/integrity/);
    expect(await rows(t)).toHaveLength(0);
  });

  it.each([
    [{ requestId: "x" }, /requestId/],
    [{ selectedWeek: "2026-11-03" }, /Monday/],
    [{ selectedWeek: "2030-01-07" }, /not a week of this run/],
    [{ selectedItemId: "inv_missing" }, /not an item of this run/],
  ])("rejects invalid input %o before saving", async (over, message) => {
    const t = setup();
    await expect(ask(t, "What is our lowest cash week?", over)).rejects.toThrow(message);
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("timeline questions: lease", () => {
  const claimArgs = (requestId: string) => ({
    companyId: "kestrel",
    runId: BASE,
    requestId,
    inputHash: "h".repeat(64),
    prompt: "What is our lowest cash week?",
    selectedWeek: null,
    selectedItemId: null,
    method: "provider",
    parentConstraintsJson: "[]",
  });

  it("fails an abandoned ask after its lease and keeps a late finish from overwriting it", async () => {
    vi.useFakeTimers();
    const t = setup();
    const { claimed, receipt } = await t.mutation(q.claim, claimArgs("req-abandoned-1"));
    expect(claimed).toBe(true);
    expect(receipt.status).toBe("running");
    expect(await t.query(q.list, { companyId: "kestrel", runId: BASE })).toMatchObject([
      { status: "running" },
    ]);

    vi.advanceTimersByTime(LEASE_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [expired] = await t.query(q.list, { companyId: "kestrel", runId: BASE });
    expect(expired).toMatchObject({ status: "failed", errorCode: "LEASE_EXPIRED", proposal: null });

    const late = await t.mutation(q.finalize, {
      companyId: "kestrel",
      requestId: "req-abandoned-1",
      outcomeJson: JSON.stringify({ status: "answered", answer: "late", citations: [] }),
    });
    expect(late).toEqual(expired);
  });

  it("fails an expired running ask when the same request is retried", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.mutation(q.claim, claimArgs("req-abandoned-2"));
    vi.advanceTimersByTime(LEASE_MS + 1);
    const retry = await t.mutation(q.claim, claimArgs("req-abandoned-2"));
    expect(retry).toMatchObject({
      claimed: false,
      receipt: { status: "failed", errorCode: "LEASE_EXPIRED" },
    });
  });

  it("returns a still-running receipt to a concurrent retry", async () => {
    const t = setup();
    await t.mutation(q.claim, claimArgs("req-running-1"));
    const retry = await t.mutation(q.claim, claimArgs("req-running-1"));
    expect(retry).toMatchObject({ claimed: false, receipt: { status: "running" } });
  });

  it("saves an outcome that is not the exact contract as an internal failure", async () => {
    const t = setup();
    await t.mutation(q.claim, claimArgs("req-bad-outcome"));
    const r = await t.mutation(q.finalize, {
      companyId: "kestrel",
      requestId: "req-bad-outcome",
      outcomeJson: JSON.stringify({
        status: "answered",
        answer: "x",
        citations: [],
        raw: "provider text",
      }),
    });
    expect(r).toMatchObject({ status: "failed", errorCode: "INTERNAL" });
  });
});

describe("timeline questions: link", () => {
  const CHILD = "timeline:run/kestrel-child";

  it("links a proposal to the exact confirmed run, once", async () => {
    const t = setup();
    const p = await ask(t, "What if Acme pays 14 days late?");
    const changes = p.proposal?.changes ?? [];
    putRun(makeRun({ runId: CHILD, parentRunId: BASE, kind: "scenario", ownChanges: changes }));
    expect(
      await t.mutation(q.link, { companyId: "kestrel", questionId: p.id, resultRunId: CHILD }),
    ).toEqual({
      linkedRunId: CHILD,
    });
    expect(
      await t.mutation(q.link, { companyId: "kestrel", questionId: p.id, resultRunId: CHILD }),
    ).toEqual({
      linkedRunId: CHILD,
    });
    const [saved] = await t.query(q.list, { companyId: "kestrel", runId: BASE });
    expect(saved?.linkedRunId).toBe(CHILD);
    putRun(
      makeRun({
        runId: "timeline:run/kestrel-child-2",
        parentRunId: BASE,
        kind: "scenario",
        ownChanges: changes,
      }),
    );
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/kestrel-child-2",
      }),
    ).rejects.toThrow(/already linked/);
  });

  it("links a rule proposal only to a run with exactly those rules", async () => {
    const t = setup();
    const p = await ask(t, "Keep usable cash above $3M");
    const rules = p.proposal?.constraints ?? [];
    expect(rules).toHaveLength(2);
    putRun(
      makeRun({
        runId: "timeline:run/wrong-rules",
        parentRunId: BASE,
        kind: "rules",
        constraints: [MIN_CASH],
      }),
    );
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/wrong-rules",
      }),
    ).rejects.toThrow(/rules differ/);
    putRun(
      makeRun({
        runId: "timeline:run/rules",
        parentRunId: BASE,
        kind: "rules",
        constraints: rules,
      }),
    );
    expect(
      await t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/rules",
      }),
    ).toEqual({ linkedRunId: "timeline:run/rules" });
  });

  it("rejects a result with other changes, another parent, another company or no proposal", async () => {
    const t = setup();
    const p = await ask(t, "What if Acme pays 14 days late?");
    putRun(
      makeRun({
        runId: "timeline:run/other-change",
        parentRunId: BASE,
        kind: "scenario",
        ownChanges: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 15 }],
      }),
    );
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/other-change",
      }),
    ).rejects.toThrow(/changes differ/);
    putRun(
      makeRun({
        runId: "timeline:run/orphan",
        parentRunId: "timeline:run/elsewhere",
        kind: "scenario",
        ownChanges: p.proposal?.changes ?? [],
      }),
    );
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/orphan",
      }),
    ).rejects.toThrow(/not created from/);
    await expect(
      t.mutation(q.link, {
        companyId: "zephyr",
        questionId: p.id,
        resultRunId: "timeline:run/orphan",
      }),
    ).rejects.toThrow(/No saved question/);
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: p.id,
        resultRunId: "timeline:run/missing",
      }),
    ).rejects.toThrow(/No saved run/);
    const answer = await ask(t, "What is our lowest cash week?");
    await expect(
      t.mutation(q.link, {
        companyId: "kestrel",
        questionId: answer.id,
        resultRunId: "timeline:run/orphan",
      }),
    ).rejects.toThrow(/Only a proposed change/);
    const [saved] = await t.query(q.list, { companyId: "kestrel", runId: BASE });
    expect(saved?.linkedRunId).toBeNull();
  });
});
