import {
  OPERATING_COMPANY_IDS,
  OPERATING_PRIMARY_COMPANY_IDS,
  operatingScenarioCatalog,
} from "@domino/sim";
import { describe, expect, it } from "vitest";
import {
  OPERATING_COMPANIES,
  OPERATING_DEMO_LABEL,
  adoptExplicitOperatingSelection,
  isLegacyOperatingTimelinePath,
  isPrimaryOperatingTimelinePath,
  operatingSelectionFromWorldId,
  operatingWorldId,
  resolveOperatingSelection,
  selectedOperatingRecord,
} from "./company";

describe("filing-backed operating selection", () => {
  it("starts with the required primary company and four separate scenarios", () => {
    expect(OPERATING_PRIMARY_COMPANY_IDS).toEqual(["2u", "asana-current", "gitlab-current"]);
    expect(OPERATING_COMPANIES.map((item) => item.id)).toEqual(OPERATING_PRIMARY_COMPANY_IDS);
    expect([...OPERATING_COMPANY_IDS].sort()).toEqual(
      ["2u", "asana-inspired", "gitlab-inspired", "asana-current", "gitlab-current"].sort(),
    );
    expect(operatingScenarioCatalog.map((item) => item.id)).toEqual([
      "baseline",
      "late-payments",
      "customer-loss",
      "unexpected-expense",
    ]);
    expect(OPERATING_DEMO_LABEL).toBe(
      "Based on 2U public filings, with reconstructed operating data.",
    );
    expect(OPERATING_COMPANIES[1]?.name).toContain("Asana");
    expect(OPERATING_COMPANIES[2]?.name).toContain("GitLab");
  });

  it("does not choose a different company or scenario when the requested feed is missing", () => {
    const records = [
      { company: "2u" as const, scenario: "baseline" as const, companyId: "first" },
      { company: "gitlab-current" as const, scenario: "baseline" as const, companyId: "second" },
    ];
    expect(
      selectedOperatingRecord(records, { company: "2u", scenario: "late-payments" }),
    ).toBeNull();
    expect(
      selectedOperatingRecord(records, { company: "asana-current", scenario: "baseline" }),
    ).toBeNull();
    expect(
      selectedOperatingRecord(records, { company: "gitlab-current", scenario: "baseline" })
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
    expect(operatingSelectionFromWorldId("operating/asana-inspired/baseline")).toBeNull();
    expect(isPrimaryOperatingTimelinePath("/c/operating%2Fasana-current%2Fbaseline/timeline")).toBe(
      true,
    );
    expect(isLegacyOperatingTimelinePath("/c/operating%2Fasana-inspired%2Fbaseline/timeline")).toBe(
      true,
    );
  });

  it("adopts an explicit deep link so queryless navigation keeps the requested feed", () => {
    const values = new Map([
      ["domino.field.operating.company", "asana-current"],
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
        "/c/operating%2Fgitlab-current%2Fcustomer-loss/timeline",
        "",
        storage,
      ),
    ).toEqual({ company: "gitlab-current", scenario: "customer-loss" });
    expect(values.get("domino.field.operating.company")).toBe("gitlab-current");
    expect(values.get("domino.field.operating.scenario")).toBe("customer-loss");
    expect(resolveOperatingSelection("/", "", "asana-inspired", "late-payments").selection).toEqual(
      {
        company: "2u",
        scenario: "baseline",
      },
    );
    expect(
      adoptExplicitOperatingSelection(
        "/c/operating%2Fasana-inspired%2Fbaseline/timeline",
        "",
        storage,
      ),
    ).toBeNull();
    expect(values.get("domino.field.operating.company")).toBe("gitlab-current");
  });
});
