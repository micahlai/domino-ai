import type { Snapshot } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { compactMoney, friendlyLabel } from "./recordNames";

const snapshot = {
  customers: [{ id: "cus_nw", name: "Northwind", paymentTermsDays: 30 }],
  invoices: [
    {
      id: "synthetic/gitlab-current/plan/17/invoice/2026-10-18",
      customerId: "cus_nw",
      amount: 120_000_000,
      issued: "2026-09-18",
      due: "2026-10-18",
    },
  ],
  bills: [],
} as unknown as Snapshot;

describe("plain record names", () => {
  it("never shows raw invoice ids in saved labels", () => {
    expect(
      friendlyLabel(
        "Invoice synthetic/gitlab-current/plan/17/invoice/2026-10-18 is paid 14 additional days late",
        snapshot,
      ),
    ).toBe("Northwind invoice ($1.2M, due Oct 18) is paid 14 days late");
  });
  it("rounds headline money", () => {
    expect(compactMoney(7_833_466_667)).toBe("$78.3M");
    expect(compactMoney(-450_000)).toBe("-$4.5K");
    expect(compactMoney(95_000)).toBe("$950");
  });
});
