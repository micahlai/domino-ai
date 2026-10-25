"use client";

import type { ProfileId } from "@domino/sim";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  DEFAULT_FIELD_COMPANY,
  FIELD_COMPANIES,
  type FieldCompanyProfile,
} from "../../convex/lib/fieldCompanies";

// The selected company for every Field page and the dashboard: a profile id kept in
// localStorage, shared across tabs, and overridable by ?company=<profile> in the URL (so a link
// opens the same company). Each page resolves it to that company's backend id.

export { FIELD_COMPANIES, type FieldCompanyProfile };
const KEY = "domino.field.company";
const EVENT = "domino:company";
const isProfile = (v: string | null): v is ProfileId =>
  !!v && FIELD_COMPANIES.some((c) => c.id === v);

function read(): ProfileId {
  if (typeof window === "undefined") return DEFAULT_FIELD_COMPANY;
  const fromUrl = new URLSearchParams(window.location.search).get("company");
  if (isProfile(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isProfile(stored)) return stored;
  } catch {
    // Storage blocked: the default company is still a valid choice.
  }
  return DEFAULT_FIELD_COMPANY;
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

export function selectCompany(profile: ProfileId) {
  try {
    window.localStorage.setItem(KEY, profile);
  } catch {
    // Storage blocked: the URL below still carries the choice for this page.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("company")) {
    url.searchParams.set("company", profile);
    window.history.replaceState(window.history.state, "", url);
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The selected profile id (the default company on the server and before hydration). */
export const useSelectedProfile = (): ProfileId =>
  useSyncExternalStore(subscribe, read, () => DEFAULT_FIELD_COMPANY);

/** The selected company's display name. Company records are named exactly after their profile. */
export const useSelectedCompanyName = (): string => {
  const profile = useSelectedProfile();
  return FIELD_COMPANIES.find((c) => c.id === profile)?.name ?? "Your company";
};

export type PickerCompany = FunctionReturnType<typeof api.field.companies>[number];

/**
 * Live only (needs the Convex provider): the companies that are set up and the selected one.
 * `selected` is undefined while loading and null when no company exists yet.
 */
export function useSelectedCompany(): {
  companies: PickerCompany[] | undefined;
  selected: PickerCompany | null | undefined;
  companyId: Id<"companies"> | null | undefined;
} {
  const profile = useSelectedProfile();
  const companies = useQuery(api.field.companies, {});
  const selected =
    companies === undefined
      ? undefined
      : (companies.find((c) => c.profile === profile) ?? companies[0] ?? null);
  return { companies, selected, companyId: selected ? selected.companyId : selected };
}
