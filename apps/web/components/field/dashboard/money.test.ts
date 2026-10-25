import { describe, expect, it } from "vitest";
import { formatCents } from "./money";

describe("dashboard money", () => {
  it("keeps the shared format and uses a true minus sign", () => {
    expect(formatCents(290_000_000)).toBe("$2.9M");
    expect(formatCents(-24_000_000)).toBe("−$240K");
    expect(formatCents(0)).toBe("$0");
  });
});
