import { operatingDemoCatalog, operatingScenarioCatalog } from "@domino/sim";
import { describe, expect, it } from "vitest";
import {
  OPERATING_DEMO_LABEL,
  adoptExplicitOperatingSelection,
  operatingSelectionFromWorldId,
  operatingWorldId,
  resolveOperatingSelection,
  selectedOperatingRecord,
} from "./company";

describe("filing-backed operating selection", () => {
  it("starts with the required primary company and four separate scenarios", () => {
    expect(operatingDemoCatalog[0].id).toBe("2u");
    expect(operatingScenarioCatalog.map((item) => item.id)).toEqual([
      "baseline",
      "late-payments",
      "customer-loss",
      "unexpected-expense",
    ]);
    expect(OPERATING_DEMO_LABEL).toBe(
      "Based on 2U public filings, with reconstructed operating data.",
    );
    expect(operatingDemoCatalog[1].name).toContain("inspired by Asana");
    expect(operatingDemoCatalog[2].name).toContain("inspired by GitLab");
  });

  it("does not choose a different company or scenario when the requested feed is missing", () => {
    const records = [
      { company: "2u" as const, scenario: "baseline" as const, companyId: "first" },
      { company: "gitlab-inspired" as const, scenario: "baseline" as const, companyId: "second" },
    ];
    expect(
      selectedOperatingRecord(records, { company: "2u", scenario: "late-payments" }),
    ).toBeNull();
    expect(
      selectedOperatingRecord(records, { company: "asana-inspired", scenario: "baseline" }),
    ).toBeNull();
    expect(
      selectedOperatingRecord(records, { company: "gitlab-inspired", scenario: "baseline" })
        ?.companyId,
    ).toBe("second");
  });

  it("keeps each Timeline route scoped to its company and scenario", () => {
    const selection = { company: "2u", scenario: "customer-loss" } as const;
    const world = operatingWorldId(selection);
    expect(world).toBe("operating/2u/customer-loss");
    expect(operatingSelectionFromWorldId(world)).toEqual(selection);
    expect(operatingSelectionFromWorldId("kestrel")).toBeNull();
    expect(operatingSelectionFromWorldId("operating/2u/baseline/extra")).toBeNull();
  });

  it("adopts an explicit deep link so queryless navigation keeps the requested feed", () => {
    const values = new Map([
      ["domino.field.operating.company", "asana-inspired"],
      ["domino.field.operating.scenario", "late-payments"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(adoptExplicitOperatingSelection("/", "?company=2u&scenario=baseline", storage)).toEqual({
      company: "2u",
      scenario: "baseline",
    });
    expect(
      resolveOperatingSelection(
        "/field",
        "",
        storage.getItem("domino.field.operating.company"),
        storage.getItem("domino.field.operating.scenario"),
      ).selection,
    ).toEqual({ company: "2u", scenario: "baseline" });
    expect(adoptExplicitOperatingSelection("/field", "", storage)).toBeNull();
    expect(values.get("domino.field.operating.company")).toBe("2u");
    expect(values.get("domino.field.operating.scenario")).toBe("baseline");
  });

  it("adopts a Timeline route but never persists a default or an invalid URL", () => {
    const values = new Map([
      ["domino.field.operating.company", "asana-inspired"],
      ["domino.field.operating.scenario", "late-payments"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(adoptExplicitOperatingSelection("/", "", storage)).toBeNull();
    expect(adoptExplicitOperatingSelection("/", "?company=not-a-company", storage)).toBeNull();
    expect(values.get("domino.field.operating.company")).toBe("asana-inspired");
    expect(
      adoptExplicitOperatingSelection(
        "/c/operating%2Fgitlab-inspired%2Fcustomer-loss/timeline",
        "",
        storage,
      ),
    ).toEqual({ company: "gitlab-inspired", scenario: "customer-loss" });
    expect(values.get("domino.field.operating.company")).toBe("gitlab-inspired");
    expect(values.get("domino.field.operating.scenario")).toBe("customer-loss");
  });
});
