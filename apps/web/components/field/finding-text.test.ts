import { describe, expect, it } from "vitest";
import {
  describeFinding,
  formatMoney,
  humanizeText,
  moneyCents,
  relatedFlags,
} from "./finding-text";

describe("finding text", () => {
  it("parses and formats money without raw cents", () => {
    expect(moneyCents("$2606789.74")).toBe(260678974);
    expect(moneyCents("-$5.00")).toBe(-500);
    expect(moneyCents("$38,000")).toBe(3800000);
    expect(formatMoney(260678974)).toBe("$2,606,790");
    expect(formatMoney(450)).toBe("$4.50");
    expect(formatMoney(-4200000)).toBe("-$42,000");
    expect(humanizeText("paid $2606789.74 on 2026-10-30")).toBe("paid $2,606,790 on Oct 30");
  });

  it("leads an unusual amount with the counterparty and the usual amount", () => {
    const v = describeFinding({
      summary: "card charge card_77 from Northwind Air is $42000.00, far above its usual $3100.00.",
      refs: ["card_77"],
    });
    expect(v.counterparty).toBe("Northwind Air");
    expect(v.headline).toBe("A card charge of $42,000 is far above the usual $3,100.");
    expect(v.facts).toEqual([
      { label: "Amount", value: "$42,000" },
      { label: "Usual", value: "$3,100" },
    ]);
    expect(v.amountCents).toBe(4200000);
  });

  it("reads duplicates, conflicts, timing and missing payroll in plain words", () => {
    expect(
      describeFinding({
        summary:
          "2 bills from Acme Rent for $62000.00 on 2026-11-02 look like the same entry recorded twice.",
        refs: ["bill_1", "bill_2"],
      }),
    ).toMatchObject({
      counterparty: "Acme Rent",
      headline: "2 bills for $62,000 on Nov 2 look like the same entry recorded twice.",
    });
    const conflict = describeFinding({
      summary:
        "invoice inv_9 changed since the last ingest (amount $1000.00 -> $2606789.74); the source disagrees with what we recorded.",
      refs: ["inv_9"],
    });
    expect(conflict.headline).toContain("amount went from $1,000 to $2,606,790");
    expect(conflict.headline).not.toContain("inv_9");
    expect(conflict.facts[0]).toEqual({ label: "Now", value: "$2,606,790" });
    expect(
      describeFinding({
        summary:
          "No payroll run near 2026-11-13: runs are usually 14 days apart but the next one after 2026-10-30 is 28 days later.",
        refs: ["pay_1"],
      }).facts,
    ).toEqual([{ label: "Expected", value: "Nov 13" }]);
  });

  it("keeps unknown wording but strips ids and formats numbers", () => {
    const v = describeFinding({ summary: "Check bill_x for $2606789.74.", refs: ["bill_x"] });
    expect(v.headline).toBe("Check for $2,606,790.");
    expect(v.amountCents).toBe(260678974);
  });

  it("links flags that share a record", () => {
    const related = relatedFlags([
      { id: "a", refs: ["r1", "r2"] },
      { id: "b", refs: ["r2"] },
      { id: "c", refs: ["r3"] },
    ]);
    expect(related.get("a")).toEqual(["b"]);
    expect(related.get("b")).toEqual(["a"]);
    expect(related.has("c")).toBe(false);
  });
});
