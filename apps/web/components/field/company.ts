"use client";

import {
  OPERATING_DEMO_LABEL,
  type OperatingCompanyId,
  type OperatingScenarioId,
  type OperatingSelection,
  type ProfileId,
  operatingDemoCatalog,
  operatingScenarioCatalog,
} from "@domino/sim";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { Id } from "../../convex/_generated/dataModel";
import {
  DEFAULT_FIELD_COMPANY,
  FIELD_COMPANIES,
  type FieldCompanyProfile,
} from "../../convex/lib/fieldCompanies";

export { FIELD_COMPANIES, type FieldCompanyProfile };
export const OPERATING_COMPANIES = operatingDemoCatalog;
export const OPERATING_SCENARIOS = operatingScenarioCatalog;
export { OPERATING_DEMO_LABEL };
export type { OperatingCompanyId, OperatingScenarioId, OperatingSelection };
export const DEFAULT_OPERATING_SELECTION: OperatingSelection = {
  company: "2u",
  scenario: "baseline",
};
export const operatingWorldId = ({ company, scenario }: OperatingSelection) =>
  `operating/${company}/${scenario}`;
export function operatingSelectionFromWorldId(value: string): OperatingSelection | null {
  const [prefix, company, scenario, extra] = value.split("/");
  if (
    prefix !== "operating" ||
    extra !== undefined ||
    !OPERATING_COMPANIES.some((item) => item.id === company) ||
    !OPERATING_SCENARIOS.some((item) => item.id === scenario)
  )
    return null;
  return { company: company as OperatingCompanyId, scenario: scenario as OperatingScenarioId };
}

const COMPANY_KEY = "domino.field.operating.company";
const SCENARIO_KEY = "domino.field.operating.scenario";
const EVENT = "domino:operating-selection";
const validCompany = (value: string | null): value is OperatingCompanyId =>
  OPERATING_COMPANIES.some((item) => item.id === value);
const validScenario = (value: string | null): value is OperatingScenarioId =>
  OPERATING_SCENARIOS.some((item) => item.id === value);

type SelectionStore = Pick<Storage, "getItem" | "setItem">;

export function resolveOperatingSelection(
  path: string,
  search: string,
  storedCompany: string | null,
  storedScenario: string | null,
): { selection: OperatingSelection; explicit: boolean } {
  const query = new URLSearchParams(search);
  const routePart =
    path.match(/^\/c\/([^/]+)\/timeline(?:\/|$)/)?.[1] ??
    path.match(/^\/c\/(operating\/[^/]+\/[^/]+)\/timeline(?:\/|$)/)?.[1];
  let route: OperatingSelection | null = null;
  try {
    route = routePart ? operatingSelectionFromWorldId(decodeURIComponent(routePart)) : null;
  } catch {
    // Malformed address cannot override the stored or default selection.
  }
  const company = query.get("company");
  const scenario = query.get("scenario");
  return {
    selection: {
      company: validCompany(company)
        ? company
        : (route?.company ?? (validCompany(storedCompany) ? storedCompany : "2u")),
      scenario: validScenario(scenario)
        ? scenario
        : (route?.scenario ?? (validScenario(storedScenario) ? storedScenario : "baseline")),
    },
    explicit: validCompany(company) || validScenario(scenario) || route !== null,
  };
}

function read(): OperatingSelection {
  if (typeof window === "undefined") return DEFAULT_OPERATING_SELECTION;
  let storedCompany: string | null = null;
  let storedScenario: string | null = null;
  try {
    storedCompany = window.localStorage.getItem(COMPANY_KEY);
    storedScenario = window.localStorage.getItem(SCENARIO_KEY);
  } catch {
    // URL and the 2U baseline default still work without storage.
  }
  return resolveOperatingSelection(
    window.location.pathname,
    window.location.search,
    storedCompany,
    storedScenario,
  ).selection;
}

/** Adopt a valid deep link so later navigation without query parameters keeps its selection. */
export function adoptExplicitOperatingSelection(
  path: string,
  search: string,
  storage: SelectionStore,
): OperatingSelection | null {
  const resolved = resolveOperatingSelection(
    path,
    search,
    storage.getItem(COMPANY_KEY),
    storage.getItem(SCENARIO_KEY),
  );
  if (!resolved.explicit) return null;
  storage.setItem(COMPANY_KEY, resolved.selection.company);
  storage.setItem(SCENARIO_KEY, resolved.selection.scenario);
  return resolved.selection;
}

// useSyncExternalStore requires the same object identity until a selection changes.
let lastKey = "";
let lastSelection: OperatingSelection = DEFAULT_OPERATING_SELECTION;
function snapshot(): OperatingSelection {
  const next = read();
  const key = `${next.company}/${next.scenario}`;
  if (key !== lastKey) {
    lastKey = key;
    lastSelection = next;
  }
  return lastSelection;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function selectOperating(selection: OperatingSelection) {
  try {
    window.localStorage.setItem(COMPANY_KEY, selection.company);
    window.localStorage.setItem(SCENARIO_KEY, selection.scenario);
  } catch {
    // The URL below still carries the choice for this page.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("company", selection.company);
  url.searchParams.set("scenario", selection.scenario);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Pins every Field hook below it to one backend company that is not in the picker (a judge
 * sandbox company), so /judge can embed the brain map for it. The top bar picker is untouched.
 */
type Override = { companyId: Id<"companies">; name: string };
const OverrideContext = createContext<Override | null>(null);
export function FieldCompanyOverride({
  companyId,
  name,
  children,
}: Override & { children: ReactNode }) {
  return createElement(OverrideContext.Provider, { value: { companyId, name } }, children);
}

export const useOperatingSelection = (): OperatingSelection => {
  const selection = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_OPERATING_SELECTION);
  useEffect(() => {
    try {
      adoptExplicitOperatingSelection(
        window.location.pathname,
        window.location.search,
        window.localStorage,
      );
    } catch {
      // The current URL still works if the browser blocks storage.
    }
  }, []);
  return selection;
};
/** Fixture-only helper for playgrounds and the old judge sandbox. */
export const useSelectedProfile = (): ProfileId => DEFAULT_FIELD_COMPANY;
export const useSelectedCompanyName = (): string => {
  const override = useContext(OverrideContext);
  const selection = useOperatingSelection();
  return (
    override?.name ??
    OPERATING_COMPANIES.find((item) => item.id === selection.company)?.name ??
    "Company"
  );
};

export type OperatingRecord = {
  companyId: Id<"companies">;
  company: OperatingCompanyId;
  scenario: OperatingScenarioId;
  name: string;
};
export function selectedOperatingRecord<
  T extends { company: OperatingCompanyId; scenario: OperatingScenarioId },
>(records: readonly T[], selection: OperatingSelection): T | null {
  return (
    records.find(
      (item) => item.company === selection.company && item.scenario === selection.scenario,
    ) ?? null
  );
}
export const FIELD_OPERATING_API = {
  list: makeFunctionReference<"query", Record<string, never>, OperatingRecord[]>(
    "fieldOperating:list",
  ),
  ensure: makeFunctionReference<
    "mutation",
    { company: OperatingCompanyId; scenario: OperatingScenarioId },
    { companyId: Id<"companies">; name: string; created: boolean }
  >("fieldOperating:ensure"),
};
const pending = new Map<string, Promise<unknown>>();

/** Resolve the exact selected company and scenario. A missing feed is created, never replaced. */
export function useSelectedCompany(): {
  companies: OperatingRecord[] | undefined;
  selected: OperatingRecord | null | undefined;
  companyId: Id<"companies"> | null | undefined;
  error: string | null;
} {
  const override = useContext(OverrideContext);
  const selection = useOperatingSelection();
  const companies = useQuery(FIELD_OPERATING_API.list, override ? "skip" : {});
  const ensure = useMutation(FIELD_OPERATING_API.ensure);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const selected = companies ? selectedOperatingRecord(companies, selection) : undefined;
  const key = `${selection.company}/${selection.scenario}`;
  const error = !selected && failure?.key === key ? failure.message : null;
  useEffect(() => {
    if (override || companies === undefined || selected || error) return;
    let active = true;
    let request = pending.get(key);
    if (!request) {
      request = ensure(selection).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    request.then(
      () => {
        if (active) setFailure(null);
      },
      (cause: unknown) => {
        if (active)
          setFailure({
            key,
            message:
              cause instanceof Error ? cause.message : "Could not set up the selected company.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [override, companies, selected, key, ensure, selection, error]);
  if (override)
    return {
      companies: undefined,
      selected: undefined,
      companyId: override.companyId,
      error: null,
    };
  if (companies === undefined)
    return { companies, selected: undefined, companyId: undefined, error };
  return { companies, selected: selected ?? null, companyId: selected?.companyId ?? null, error };
}
