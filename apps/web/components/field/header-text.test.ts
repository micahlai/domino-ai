import { operatingDemoCatalog } from "@domino/sim";
import { describe, expect, it } from "vitest";
import {
  companyDisplay,
  menuKey,
  plainStatus,
  provenanceDates,
  provenanceSummary,
  statusLine,
} from "./header-text";

const entry = (id: string) => {
  const found = operatingDemoCatalog.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("company picker labels", () => {
  it("splits the inspired-by name into a short name and subtitle, and marks 2U as historical", () => {
    expect(companyDisplay(entry("gitlab-current"))).toEqual({
      name: "CodeHarbor",
      subtitle: "Inspired by GitLab",
      initial: "C",
    });
    expect(companyDisplay(entry("asana-current")).name).toBe("Taskline");
    expect(companyDisplay(entry("2u"))).toMatchObject({
      name: "2U (historical)",
      subtitle: "2023 public filings",
    });
  });
});

describe("menu keyboard", () => {
  it("wraps arrows, jumps with Home and End, closes on Escape and Tab", () => {
    expect(menuKey("ArrowDown", 6, 7)).toEqual({ type: "move", index: 0 });
    expect(menuKey("ArrowUp", 0, 7)).toEqual({ type: "move", index: 6 });
    expect(menuKey("ArrowDown", -1, 7)).toEqual({ type: "move", index: 0 });
    expect(menuKey("Home", 4, 7)).toEqual({ type: "move", index: 0 });
    expect(menuKey("End", 1, 7)).toEqual({ type: "move", index: 6 });
    expect(menuKey("Escape", 2, 7)).toEqual({ type: "close", returnFocus: true });
    expect(menuKey("Tab", 2, 7)).toEqual({ type: "close", returnFocus: false });
    // Enter and Space activate the focused item through its own click.
    expect(menuKey("Enter", 2, 7)).toBeNull();
    expect(menuKey(" ", 2, 7)).toBeNull();
  });
});

describe("provenance row", () => {
  it("is one short line with no repeated filing sentence", () => {
    const gitlab = entry("gitlab-current");
    const { badge, line } = provenanceSummary(gitlab);
    expect(`${badge} ${line}`).toBe(
      "Simulated from public filings based on GitLab Inc. filings · as of Oct 25, 2026",
    );
    expect(line).not.toContain(gitlab.label);
    expect(line).not.toMatch(/published|filed|period ended/i);
  });

  it("lists each Sources date once, labelled", () => {
    const rows = provenanceDates(entry("gitlab-current"));
    expect(rows).toEqual([
      ["Reported period", "May 1, 2026 to Jul 31, 2026"],
      ["Published", "Sep 1, 2026"],
      ["Filed", "Sep 2, 2026"],
      ["Starting books", "Oct 25, 2026 (reconstructed)"],
    ]);
    const values = rows.map(([, v]) => v);
    expect(new Set(values).size).toBe(values.length);
    // Asana's publication and filing are the same day: shown once.
    expect(provenanceDates(entry("asana-current")).map(([k]) => k)).not.toContain("Filed");
    expect(provenanceDates(entry("2u")).at(-1)?.[1]).toBe(
      "Sep 30, 2023 (reconstructed, historical ledger date)",
    );
  });
});

describe("Brain map status line", () => {
  const id = "3e39a3be-e852-4f1a-9a7c-1234567890ab";
  it("says what CREAO is doing without run ids", () => {
    expect(plainStatus(`Waiting for CREAO run ${id} (pending)`)).toBe(
      "CREAO is planning the next steps…",
    );
    expect(plainStatus("Waiting for CREAO result (retry 2)")).toBe(
      "CREAO is planning the next steps…",
    );
    expect(plainStatus(`Waiting for CREAO repair run ${id} (running)`)).toBe(
      "CREAO is correcting its plan…",
    );
    expect(plainStatus(`CREAO run ${id} (repaired): Escalate two flags`)).toBe(
      "CREAO planned: Escalate two flags",
    );
    expect(
      plainStatus(
        "Queued: Explain flags waits for the company's current CREAO run (one at a time)",
      ),
    ).toBe("Explain flags is queued behind CREAO's current run.");
    expect(plainStatus(`Coordinator done: plan from CREAO run ${id} (no actions)`)).toBe(
      "Coordinator done: plan from CREAO run (no actions)",
    );
    expect(plainStatus("Audit agent flagged 3 invoices")).toBe("Audit agent flagged 3 invoices");
    expect(statusLine(`Waiting for CREAO run ${id} (pending)`, "2 min ago")).toBe(
      "CREAO is planning the next steps… · 2 min ago",
    );
    expect(statusLine("Read 40 entries.", "just now")).toBe("Read 40 entries · just now");
    expect(statusLine(`Waiting for CREAO run ${id} (pending)`, "now")).not.toContain(id);
  });
});
