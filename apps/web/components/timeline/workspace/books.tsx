"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { OpenInTimeline } from "../../field/OpenInTimeline";
import {
  FIELD_COMPANIES,
  selectCompany,
  useCompanySelection,
  useSelectedCompany,
} from "../../field/company";
import { formatFullDate } from "../baseline/format";

// Timeline pages follow the company in the URL: opening /c/<profile>/timeline selects that
// company in the top bar, and the Field seam (fieldTimeline) says which saved run holds its
// latest imported books. Reading only; importing stays behind the explicit Field action.

export const fieldCompanyOf = (companyId: string) =>
  FIELD_COMPANIES.find((c) => c.id === companyId) ?? null;

/** Selects the URL's company in the top bar once per company (picking another navigates). */
export function SyncCompany({ companyId }: { companyId: string }) {
  const company = fieldCompanyOf(companyId);
  const selection = useCompanySelection();
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync only when the URL company changes
  useEffect(() => {
    if (company && selection !== company.id) selectCompany(company.id);
  }, [company]);
  return null;
}

export type LatestImport =
  | { state: "not_field" }
  | { state: "loading" }
  | { state: "none" }
  | {
      state: "ready";
      runId: string;
      analysisId: string | null;
      route: string;
      asOf: string;
      current: boolean;
    };

/** The latest Field import for a Timeline company id (a Field profile), if any. Live only. */
export function useLatestImport(companyId: string): LatestImport {
  const field = fieldCompanyOf(companyId);
  const { companies } = useSelectedCompany();
  const fieldId = companies?.find((c) => c.profile === companyId)?.companyId as
    | Id<"companies">
    | undefined;
  const link = useQuery(
    api.fieldTimeline.latest,
    field && fieldId ? { companyId: fieldId } : "skip",
  );
  if (!field) return { state: "not_field" };
  if (companies === undefined || (fieldId && link === undefined)) return { state: "loading" };
  if (!fieldId || !link) return { state: "none" };
  return {
    state: "ready",
    runId: link.runId,
    analysisId: link.analysisId ?? null,
    route: link.route,
    asOf: link.asOf,
    current: link.current,
  };
}

/** Shown on a run only when newer books were ingested after this company's last import. */
export function NewerBooksNotice({ companyId }: { companyId: string }) {
  const latest = useLatestImport(companyId);
  if (latest.state !== "ready" || latest.current) return null;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs sm:flex-row sm:items-center sm:justify-between"
      data-testid="newer-books"
    >
      <p className="text-muted-foreground">
        Newer books exist than the last import (books as of {formatFullDate(latest.asOf)}).
      </p>
      <OpenInTimeline variant="outline" label="Bring in latest books" />
    </div>
  );
}
