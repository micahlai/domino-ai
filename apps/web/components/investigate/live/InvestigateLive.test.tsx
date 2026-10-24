import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinancialOutputView } from "./FinancialOutput";
import { InvestigateLive } from "./InvestigateLive";
import type { OutputTarget } from "./adapt";

const html = (target: OutputTarget, raw: Parameters<typeof FinancialOutputView>[0]["raw"]) =>
  renderToStaticMarkup(<FinancialOutputView target={target} raw={raw} />);
const forecast: OutputTarget = { stage: "forecast", baselineRunId: "b1", revealed: false };
const reveal: OutputTarget = { stage: "reveal", baselineRunId: "b1", revealed: true };

describe("FinancialOutputView", () => {
  it("shows loading, not empty, while records are unread", () => {
    expect(html(forecast, {})).toContain("Loading the saved case");
  });

  it("reports a failed read instead of drawing nothing", () => {
    const out = html(forecast, { case: new Error("x"), run: undefined });
    expect(out).toContain("Could not load this result");
  });

  it("refuses a malformed record rather than guessing", () => {
    const out = html(forecast, { case: { nope: 1 }, run: { nope: 1 } });
    expect(out).toContain("not in the expected shape");
  });

  it("never reads the reveal for the forecast view", () => {
    // A reveal error is irrelevant to a forecast node, so it must not surface there.
    const out = html(forecast, { case: undefined, run: undefined, reveal: new Error("x") });
    expect(out).toContain("Loading the saved case");
  });

  it("needs the reveal record for a reveal node", () => {
    expect(html(reveal, { case: {}, run: {}, reveal: undefined })).toContain("Loading");
    expect(html(reveal, { case: {}, run: {}, reveal: new Error("x") })).toContain(
      "Could not load this result",
    );
  });

  it("holds an alternative back until a reveal exists", () => {
    const out = html(
      { stage: "alternative", baselineRunId: "b1", altRunId: "a1", revealed: false },
      {},
    );
    expect(out).toContain("saved, but not shown yet");
    expect(out).toContain("Show what happened first");
  });
});

describe("InvestigateLive", () => {
  it("is honestly unavailable with no deployment and stages nothing", () => {
    const out = renderToStaticMarkup(<InvestigateLive />);
    expect(out).toContain("not connected to the investigation service");
    expect(out).toContain("Waiting for a question");
    expect(out).toContain("Unavailable right now");
  });
});
