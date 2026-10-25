"use client";

import { type CompanyModel, CompanyModelSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { auditSnapshot } from "@domino/engine";
import { simulator } from "@domino/sim";
import { useConvex, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import { type DashboardResult, deriveDashboard } from "./derive";

// The one switch between the fieldDashboard.summary Convex query and labelled demo data.
// Demo data is the sim Kestrel company run through the same engine derivation as the backend,
// so every number on screen is internally consistent either way.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export type AgentState = "on" | "idle" | "failed" | "demo";

export type DashboardHeader = {
  name: string;
  asOf: string | null;
  /** ISO timestamp of the latest ingested snapshot. */
  updatedAt: string | null;
  tools: { connected: number; total: number };
  agent: { state: AgentState; intervalMs: number | null; lastError: string | null };
  openFindings: number;
  openEscalations: number;
};

export type DashboardData = {
  source: "live" | "demo" | "loading";
  /** Plain-words reason shown next to the data label, for example why demo data is shown. */
  note: string;
  header?: DashboardHeader;
  /** Undefined while loading; null when the live feed has no ingested snapshot yet. */
  result?: DashboardResult | null;
};

/** Mirrors convex/fieldDashboard.ts summary. Referenced by name so it compiles before codegen. */
export type SummaryResponse = {
  companyId: string;
  name: string;
  asOf: string | null;
  lastSnapshotAt: string | null;
  lastIngestStatus: "ok" | "no_change" | "failed" | null;
  lastError: string | null;
  auto: boolean;
  autoIntervalMs: number;
  sources: { total: number; connected: number };
  openFindings: number;
  openEscalations: number;
  result: DashboardResult | null;
} | null;

export const DASHBOARD_API = {
  summary: makeFunctionReference<"query", Record<string, never>, SummaryResponse>(
    "fieldDashboard:summary",
  ),
};

/** Same starting model as field.setup: nothing learned yet. */
const DEMO_MODEL: CompanyModel = CompanyModelSchema.parse({
  version: 1,
  customerDelayDays: {},
  recurringSpend: [],
  rules: [],
});
const DEMO_TOOLS = 6;

/** Demo dashboard: sim Kestrel (seed 1, as field.setup uses) through the real engine. Pure. */
export function buildDemo(): {
  header: Omit<DashboardHeader, "updatedAt">;
  result: DashboardResult;
} {
  const snapshot = simulator.createCompany("kestrel", 1).snapshot;
  const findings = auditSnapshot({
    snapshot,
    previous: null,
    detectedAt: `${snapshot.asOf}T00:00:00.000Z`,
  });
  return {
    header: {
      name: "Kestrel Data",
      asOf: snapshot.asOf,
      tools: { connected: DEMO_TOOLS, total: DEMO_TOOLS },
      agent: { state: "demo", intervalMs: null, lastError: null },
      openFindings: findings.length,
      openEscalations: findings.filter((f) => f.severity === "high").length,
    },
    result: deriveDashboard({ snapshot, model: DEMO_MODEL, constraints: fixtures.constraints }),
  };
}

let demoCache: ReturnType<typeof buildDemo> | undefined;
const demo = () => {
  demoCache ??= buildDemo();
  return demoCache;
};

export function liveHeader(r: NonNullable<SummaryResponse>): DashboardHeader {
  const state: AgentState = r.lastIngestStatus === "failed" ? "failed" : r.auto ? "on" : "idle";
  return {
    name: r.name.replace(/\s*\(live feed\)\s*$/i, "") || "Your company",
    asOf: r.result?.ok ? r.result.view.asOf : r.asOf,
    updatedAt: r.lastSnapshotAt,
    tools: { connected: r.sources.connected, total: r.sources.total },
    agent: { state, intervalMs: r.autoIntervalMs, lastError: r.lastError },
    openFindings: r.openFindings,
    openEscalations: r.openEscalations,
  };
}

const LOADING: DashboardData = { source: "loading", note: "Connecting to the backend" };
const DashboardContext = createContext<DashboardData>(LOADING);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  if (!CONVEX_URL) return createElement(DemoData, { note: "Backend not configured", children });
  return createElement(ProbedData, null, children);
}

/** Try the query once. A missing function (not deployed yet) or no feed falls back to demo. */
function ProbedData({ children }: { children: ReactNode }) {
  const client = useConvex();
  const [probe, setProbe] = useState<"checking" | "live" | "missing" | "empty">("checking");
  useEffect(() => {
    let alive = true;
    client.query(DASHBOARD_API.summary, {}).then(
      (r) => alive && setProbe(r ? "live" : "empty"),
      () => alive && setProbe("missing"),
    );
    return () => {
      alive = false;
    };
  }, [client]);
  if (probe === "live") return createElement(LiveData, null, children);
  if (probe === "missing")
    return createElement(DemoData, { note: "Dashboard backend not available yet", children });
  if (probe === "empty")
    return createElement(DemoData, { note: "No connected company yet", children });
  return createElement(DashboardContext.Provider, { value: LOADING }, children);
}

function LiveData({ children }: { children: ReactNode }) {
  const r = useQuery(DASHBOARD_API.summary, {});
  const value: DashboardData =
    r === undefined
      ? LOADING
      : r === null
        ? { source: "live", note: "Live backend", result: null }
        : { source: "live", note: "Live backend", header: liveHeader(r), result: r.result };
  return createElement(DashboardContext.Provider, { value }, children);
}

function DemoData({ note, children }: { note: string; children: ReactNode }) {
  // "Updated 3 h ago" must use the viewer's clock, not the build machine's, so it is set after mount.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => setUpdatedAt(new Date(Date.now() - 3 * 3_600_000).toISOString()), []);
  const { header, result } = demo();
  const value: DashboardData = { source: "demo", note, header: { ...header, updatedAt }, result };
  return createElement(DashboardContext.Provider, { value }, children);
}

export const useDashboard = () => useContext(DashboardContext);
