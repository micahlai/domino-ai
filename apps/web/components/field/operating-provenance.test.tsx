import { operatingProvenance } from "@domino/sim";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceContents } from "./OperatingProvenanceStrip";

describe("operating source panel", () => {
  it("shows separate 2U ledger and publication dates plus the reported and reconstructed AP basis", () => {
    const context = operatingProvenance({ company: "2u", scenario: "baseline" });
    const html = renderToStaticMarkup(<SourceContents context={context} />);
    expect(html).toContain("2023-09-30");
    expect(html).toContain("2023-11-09");
    expect(html).toContain("combined cash including restricted");
    expect(html).toContain("2U payables and accruals bridge");
    expect(html).toContain("2022-12-31");
    expect(html).toContain("Cash-flow adjustment less balance increase; composition unknown");
    expect(html).toContain("not a reported bill ledger");
    expect(html).toContain("Future bill costs not allocated from closing payables");
  });

  it("labels a secondary company as fictional and omits the 2U AP bridge", () => {
    const context = operatingProvenance({ company: "gitlab-inspired", scenario: "baseline" });
    const html = renderToStaticMarkup(<SourceContents context={context} />);
    expect(html).toContain("CodeHarbor");
    expect(html).toContain("derived from reported");
    expect(html).toContain("Synthetic opening and closing receivables");
    expect(html).not.toContain("2U payables and accruals bridge");
  });
});
