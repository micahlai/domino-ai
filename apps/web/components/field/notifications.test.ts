import { describe, expect, it } from "vitest";
import type { FieldNotificationEvent } from "../../convex/fieldNotifications";
import { mapNodeHref, nodeResults, recordSourceNode, resolveMapNode } from "./cross-links";
import { eventToast, freshEvents, verdictToast } from "./notifications";

const suggestion: FieldNotificationEvent = {
  key: "suggestion:s1:credit_line_draw:1",
  kind: "suggestion",
  at: 1,
  suggestionId: "s1:credit_line_draw",
  scenarioId: "s1",
  scenarioTitle: "Late payments",
  label: "Draw $1.2M on the credit line",
  fixKind: "credit_line_draw",
};
const flag: FieldNotificationEvent = {
  key: "flag:f1",
  kind: "flag",
  at: 2,
  findingId: "f1",
  summary: "Duplicate bill from Acme",
};

describe("notifications", () => {
  it("never toasts the first read, then toasts each new event once", () => {
    const seen = new Set<string>();
    expect(freshEvents([suggestion], seen, false)).toEqual([]);
    expect(freshEvents([flag, suggestion], seen, true)).toEqual([flag]);
    expect(freshEvents([flag, suggestion], seen, true)).toEqual([]);
  });

  it("builds a short title, one line and an exact link", () => {
    expect(eventToast(suggestion, "c1")).toMatchObject({
      title: "New recommended fix",
      line: "Draw $1.2M on the credit line",
      href: "/field#suggestion-s1_credit_line_draw",
    });
    expect(eventToast(flag, "c1").href).toBe("/field#flag-f1");
    const run = eventToast(
      {
        key: "run:r1",
        kind: "run",
        at: 3,
        runId: "r1",
        label: "Late payments",
        worldId: "operating/2u/baseline",
        runKind: "scenario",
      },
      "c1",
    );
    expect(run.title).toBe("New scenario saved");
    expect(run.href).toBe("/c/operating%2F2u%2Fbaseline/timeline/calculation?runId=r1");
    expect(
      eventToast(
        { key: "agents:a", kind: "agents", at: 4, runId: "a", summary: "", children: 3 },
        "c1",
      ),
    ).toMatchObject({ title: "Agents finished", line: "Checked 3 scenarios on the latest books." });
    expect(verdictToast("watch", "at_risk", 5).line).toBe("Now At risk, was Watch.");
  });
});

describe("cross-links", () => {
  it("maps records and ?node= values to existing map nodes", () => {
    expect(recordSourceNode("card_1")).toBe("source:cards");
    expect(recordSourceNode("2026-10-25")).toBeNull();
    const ids = ["agent:audit", "source:cards", "output:flags"];
    expect(resolveMapNode("agent:audit", ids)).toBe("agent:audit");
    expect(resolveMapNode("cards", ids)).toBe("source:cards");
    expect(resolveMapNode("nope", ids)).toBeNull();
    expect(mapNodeHref("agent:audit")).toBe("/field/map?node=agent%3Aaudit");
  });

  it("links agents and outputs to the pages they produced", () => {
    expect(nodeResults({ id: "agent:audit" })[0]?.href).toBe("/field#flags-title");
    expect(nodeResults({ id: "agent:forecaster#2", role: "forecaster" })[0]?.label).toBe(
      "See risks",
    );
    expect(nodeResults({ id: "source:cards" })).toEqual([]);
  });
});
