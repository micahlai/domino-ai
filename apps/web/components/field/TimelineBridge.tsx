"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate } from "../../lib/format";
import { OpenInTimeline } from "./OpenInTimeline";
import { FIELD_COMPANIES, selectCompany, useCompanySelection, useSelectedCompany } from "./company";

// Field strip above Timeline's pages (TL7 joint integration). Timeline's company id is the
// Field picker profile, so opening /c/<profile>/timeline selects that company in the top bar,
// and the strip offers the latest Field books for it. Timeline's own UI is unchanged below.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export function TimelineBridge({ companyId }: { companyId: string }) {
  const company = FIELD_COMPANIES.find((c) => c.id === companyId);
  const selection = useCompanySelection();
  // URL -> selection once per company; picking another company navigates here instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync only when the URL company changes
  useEffect(() => {
    if (company && selection !== company.id) selectCompany(company.id);
  }, [company]);
  if (!company) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{company.name}</span>{" "}
        {CONVEX_URL ? <LatestBooks profile={company.id} /> : "(simulated company)"}
      </p>
      <OpenInTimeline variant="outline" label="Open the latest books in Timeline" />
    </div>
  );
}

function LatestBooks({ profile }: { profile: string }) {
  const { companies } = useSelectedCompany();
  const fieldId = companies?.find((c) => c.profile === profile)?.companyId as
    | Id<"companies">
    | undefined;
  const link = useQuery(api.fieldTimeline.latest, fieldId ? { companyId: fieldId } : "skip");
  if (!link) return <>has no Timeline run from its Field books yet.</>;
  return (
    <>
      latest Field import: books as of {formatDate(link.asOf)}
      {link.current ? "" : " (newer books exist)"}.{" "}
      <Link href={link.route} className="text-primary underline-offset-2 hover:underline">
        Open that run
      </Link>
    </>
  );
}
