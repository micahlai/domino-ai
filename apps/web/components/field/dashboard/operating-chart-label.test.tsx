import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashFlowBars } from "./charts";
import type { DashboardBar } from "./derive";

const week = (weekStart: string, kind: DashboardBar["kind"], partial = false): DashboardBar => ({
  weekStart,
  kind,
  partial,
  operating: 0,
  investing: 0,
  financing: 0,
  netChange: 0,
  endingCash: 0,
});

describe("operating cash-flow chart labels", () => {
  it("calls derived weekly history reconstructed while preserving projected weeks", () => {
    const html = renderToStaticMarkup(
      <CashFlowBars
        bars={[
          week("2023-09-11", "actual"),
          week("2023-09-18", "actual", true),
          week("2023-09-25", "projected"),
        ]}
      />,
    );
    expect(html).toContain("Reconstructed history, week so far");
    expect(html).toContain("Reconstructed history (solid)");
    expect(html).toContain("Projected (outlined)");
    expect(html).not.toMatch(/\bActual\b/);
  });
});
