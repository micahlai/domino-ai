import { operatingProvenance } from "@domino/sim";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceContents } from "./OperatingProvenanceStrip";

describe("operating source panel", () => {
  it("shows separate 2U ledger and publication dates plus the reported and reconstructed AP basis", () => {
    const context = operatingProvenance({ company: "2u", scenario: "baseline" });
    const html = renderToStaticMarkup(<SourceContents context={context} />);
    expect(html).toContain(`Reported and derived anchors (${context.reported.length})`);
    expect(html).toMatch(/<details><summary[^>]*>Reported and derived anchors/);
    expect(html).toContain("2023-09-30");
    expect(html).toContain("2023-11-09");
    expect(html).toContain("historical ledger date");
    expect(html).toContain("later actuals are in the separate historical case");
    expect(html).not.toContain("historical cutoff");
    expect(html).toContain("combined cash including restricted");
    expect(html).toContain("2U payables and accruals bridge");
    expect(html).toContain("2022-12-31");
    expect(html).toContain("Cash-flow adjustment less balance increase; composition unknown");
    expect(html).toContain("not a reported bill ledger");
    expect(html).toContain("Future bill costs not allocated from closing payables");
    expect(html).not.toContain("Deferred-liability scope adjustment");
  });

  it("labels a secondary company as fictional and omits the 2U AP bridge", () => {
    const context = operatingProvenance({ company: "gitlab-inspired", scenario: "baseline" });
    const html = renderToStaticMarkup(<SourceContents context={context} />);
    expect(html).toContain("CodeHarbor");
    expect(html).toContain("derived from reported");
    expect(html).toContain("Synthetic opening and closing receivables");
    expect(html).not.toContain("2U payables and accruals bridge");
    expect(html).not.toContain("Deferred-liability scope adjustment");
  });

  it.each([
    ["asana-current", "Asana, Inc.", "2026-09-03", null],
    ["gitlab-current", "GitLab Inc.", "2026-09-01", "2026-09-02"],
  ] as const)(
    "separates %s reported cash from current reconstructed books",
    (company, issuer, published, filed) => {
      const context = operatingProvenance({ company, scenario: "baseline" });
      const html = renderToStaticMarkup(<SourceContents context={context} />);
      expect(html).toContain(issuer);
      expect(html).toContain("2026-07-31");
      expect(html).toContain(published);
      if (filed) expect(html).toContain(filed);
      expect(html).toContain("2026-10-25");
      expect(html).toContain("Reported-period cash bridge from backend");
      expect(html).toContain("Starting reconstructed books roll-forward");
      expect(html).toContain("Reported ending combined cash");
      expect(html).toContain("Starting reconstructed cash on hand");
      expect(html).toContain("Starting reconstructed restricted cash, shown separately");
      expect(html).toContain("does not advance with the demo clock");
      expect(html).toContain("combined cash including restricted");
      expect(context.currentLedger?.basis).toBe("reconstructed");
    },
  );

  it("labels GitLab's rounded customer-advance scope adjustment without claiming cash or invoices", () => {
    const context = operatingProvenance({ company: "gitlab-current", scenario: "baseline" });
    const html = renderToStaticMarkup(<SourceContents context={context} />);
    expect(context.accrualBridge.deferredRevenueAdjustmentCents).toBeGreaterThan(0);
    expect(html).toContain(
      "Deferred-liability scope adjustment (reconstructed from rounded disclosure)",
    );
    expect(html).toContain("Opening advances are unknown");
    expect(html).toContain("does not represent an actual period cash receipt or a real invoice");
  });
});
