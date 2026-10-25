"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { AgentsGate, AgentsIdleCard } from "./agents";
import {
  FIELD_OPERATING_API,
  operatingSelectionFromWorldId,
  selectedOperatingRecord,
} from "./company";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * Timeline for a primary operating world whose agents have not started: the shared idle card
 * instead of an empty workspace. Other worlds, and worlds without a Field company, are unchanged.
 */
export function TimelineAgentsGate({
  companyId,
  children,
}: {
  companyId: string;
  children: ReactNode;
}) {
  const selection = operatingSelectionFromWorldId(companyId);
  if (!CONVEX_URL || !selection) return <>{children}</>;
  return <Gate selection={selection}>{children}</Gate>;
}

function Gate({
  selection,
  children,
}: {
  selection: NonNullable<ReturnType<typeof operatingSelectionFromWorldId>>;
  children: ReactNode;
}) {
  const records = useQuery(FIELD_OPERATING_API.list, {});
  if (records === undefined) return null;
  const record = selectedOperatingRecord(records, selection);
  if (!record) return <>{children}</>;
  return (
    <AgentsGate
      companyId={record.companyId}
      idle={(state) => (
        <div className="mx-auto max-w-[1040px]">
          <AgentsIdleCard
            state={state}
            detail="The timeline starts from the books the agents read, so there is nothing to forecast yet. Start the agents on the Brain map; the 13-week timeline appears once the first read finishes."
          />
        </div>
      )}
    >
      {children}
    </AgentsGate>
  );
}
