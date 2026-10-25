import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PredictionView } from "./PredictionControl";
import { PredictionSchema } from "./prediction";
import { donePrediction, runningPrediction } from "./predictionFixtures";

const render = (props: Parameters<typeof PredictionView>[0]) =>
  renderToStaticMarkup(<PredictionView {...props} />);

describe("PredictionView", () => {
  it("offers to predict a scenario that has no prediction", () => {
    const html = render({ name: "Buy equipment", prediction: null, onStart: () => undefined });
    expect(html).toContain("Predict knock-on effects");
  });

  it("shows a progress bar, the stage and the latest agent step while running", () => {
    const html = render({ name: "Buy equipment", prediction: runningPrediction });
    expect(html).toContain('value="46"');
    expect(html).toContain("46%");
    expect(html).toContain("Asking the agents for knock-on effects");
    expect(html).toContain("Read the brain map: research");
    expect(html).not.toContain("Predict knock-on effects");
  });

  it("summarises effects, lost interest and rejected proposals when done", () => {
    const html = render({
      name: "Buy equipment",
      prediction: donePrediction,
      onShow: () => undefined,
      onStart: () => undefined,
    });
    expect(html).toContain("Show predicted line");
    expect(html).toContain("1 knock-on effect");
    expect(html).toContain("interest lost $68.2K at 4.5%/yr");
    expect(html).toContain("Not used: Acme leaves");
    expect(html).toContain("growth spending cut 25%");
    expect(html).toContain("Management response");
    expect(html).toContain("Cut Campaign services by 25% from 2026-11-24");
    expect(html).toContain("Agents read: Ask Domino conversation");
    expect(html).toContain("Predict again");
  });

  it("shows the error and a retry for a failed prediction", () => {
    const html = render({
      name: "Buy equipment",
      prediction: { ...donePrediction, status: "failed", error: "Timed out", resultRunId: null },
      onStart: () => undefined,
    });
    expect(html).toContain("Timed out");
    expect(html).toContain("Predict again");
  });

  it("accepts the backend receipt shape, extra fields included", () => {
    expect(
      PredictionSchema.safeParse({ ...donePrediction, field: { status: "missing" }, floor: null })
        .success,
    ).toBe(true);
  });
});
