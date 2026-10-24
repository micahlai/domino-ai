import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { matchingEventBranch, matchingFixBranch, weekOf } from "./selection";

const risks = [...fixtures.risks, ...fixtures.moreRisks];
const base = fixtures.resilience.universes[0];
const acme = fixtures.resilience.universes.find(
  (future) => future.riskIds.length === 1 && future.riskIds[0] === "risk_acme_late",
);
const parent = fixtures.branches.find((branch) => branch.id === "br_acme_late");
const fix = fixtures.fixes[0];
if (!base || !acme || !parent || !fix) throw new Error("Missing selection fixtures");

describe("future and fix selection", () => {
  it("matches base and exact single-risk futures", () => {
    expect(matchingEventBranch(base, risks, fixtures.branches)?.kind).toBe("base");
    expect(matchingEventBranch(acme, risks, fixtures.branches)?.id).toBe(parent.id);
  });
  it("never substitutes a single-risk branch for an unsaved combination", () => {
    const combination = fixtures.resilience.universes.find((future) => future.riskIds.length > 1);
    if (!combination) throw new Error("Missing combination fixture");
    expect(matchingEventBranch(combination, risks, fixtures.branches)).toBeUndefined();
    expect(
      matchingEventBranch({ ...acme, riskIds: ["unknown"] }, risks, fixtures.branches),
    ).toBeUndefined();
  });
  it("matches a complete combination even when change properties and order differ", () => {
    const combined = { ...acme, riskIds: risks.slice(0, 2).map((risk) => risk.id) };
    const branch = {
      ...parent,
      id: "combined",
      changes: risks
        .slice(0, 2)
        .flatMap((risk) => risk.changes)
        .reverse(),
    };
    expect(matchingEventBranch(combined, risks, [parent, branch])?.id).toBe("combined");
  });
  it("requires the candidate changes and correct parent for approval", () => {
    const saved = matchingFixBranch(parent, fix, fixtures.branches);
    expect(saved?.id).toBe("br_fix_early_pay");
    expect(
      matchingFixBranch({ ...parent, id: "unrelated" }, fix, fixtures.branches),
    ).toBeUndefined();
    expect(
      matchingFixBranch(parent, { ...fix, changes: parent.changes }, fixtures.branches),
    ).toBeUndefined();
  });
  it("preserves the event match when the report previews fixes with different IDs", () => {
    const preview = fixtures.resilienceWithFixes.universes.find(
      (future) => JSON.stringify(future.riskIds) === JSON.stringify(acme.riskIds),
    );
    expect(preview).toBeDefined();
    if (preview) expect(matchingEventBranch(preview, risks, fixtures.branches)?.id).toBe(parent.id);
  });
  it("labels weeks with their Monday across month and year boundaries", () => {
    expect(weekOf("2026-10-30")).toBe("2026-10-26");
    expect(weekOf("2027-01-03")).toBe("2026-12-28");
    expect(weekOf("2026-11-02")).toBe("2026-11-02");
  });
});
