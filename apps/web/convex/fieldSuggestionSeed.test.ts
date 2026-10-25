import { createHash } from "node:crypto";
import { contentHashPreimage, parseWeeklySeedJson } from "@domino/contracts";
import { createOperatingDemo } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { pinnedOptionSeedDraft } from "./fieldSuggestionSeed";

describe("exact Field option seed", () => {
  it("keeps a current operating snapshot's semantic Timeline company and valid seed", () => {
    const snapshot = createOperatingDemo({ company: "asana-current", scenario: "baseline" }).world
      .snapshot;
    const draft = pinnedOptionSeedDraft({
      snapshot,
      companyName: "Asana demo",
      seedId: "field:weekly_seed/saved-run-one",
      pinnedAt: "2026-10-25T12:00:00.000Z",
    });
    const contentHash = createHash("sha256").update(contentHashPreimage(draft)).digest("hex");
    const parsed = parseWeeklySeedJson(JSON.stringify({ ...draft, contentHash }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.company.id).toBe(snapshot.companyId);
    expect(parsed.data.company.id).toBe("operating/asana-current/baseline");
    expect(parsed.data.snapshot).toEqual(snapshot);
    expect(parsed.data.scheduledItems.length).toBeGreaterThan(0);
    expect(parsed.data.findings).toEqual([]);
  });
});
