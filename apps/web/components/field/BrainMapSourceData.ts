"use client";

import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { TOOL_IDS, type ToolId } from "../../convex/connectors/types";
import type { SourceDetail } from "../../convex/fieldSourceDetail";
import type { VendorId } from "../icons/vendors";
import demo from "./BrainMapSourceDemo.json";
import { useSelectedCompany } from "./company";
import { useFieldData } from "./data";

// One data source's detail for the brain map: the live fieldSourceDetail.get query, or labelled
// demo data. Demo details are recorded pullAll results over the same mock company the demo map
// shows (convex/tests/fieldSourceDetail.test.ts re-checks them), with times moved to the demo
// map's own read time so the panel and the map agree.

export type { SourceDetail, SourceRecord } from "../../convex/fieldSourceDetail";

export const SOURCE_DETAIL_API = makeFunctionReference<
  "query",
  { companyId: Id<"companies">; tool: ToolId },
  SourceDetail | null
>("fieldSourceDetail:get");

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/** Brain map source vendors that are connectors (the old Capital One node is not). */
export function toolOfVendor(vendor: VendorId | undefined): ToolId | undefined {
  // The Capital One bank is read through the Nessie connector.
  const id = vendor === "capitalone" ? "nessie" : vendor;
  return (TOOL_IDS as readonly string[]).includes(id ?? "") ? (id as ToolId) : undefined;
}

export type SourceDetailState =
  | { state: "loading" }
  | { state: "ready"; detail: SourceDetail; demo: boolean }
  | { state: "missing"; reason: string };

type DemoFile = { at: string; asOf: string; sources: Record<ToolId, SourceDetail> };
const DEMO = demo as unknown as DemoFile;

/** The recorded demo detail, with its read time set to when the demo map read the source. */
export function demoSourceDetail(tool: ToolId, readAt?: string): SourceDetail {
  // The demo recording predates the Nessie bank: show the same bank records under Capital One.
  const d = DEMO.sources[tool] ?? { ...DEMO.sources.plaid, tool };
  if (!readAt) return { ...d, lastReadAt: null, task: { ...d.task, at: null } };
  return {
    ...d,
    connectedAt: readAt,
    lastReadAt: readAt,
    task: { ...d.task, at: d.task.at ? readAt : null },
  };
}

function useDemoSourceDetail(tool: ToolId | undefined, readAt?: string): SourceDetailState {
  if (!tool) return { state: "missing", reason: "Not a connected tool" };
  return { state: "ready", detail: demoSourceDetail(tool, readAt), demo: true };
}

function useLiveSourceDetail(tool: ToolId | undefined, readAt?: string): SourceDetailState {
  const field = useFieldData();
  const picked = useSelectedCompany();
  const demoMode = field.source === "demo";
  const companyId = picked.companyId;
  const detail = useQuery(
    SOURCE_DETAIL_API,
    !demoMode && tool && companyId ? { companyId, tool } : "skip",
  );
  if (!tool) return { state: "missing", reason: "Not a connected tool" };
  if (demoMode) return { state: "ready", detail: demoSourceDetail(tool, readAt), demo: true };
  if (companyId === null) return { state: "missing", reason: "No company is set up yet" };
  if (detail === undefined) return { state: "loading" };
  if (detail === null) return { state: "missing", reason: "This company no longer exists" };
  return { state: "ready", detail, demo: false };
}

/** Hooks are chosen once per build: without a backend URL there is no Convex provider. */
export const useSourceDetail = CONVEX_URL ? useLiveSourceDetail : useDemoSourceDetail;
