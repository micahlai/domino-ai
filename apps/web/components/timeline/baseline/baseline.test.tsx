import { type Evidence, type ForecastWeek, WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { ConvexError } from "convex/values";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaselineImportForm } from "./BaselineImportForm";
import { describeSaveError } from "./BaselineLive";
import { SavedBaselineState, SavedBaselineView } from "./SavedBaselineView";
import {
  NEUTRAL_MODEL,
  type SavedBaseline,
  baselineHref,
  baselineKeyFromSearch,
  readBaseline,
} from "./api";
import { formatExactCents } from "./format";

const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);

/** Thirteen Mondays from the seed's week 0. Test data only; the UI never derives weeks. */
function weeks(): ForecastWeek[] {
  const start = Date.parse(`${seed.asOf}T00:00:00Z`);
  return Array.from({ length: 13 }, (_, i) => {
    const weekStart = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const closing = 500_000_00 - i * 1_234_56 + (i === 12 ? 9_000_01 : 0);
    return {
      weekStart,
      opening: closing + 1_000_00,
      inflow: 2_000_00,
      outflow: 3_000_00,
      closing,
      usable: closing - 7,
    };
  });
}

const forecastWeeks = weeks();
const low = forecastWeeks[11] as ForecastWeek;
const saved: SavedBaseline = {
  runId: "timeline:run/abc 1",
  companyId: seed.company.id,
  companyName: seed.company.name,
  seedHash: seed.contentHash,
  inputHash: "f".repeat(64),
  methodVersion: "timeline-baseline-v1",
  assumptionNote: "Neutral starting model for the test.",
  model: NEUTRAL_MODEL,
  constraints: [],
  seed,
  forecast: {
    weeks: forecastWeeks,
    lowPoint: { weekStart: low.weekStart, usable: low.usable },
  },
  dominoes: [],
  history: [],
  pastEvents: [],
  savedAt: "2026-10-24T15:04:05.000Z",
};
const key = { companyId: saved.companyId, runId: saved.runId };

describe("formatExactCents", () => {
  it("shows exact dollars and cents, never abbreviated", () => {
    expect(formatExactCents(123_456_708)).toBe("$1,234,567.08");
    expect(formatExactCents(-4_000)).toBe("-$40.00");
    expect(formatExactCents(0)).toBe("$0.00");
  });
});

describe("saved baseline link", () => {
  it("encodes companyId and runId with URLSearchParams and reads them back", () => {
    const href = baselineHref(key);
    expect(href).toBe("/playground/timeline-seam?companyId=kestrel&runId=timeline%3Arun%2Fabc+1");
    const read = baselineKeyFromSearch(href.split("?")[1] ?? "");
    expect(read).toEqual({ kind: "key", key });
  });

  it("reports a half link instead of guessing", () => {
    expect(baselineKeyFromSearch("runId=x")).toEqual({ kind: "partial" });
    expect(baselineKeyFromSearch("")).toEqual({ kind: "none" });
  });
});

describe("readBaseline", () => {
  it("separates loading, not found, unusable and ready", () => {
    expect(readBaseline(undefined, key)).toEqual({ state: "loading" });
    expect(readBaseline(null, key)).toEqual({ state: "missing" });
    expect(readBaseline({ ...saved, _id: "x" }, key)).toEqual({ state: "unusable" });
    expect(readBaseline(saved, { ...key, companyId: "other" })).toEqual({ state: "unusable" });
    const ready = readBaseline(JSON.parse(JSON.stringify(saved)), key);
    expect(ready.state).toBe("ready");
  });
});

describe("SavedBaselineView", () => {
  const html = renderToStaticMarkup(<SavedBaselineView baseline={saved} />);

  it("shows all 13 saved weeks with exact dollars and dates", () => {
    for (const w of forecastWeeks) {
      expect(html).toContain(`data-testid="week-${w.weekStart}"`);
      expect(html).toContain(formatExactCents(w.usable));
      expect(html).toContain(formatExactCents(w.closing));
    }
    expect(html.match(/data-testid="week-/g)).toHaveLength(13);
  });

  it("names the saved low point in the headline and marks only that week", () => {
    expect(html).toContain(`dateTime="${low.weekStart}"`);
    const headline = html.slice(html.indexOf("baseline-headline"), html.indexOf("</h2>"));
    expect(headline).toContain(formatExactCents(low.usable));
    expect(headline).toContain(low.weekStart);
    expect(html.match(/data-low-point="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-testid="week-${low.weekStart}" data-low-point="true"`);
  });

  it("shows assumptions, provenance and the original inputs", () => {
    expect(html).toContain("Neutral starting model for the test.");
    expect(html).toContain("No lender’s limits or other cash rules");
    expect(html).toContain(saved.seedHash);
    expect(html).toContain(saved.inputHash);
    expect(html).toContain(saved.methodVersion);
    expect(html).toContain("Show the original weekly seed");
    expect(html).toContain(seed.id);
    expect(html).toContain("No problems were saved with this forecast.");
  });

  it("lists saved cash rules and problems as saved", () => {
    const withRules = renderToStaticMarkup(
      <SavedBaselineView
        baseline={{
          ...saved,
          constraints: [
            {
              id: "c1",
              label: "Lender's minimum",
              kind: "min_cash",
              limit: 300_000_00,
              evidence: { source: "document", ref: "loan.pdf#7", note: "Loan terms." } as Evidence,
            },
          ],
          dominoes: [
            {
              order: 1,
              weekStart: low.weekStart,
              label: "Usable cash falls below the lender's minimum",
              constraintId: "c1",
              evidence: [],
            },
          ],
        }}
      />,
    );
    expect(withRules).toContain("Keep at least $300,000.00 of usable cash");
    expect(withRules).toContain("Usable cash falls below the lender&#x27;s minimum");
    expect(withRules).not.toContain("no rule can be broken");
  });
});

describe("SavedBaselineState", () => {
  it("never shows loading, not found or unusable as an empty forecast", () => {
    const loading = renderToStaticMarkup(<SavedBaselineState read={{ state: "loading" }} />);
    expect(loading).toContain("Opening the saved forecast...");
    expect(renderToStaticMarkup(<SavedBaselineState read={{ state: "missing" }} />)).toContain(
      "No saved forecast at this link",
    );
    expect(renderToStaticMarkup(<SavedBaselineState read={{ state: "unusable" }} />)).toContain(
      "cannot be shown",
    );
    for (const s of ["loading", "missing", "unusable"] as const)
      expect(renderToStaticMarkup(<SavedBaselineState read={{ state: s }} />)).not.toContain(
        "saved-baseline",
      );
  });
});

describe("BaselineImportForm", () => {
  const html = renderToStaticMarkup(<BaselineImportForm onSave={() => undefined} />);

  it("starts from the labelled fixture and the explicit neutral model, unreviewed", () => {
    expect(html).toContain("Peer fixture");
    expect(html).toContain("Load Kestrel weekly seed");
    expect(html).toContain("&quot;customerDelayDays&quot;: {}");
    expect(html).toContain("No lender’s limits are added");
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""/);
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("explains why saving is blocked when the service is not connected", () => {
    const off = renderToStaticMarkup(
      <BaselineImportForm onSave={() => undefined} unavailable="Not connected." />,
    );
    expect(off).toContain("Not connected.");
  });
});

describe("describeSaveError", () => {
  it("passes a service reason through and never claims a lost save failed", () => {
    expect(describeSaveError(new ConvexError("reviewed must be true"))).toBe(
      "Not saved: reviewed must be true",
    );
    expect(describeSaveError(new Error("network"))).toContain("may or may not have been recorded");
  });
});
