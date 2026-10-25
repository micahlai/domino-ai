import { describe, expect, it } from "vitest";
import { vendorFor } from "./vendors";

describe("vendorFor", () => {
  it("maps every alias the app uses to one vendor", () => {
    expect(["stripe", "billing"].map(vendorFor)).toEqual(["stripe", "stripe"]);
    expect(["ramp", "cards"].map(vendorFor)).toEqual(["ramp", "ramp"]);
    expect(["qbo", "books", "QuickBooks"].map(vendorFor)).toEqual(["qbo", "qbo", "qbo"]);
    expect(["gusto", "payroll", "hubspot", "crm"].map(vendorFor)).toEqual([
      "gusto",
      "gusto",
      "hubspot",
      "hubspot",
    ]);
    expect(["nessie", "bank", "plaid"].map(vendorFor)).toEqual([
      "capitalone",
      "capitalone",
      "plaid",
    ]);
    expect(vendorFor("something else")).toBe("generic");
  });
});
