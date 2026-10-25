import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  fixtureText,
  verifySeedText,
  verifyWeeklySeedText,
  weeklyFixtureText,
} from "../../../lib/feature-boundary/verify";
import { HistoricalReplay } from "../../historical/HistoricalReplay";
import { TimelineBackendSmoke } from "./TimelineBackendSmoke";
import { WeeklySeedSummary } from "./WeeklySeedPanel";
import { PEER_FIXTURE_DISCLOSURE, seedView } from "./seedView";

describe("timeline seam harness", () => {
  it("renders a verified seed through the unchanged HistoricalReplay props", async () => {
    const r = await verifySeedText(fixtureText("validTwoUSeed"), { forecastReady: true });
    if (!r.ok) throw new Error(r.reason);
    const view = seedView(r.value);
    expect(view.stage).toBe("baseline");
    expect(view.projected).toEqual([]);
    expect(view.disclosure).toBe(PEER_FIXTURE_DISCLOSURE);
    // Reported points are seed fact cents passed through, never recomputed.
    const facts = new Map(r.value.snapshot.case.facts.map((f) => [f.id, f.cents]));
    expect(view.reported.length).toBeGreaterThan(0);
    for (const p of view.reported) expect(p.cash).toBe(facts.get(p.id));
    const html = renderToStaticMarkup(<HistoricalReplay view={view} />);
    expect(html).toContain("2U, Inc. (peer fixture seed)");
  });

  it("says the backend is not configured when no Convex URL is set", () => {
    expect(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").toBe("");
    const html = renderToStaticMarkup(<TimelineBackendSmoke caseId="twou-2023-cash-v1" />);
    expect(html).toContain("Backend not configured");
  });

  it("summarizes a verified weekly seed: company, asOf, scheduled items, findings", async () => {
    const r = await verifyWeeklySeedText(weeklyFixtureText("validKestrelWeeklySeed"));
    if (!r.ok) throw new Error(r.reason);
    const html = renderToStaticMarkup(<WeeklySeedSummary seed={r.value} />);
    expect(html).toContain("Kestrel Data");
    expect(html).toContain("(kestrel)");
    for (const item of r.value.scheduledItems) expect(html).toContain(`scheduled-${item.id}`);
    expect(html).toContain("finding-finding_nw_expansion_unsigned");
  });
});
