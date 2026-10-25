"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import type { ToolId } from "../../convex/connectors/types";
import type { VendorId } from "../icons/vendors";
import { useSelectedCompany } from "./company";
import { CONNECT_API } from "./connect-data";
import { useFieldData } from "./data";

// The data sources a company has connected (the connections table), so the brain map shows only
// those and drops a tool the moment it is disconnected. Demo mode has no connections table:
// undefined, and the map then shows sources that have recorded work.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const VENDOR_OF_TOOL: Record<ToolId, VendorId> = {
  stripe: "stripe",
  ramp: "ramp",
  qbo: "qbo",
  gusto: "gusto",
  hubspot: "hubspot",
  plaid: "plaid",
  nessie: "capitalone",
};

function useLiveConnectedVendors(): ReadonlySet<VendorId> | undefined {
  const field = useFieldData();
  const { companyId } = useSelectedCompany();
  const list = useQuery(
    CONNECT_API.list,
    field.source === "live" && companyId ? { companyId } : "skip",
  );
  return useMemo(
    () =>
      list
        ? new Set(
            list.tools
              .filter((t) => t.status !== "disconnected")
              .map((t) => VENDOR_OF_TOOL[t.tool]),
          )
        : undefined,
    [list],
  );
}

const useDemoConnectedVendors = (): ReadonlySet<VendorId> | undefined => undefined;

/** Hooks are chosen once per build: without a backend URL there is no Convex provider. */
export const useConnectedVendors = CONVEX_URL ? useLiveConnectedVendors : useDemoConnectedVendors;
