import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DifferenceChart } from "./DifferenceChart";

const weeks = ["2023-10-02", "2023-10-09", "2023-10-16", "2023-10-23"];
const series = (deltas: number[]) => ({
  runId: "r1",
  label: "Predicted: Lawsuit",
  color: "#7c3aed",
  points: weeks.map((weekStart, i) => ({ weekStart, delta: deltas[i] ?? 0 })),
});

describe("DifferenceChart", () => {
  it("draws each scenario against a zero line with money gridlines", () => {
    const html = renderToStaticMarkup(
      <DifferenceChart series={[series([0, -8_630_100, 178_278_600, 580_841_000])]} />,
    );
    expect(html).toContain("No change");
    expect(html).toContain('stroke="#7c3aed"');
    expect(html).toContain("+$2M");
    expect(html).toContain("ends +$5.8M");
    expect(html).toContain("Predicted: Lawsuit, week of Oct 23, 2023: +$5.8M");
  });

  it("says when a scenario ends level and asks for a scenario when none is shown", () => {
    expect(renderToStaticMarkup(<DifferenceChart series={[series([0, 0, 0, 0])]} />)).toContain(
      "ends level",
    );
    expect(renderToStaticMarkup(<DifferenceChart series={[]} />)).toContain("Tick a scenario");
  });
});
