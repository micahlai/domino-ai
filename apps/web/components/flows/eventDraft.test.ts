import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { type EventFields, buildEventDraft, dollarsToCents } from "./eventDraft";
const inputs = {
  asOf: fixtures.snapshot.asOf,
  customers: fixtures.snapshot.customers,
  invoices: fixtures.snapshot.invoices,
};
const invoice = inputs.invoices.find((item) => !item.paid);
const fields: EventFields = {
  template: "late_payment",
  target: invoice?.id ?? "",
  days: "45",
  amount: "100.01",
  date: "2026-11-02",
};
describe("configured event boundaries", () => {
  it("converts decimal dollars exactly and rejects unsupported precision or ranges", () => {
    expect(dollarsToCents("100.01")).toBe(10001);
    expect(dollarsToCents("0.29")).toBe(29);
    for (const value of ["0", "-1", "0.001", "1e3", "90071992547410", "NaN"])
      expect(() => dollarsToCents(value)).toThrow();
  });
  it("uses existing company invoice/customer IDs and validates whole days", () => {
    expect(buildEventDraft(fields, inputs).changes).toEqual([
      { kind: "delay_invoice", invoiceId: invoice?.id, days: 45 },
    ]);
    expect(() => buildEventDraft({ ...fields, target: "someone-elses-invoice" }, inputs)).toThrow();
    expect(() => buildEventDraft({ ...fields, days: "2.5" }, inputs)).toThrow();
    expect(
      buildEventDraft(
        { ...fields, template: "lost_renewal", target: inputs.customers[0]?.id ?? "" },
        inputs,
      ).changes,
    ).toEqual([{ kind: "churn", customerId: inputs.customers[0]?.id, fromDate: "2026-11-02" }]);
  });
  it("builds only supported changes and rejects impossible/past dates", () => {
    expect(
      buildEventDraft({ ...fields, template: "cloud_spike" }, inputs).changes[0],
    ).toMatchObject({ kind: "remove_cash", amount: 10001, date: "2026-11-02" });
    expect(buildEventDraft({ ...fields, template: "early_deal" }, inputs).changes[0]).toMatchObject(
      { kind: "add_cash", amount: 10001 },
    );
    for (const date of ["2026-02-30", "2026-01-01", "invalid"])
      expect(() => buildEventDraft({ ...fields, date }, inputs)).toThrow();
    expect(() => buildEventDraft({ ...fields, template: "credit_limit" }, inputs)).toThrow(
      /lender/,
    );
  });
});
