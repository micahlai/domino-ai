"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { IdSchema } from "@domino/contracts";
import Link from "next/link";
import { FixtureCompany } from "./FixtureCompany";
import { CompanyConnectionStatus, LiveCompany } from "./LiveCompany";

const CompanyId = IdSchema.regex(/^[a-z0-9]{32}$/).transform((value) => value as Id<"companies">);

export function CompanyScreen({ companyId }: { companyId: string }) {
  const demoId = process.env.NEXT_PUBLIC_DEMO_COMPANY_ID;
  if (companyId === "kestrel" && (!demoId || !process.env.NEXT_PUBLIC_CONVEX_URL))
    return <FixtureCompany />;
  const id = CompanyId.safeParse(companyId === "kestrel" ? demoId : companyId);
  if (!id.success)
    return (
      <p className="text-sm text-muted-foreground">
        This company link is not valid. Check the company link and try again.
      </p>
    );
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-medium">Company records are not connected yet.</h1>
        <p className="text-sm text-muted-foreground">
          You can explore Domino using the sample company.
        </p>
        <Link href="/c/kestrel" className="inline-block min-h-11 text-sm text-primary underline">
          Open the sample company
        </Link>
      </div>
    );
  return (
    <>
      <CompanyConnectionStatus />
      <LiveCompany companyId={id.data} />
    </>
  );
}
