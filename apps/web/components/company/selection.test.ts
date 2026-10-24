import type { Branch, Change, RiskEvent } from "@domino/contracts";
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

const [first, second] = risks;
if (!first || !second) throw new Error("Missing risk fixtures");
const pair = [first, second];
const empty: RiskEvent = { ...first, id: "risk_empty", changes: [] };

/** Branches saved before riskIds existed: no riskIds, relative to the empty base. */
const { riskIds: _baseRiskIds, ...legacyBase } = fixtures.branches[0] as Branch;
const legacyEvent = (id: string, changes: Change[]): Branch => {
  const { riskIds: _riskIds, ...legacy } = parent;
  return { ...legacy, id, parentId: legacyBase.id, changes };
};
const reverseKeys = (change: Change) =>
  Object.fromEntries(Object.entries(change).reverse()) as Change;

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
  it("matches a legacy combination when only change properties are reordered", () => {
    const combined = { ...acme, riskIds: pair.map((risk) => risk.id) };
    const branch = legacyEvent("combined", pair.flatMap((risk) => risk.changes).map(reverseKeys));
    expect(matchingEventBranch(combined, risks, [legacyBase, branch])?.id).toBe("combined");
  });
  it("does not erase meaningful legacy change order", () => {
    const combined = { ...acme, riskIds: pair.map((risk) => risk.id) };
    const reversed = legacyEvent("reversed", pair.flatMap((risk) => risk.changes).reverse());
    expect(matchingEventBranch(combined, risks, [legacyBase, reversed])).toBeUndefined();
    const flipped = { ...combined, riskIds: [...combined.riskIds].reverse() };
    expect(matchingEventBranch(flipped, risks, [legacyBase, reversed])?.id).toBe("reversed");
  });
  it("selects a nested branch by cumulative explicit risk IDs", () => {
    const nested: Branch = {
      ...parent,
      id: "nested",
      parentId: parent.id,
      riskIds: pair.map((risk) => risk.id),
      changes: second.changes,
    };
    const future = { ...acme, riskIds: [...pair.map((risk) => risk.id)].reverse() };
    expect(matchingEventBranch(future, risks, [...fixtures.branches, nested])?.id).toBe("nested");
    expect(matchingEventBranch(acme, risks, [...fixtures.branches, nested])?.id).toBe(parent.id);
  });
  it("rejects an explicit wrong risk identity despite identical changes", () => {
    const wrong: Branch = { ...parent, id: "wrong", riskIds: [second.id] };
    const future = { ...acme, riskIds: [first.id] };
    expect(matchingEventBranch(future, risks, [legacyBase, wrong])).toBeUndefined();
    const legacy = legacyEvent("legacy", first.changes);
    expect(matchingEventBranch(future, risks, [legacyBase, wrong, legacy])?.id).toBe("legacy");
    const explicitEmpty: Branch = { ...legacy, riskIds: [] };
    expect(matchingEventBranch(future, risks, [legacyBase, explicitEmpty])).toBeUndefined();
  });
  it("only falls back to changes for a direct child of one empty base", () => {
    const future = { ...acme, riskIds: [first.id] };
    const child = legacyEvent("child", first.changes);
    expect(matchingEventBranch(future, risks, [legacyBase, child])?.id).toBe("child");
    expect(matchingEventBranch(future, risks, [child])).toBeUndefined();
    expect(matchingEventBranch(future, risks, [{ ...legacyBase, id: "other" }, child])).toBe(
      undefined,
    );
    const nestedLegacy = { ...child, parentId: "br_mid" };
    const middle = { ...legacyEvent("br_mid", second.changes), id: "br_mid" };
    expect(matchingEventBranch(future, risks, [legacyBase, middle, nestedLegacy])).toBeUndefined();
    const withChanges = { ...legacyBase, changes: second.changes };
    expect(matchingEventBranch(future, risks, [withChanges, child])).toBeUndefined();
    const withRisks = { ...legacyBase, riskIds: [second.id] };
    expect(matchingEventBranch(future, risks, [withRisks, child])).toBeUndefined();
    const fixChild = { ...child, kind: "fix" as const };
    expect(matchingEventBranch(future, risks, [legacyBase, fixChild])).toBeUndefined();
  });
  it("rejects ambiguous and unknown matches", () => {
    const future = { ...acme, riskIds: [first.id] };
    const twins = [legacyEvent("a", first.changes), legacyEvent("b", first.changes)];
    expect(matchingEventBranch(future, risks, [legacyBase, ...twins])).toBeUndefined();
    const explicit = [
      { ...parent, id: "x", riskIds: [first.id] },
      { ...parent, id: "y", riskIds: [first.id] },
    ];
    expect(matchingEventBranch(future, risks, [legacyBase, ...explicit])).toBeUndefined();
    expect(
      matchingEventBranch({ ...future, riskIds: ["unknown"] }, risks, [
        legacyBase,
        { ...parent, id: "ghost", riskIds: ["unknown"] },
      ]),
    ).toBeUndefined();
    const duplicated = { ...future, riskIds: [first.id, first.id] };
    expect(matchingEventBranch(duplicated, risks, [legacyBase, ...twins.slice(0, 1)])).toBe(
      undefined,
    );
    const noChanges = { ...future, riskIds: [empty.id] };
    expect(
      matchingEventBranch(noChanges, [empty], [legacyBase, legacyEvent("none", [])]),
    ).toBeUndefined();
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
