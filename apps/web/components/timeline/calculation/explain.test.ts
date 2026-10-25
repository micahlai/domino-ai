import { describe, expect, it } from "vitest";
import { fixtureBaseline, fixtureRoot, fixtureScenario } from "../workspace/fixtures";
import { calculationExplain } from "./explain";

describe("saved Timeline calculation story", () => {
  it("uses snapshot names, compact saved money and plural counts", () => {
    const run = {
      ...fixtureScenario,
      label: "Invoice inv_acme_2027 is paid 14 additional days late",
    };
    const e = calculationExplain(run, fixtureBaseline);
    expect(e.change.headline).toBe("Acme Logistics pays 30 days late");
    expect(e.change.facts).toEqual([
      {
        text: "Invoice amount",
        money: { cents: 24_000_000, short: "$240K", exact: "$240,000.00" },
      },
    ]);
    expect(e.subtitle).not.toContain("inv_acme_2027");
    expect(e.subtitle).toContain("Acme Logistics pays 30 days late");
    expect(e.calc.headline).toBe("13 weeks forecast · 1 rule checked");
    expect(e.calc.facts[0]?.text).toBe("1 change applied");
    expect(e.title).toBe("Cash falls below the $3.2M minimum in the week of Dec 14, 2026");
    expect(e.result).toMatchObject({ tone: "below", badge: "Falls below" });
    expect(e.result.floor?.exact).toBe("$3,150,000.00");
    // Exact values stay reachable in Details.
    const exact = e.details.find((g) => g.title === "Exact values")?.rows ?? [];
    expect(exact.map((r) => r.value).join(" ")).toContain(e.result.low?.exact ?? "missing");
  });

  it("shows engine-only work with no agents and says no AI was used", () => {
    const e = calculationExplain(fixtureRoot, fixtureBaseline);
    expect(e.change).toMatchObject({ tone: "none" });
    expect(e.map.agentWork).toBe(false);
    expect(e.map.nodes.map((n) => n.id)).toEqual(["books", "engine", "result"]);
    expect(e.map.edges.map((x) => `${x.from}>${x.to}`)).toEqual(["books>engine", "engine>result"]);
    expect(e.map.note).toBe("Calculated directly by the forecast engine; no AI was used.");
    expect(e.calc.facts[0]?.text).toBe("No changes applied");
    const fromSuggestion = calculationExplain(fixtureScenario, fixtureBaseline, {
      fromSuggestion: true,
    });
    expect(fromSuggestion.map.nodes[0]?.label).toBe("Field suggestion");
  });
});
