"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSelectedCompany } from "./company";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/** Keep Field pages on the exact selected operating feed while it is being prepared. */
export function ReplayGuard({ children }: { children: ReactNode }) {
  if (!CONVEX_URL) return <Notice title="Operating demo needs the backend" />;
  return <Ready>{children}</Ready>;
}

function Ready({ children }: { children: ReactNode }) {
  const { companyId, error } = useSelectedCompany();
  if (error) return <Notice title="Could not open this operating demo" detail={error} />;
  if (!companyId)
    return (
      <Notice
        title="Preparing the selected operating demo"
        detail="Reading its reconstructed books and source anchors..."
      />
    );
  return children;
}

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <output className="mx-auto block max-w-[1040px] rounded-lg border bg-card p-5 text-sm shadow-xs">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">
        {detail ??
          "Connect the demo backend to see this company's books. No fixture data is substituted."}
      </p>
      <Link
        href="/case/2u"
        className="mt-3 inline-block text-primary underline-offset-2 hover:underline"
      >
        Open the separate 2U historical case
      </Link>
    </output>
  );
}
