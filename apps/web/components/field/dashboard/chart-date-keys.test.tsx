import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashFlowBars, CashLine, chartDateKey } from "./charts";
import type { CashPoint, DashboardBar } from "./derive";

const bar = (kind: DashboardBar["kind"]): DashboardBar => ({
  weekStart: "2023-11-27",
  kind,
  partial: false,
  operating: 0,
  investing: 0,
  financing: 0,
  netChange: 0,
  endingCash: 0,
});

const point = (label: CashPoint["label"]): CashPoint => ({
  weekStart: "2023-11-27",
  label,
  usable: 100_00,
});

describe("chart date keys", () => {
  it("distinguishes roles that share a date while keeping keys deterministic", () => {
    expect(chartDateKey("today", "2023-11-27")).not.toBe(chartDateKey("week", "2023-11-27"));
    expect(chartDateKey("actual", "2023-11-27")).not.toBe(chartDateKey("projected", "2023-11-27"));
    expect(chartDateKey("today", "2023-11-27")).toBe(chartDateKey("today", "2023-11-27"));
  });

  it("renders same-week actual and projected bars", () => {
    renderToStaticMarkup(<CashFlowBars bars={[bar("actual"), bar("projected")]} />);
  });

  it("renders today and a forecast point that share a date", () => {
    renderToStaticMarkup(
      <CashLine
        points={[point("today"), point("week")]}
        minimum={null}
        markers={[]}
        breach={null}
      />,
    );
  });
});
