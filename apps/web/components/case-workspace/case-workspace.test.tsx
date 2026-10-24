import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let path = "/case/2u";
let query = "";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useSearchParams: () => new URLSearchParams(query),
}));
// The saved reads are queries that need a Convex provider; their own views are tested elsewhere.
vi.mock("../investigate/live/CompanyKnowledge", () => ({
  CompanyKnowledge: ({ runId }: { runId?: string }) =>
    createElement("p", null, `knowledge:${runId}`),
}));
vi.mock("../investigate/live/FinancialOutput", () => ({ FinancialOutput: () => null }));
vi.mock("../investigate/live/InvestigateLive", () => ({
  InvestigateLive: () => null,
  readConversation: () => ({ state: "loading" }),
}));

import { type Conversation, adaptConversation } from "../investigate/live/adapt";
import { CaseNav } from "./CaseNav";
import { CompanyBody } from "./CompanyView";
import { SimulationDetailView } from "./SimulationDetail";
import { SimulationRow } from "./SimulationList";
import { caseHref, openInvestigation } from "./links";
import { summarize } from "./summary";

type Op = Conversation["operations"][number];
const op = (o: Partial<Op> & Pick<Op, "operationId" | "kind" | "status">): Op => ({
  sequence: Number(o.operationId.slice(2)),
  title:
    o.kind === "source_load"
      ? "Load filings"
      : o.kind === "forecast"
        ? "Save forecast"
        : "Another step",
  dependsOn: [],
  createdAt: "2026-10-24T18:00:00.000Z",
  ...o,
});
const conversation = (operations: Op[], busy = false): Conversation => ({
  conversationId: "conv_abc",
  busy,
  canReveal: false,
  canAlternative: false,
  messages: [
    { id: "m1", sequence: 1, role: "user", kind: "question", text: "What happened to 2U's cash?" },
    { id: "m2", sequence: 2, role: "assistant", kind: "assessment", text: "Cash fell." },
  ],
  operations,
});
const sources = op({
  operationId: "op1",
  kind: "source_load",
  status: "succeeded",
  output: {
    origin: "curated_archive",
    sources: [
      {
        id: "s1",
        title: "Quarterly report",
        url: "https://example.com/q",
        publishedAt: "2023-11-08",
      },
      { id: "s2", title: "Odd date", url: "javascript:alert(1)", publishedAt: "soon" },
    ],
  },
});
const forecast = op({
  operationId: "op2",
  kind: "forecast",
  status: "succeeded",
  dependsOn: ["op1"],
  outputRef: { kind: "run", id: "baseline-1" },
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("case links", () => {
  it("keeps the open investigation, encoded, and omits it when none is open", () => {
    expect(caseHref.workspace()).toBe("/case/2u");
    expect(caseHref.company("a b")).toBe("/case/2u/company?c=a%20b");
    expect(caseHref.simulations("x")).toBe("/case/2u/simulations?c=x");
    expect(caseHref.detail("x/y")).toBe("/case/2u/simulations/x%2Fy");
  });

  it("takes the open investigation from the detail path before c", () => {
    expect(openInvestigation("/case/2u/simulations/a", "b")).toBe("a");
    expect(openInvestigation("/case/2u/company", "b")).toBe("b");
    expect(openInvestigation("/case/2u", null)).toBeUndefined();
    expect(openInvestigation("/case/2u/simulations/%E0%A4%A", "b")).toBe("b");
  });
});

describe("CaseNav", () => {
  it("shows exactly three links, carries c, and marks the current page", () => {
    path = "/case/2u/company";
    query = "c=conv_abc";
    const out = html(createElement(CaseNav));
    expect(out).toContain('href="/case/2u?c=conv_abc"');
    expect(out).toContain('href="/case/2u/company?c=conv_abc"');
    expect(out).toContain('href="/case/2u/simulations?c=conv_abc"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Company</);
  });

  it("keeps the investigation open while viewing its detail page", () => {
    path = "/case/2u/simulations/conv_abc";
    query = "";
    expect(html(createElement(CaseNav))).toContain('href="/case/2u/company?c=conv_abc"');
  });
});

describe("summarize", () => {
  it("names only branches that really succeeded", () => {
    const failedReveal = op({ operationId: "op3", kind: "reveal", status: "failed" });
    const s = summarize(conversation([sources, forecast, failedReveal]));
    expect(s.branches).toEqual(["Saved forecast"]);
    expect(s.status).toBe("1 step did not finish");
    expect(s.question).toBe("What happened to 2U's cash?");
  });

  it("does not call unknown or running work finished", () => {
    const unknown = op({ operationId: "op3", kind: "alternative", status: "unknown" });
    expect(summarize(conversation([forecast, unknown])).status).toBe(
      "1 step with an unknown outcome",
    );
    expect(summarize(conversation([forecast], true)).status).toBe("Domino is still working");
    expect(summarize(conversation([])).status).toBe("No steps recorded yet");
  });
});

describe("simulation detail", () => {
  const conv = conversation([sources, forecast]);
  const adapted = adaptConversation(conv);

  it("opens on a readable overview with no ids or method text", () => {
    const out = html(createElement(SimulationDetailView, { conversation: conv, adapted }));
    for (const tab of ["Overview", "Impact chain", "Chart", "Execution"])
      expect(out).toContain(tab);
    expect(out).toContain("What happened to 2U&#x27;s cash?");
    expect(out).toContain("Cash fell.");
    expect(out).toContain("Saved forecast");
    expect(out).not.toMatch(/op1|op2|baseline-1|conv_abc.*Operation|curated_archive/);
    expect(out).toContain('href="/case/2u?c=conv_abc"');
  });

  it("says the impact chain is not computed instead of drawing steps as causes", () => {
    const out = html(
      createElement(SimulationDetailView, {
        conversation: conv,
        adapted,
        initialTab: "Impact chain",
      }),
    );
    expect(out).toContain("Not computed yet.");
    expect(out).toContain("not cause and effect");
    expect(out).not.toContain("Load filings");
  });

  it("points every panel label at a tab with a valid single id", () => {
    for (const initialTab of ["Overview", "Impact chain", "Chart", "Execution"] as const) {
      const out = html(
        createElement(SimulationDetailView, { conversation: conv, adapted, initialTab }),
      );
      const labelled = /role="tabpanel"[^>]*aria-labelledby="([^"]*)"/.exec(out)?.[1] ?? "";
      expect(labelled).toMatch(/^\S+$/);
      const tab = new RegExp(`<button[^>]*id="${labelled.replace(/[:]/g, "\\$&")}"[^>]*>([^<]*)<`);
      expect(tab.exec(out)?.[1]).toBe(initialTab);
    }
  });

  it("says there is no chart until a forecast step finished", () => {
    const none = conversation([sources]);
    const out = html(
      createElement(SimulationDetailView, {
        conversation: none,
        adapted: adaptConversation(none),
        initialTab: "Chart",
      }),
    );
    expect(out).toContain("No chart yet.");
  });

  it("row links to the detail page", () => {
    expect(html(createElement(SimulationRow, { conversation: conv }))).toContain(
      'href="/case/2u/simulations/conv_abc"',
    );
  });
});

describe("map labels", () => {
  it("shows short names and keeps the stored title in the details", () => {
    const stored = op({
      operationId: "op2",
      kind: "forecast",
      status: "succeeded",
      title: "Engine forecast (quarterly cash bridge)",
    });
    const nodes = adaptConversation(conversation([sources, stored])).nodes;
    const node = nodes.find((n) => n.id === "op2");
    expect(node?.title).toBe("Cash forecast");
    expect(node?.metadata).toContainEqual({
      label: "Recorded step",
      value: "Engine forecast (quarterly cash bridge)",
    });
    expect(nodes.find((n) => n.id === "op1")?.title).toBe("Archived disclosure");
  });
});

describe("CompanyBody", () => {
  it("reads the saved baseline run and lists sources safely", () => {
    const out = html(
      createElement(CompanyBody, { adapted: adaptConversation(conversation([sources, forecast])) }),
    );
    expect(out).toContain("knowledge:baseline-1");
    expect(out).toContain("no invoice, customer or payroll records");
    expect(out).toContain('href="https://example.com/q"');
    expect(out).toContain("Published");
    expect(out).toContain("Odd date");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("Published soon");
  });

  it("asks for no run before a forecast is saved", () => {
    const out = html(
      createElement(CompanyBody, { adapted: adaptConversation(conversation([sources])) }),
    );
    expect(out).toContain("knowledge:undefined");
  });
});
