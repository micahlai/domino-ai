"use client";

import { type CompanyModel, CompanyModelSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { auditSnapshot } from "@domino/engine";
import { type ProfileId, createProfileCompany } from "@domino/sim";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { type ReactNode, createContext, createElement, useContext } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DEFAULT_FIELD_COMPANY, fieldCompany } from "../../../convex/lib/fieldCompanies";
import { useSelectedCompany, useSelectedProfile } from "../company";
import { type DashboardResult, deriveDashboard } from "./derive";
import { type AnalystLatest, type RiskFeed, analystRisks, illustrativeRisks } from "./risks";

// The one switch between the fieldDashboard.summary Convex query and labelled demo data (only
// when no backend is configured).
// Demo data is the selected picker company (sim v2 driver profile, seed 1, as field.setupAll
// creates it) run through the same engine derivation as the backend, so demo numbers match live.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export type AgentState = "on" | "idle" | "failed" | "demo";

export type DashboardHeader = {
  name: string;
  asOf: string | null;
  /** ISO timestamp of the latest ingested snapshot. */
  updatedAt: string | null;
  /** `off`: names of disconnected tools, whose data is as of their last read. */
  tools: { connected: number; total: number; off: string[] };
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
  /** Risk cards: the analyst's latest run when it has finished scenarios, else illustrative. */
  risks?: RiskFeed;
};

/** Analyst cards when the live run has finished scenarios; the labelled sample otherwise. */
export function pickRisks(
  result: DashboardResult | null | undefined,
  latest: AnalystLatest | undefined,
): RiskFeed | undefined {
  if (!result?.ok) return undefined;
  return (latest && analystRisks(latest, result.view)) ?? illustrativeRisks(result.view);
}

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
  sources: { total: number; connected: number; off?: string[] };
  openFindings: number;
  openEscalations: number;
  result: DashboardResult | null;
} | null;

export const DASHBOARD_API = {
  summary: makeFunctionReference<"query", { companyId?: string }, SummaryResponse>(
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

/** Demo dashboard: a picker company (seed 1, as field.setupAll uses) through the real engine. */
export function buildDemo(profile: ProfileId = DEFAULT_FIELD_COMPANY): {
  header: Omit<DashboardHeader, "updatedAt">;
  result: DashboardResult;
} {
  const snapshot = createProfileCompany(profile, 1).snapshot;
  const findings = auditSnapshot({
    snapshot,
    previous: null,
    detectedAt: `${snapshot.asOf}T00:00:00.000Z`,
  });
  return {
    header: {
      name: fieldCompany(profile).name,
      asOf: snapshot.asOf,
      tools: { connected: DEMO_TOOLS, total: DEMO_TOOLS, off: [] },
      agent: { state: "demo", intervalMs: null, lastError: null },
      openFindings: findings.length,
      openEscalations: findings.filter((f) => f.severity === "high").length,
    },
    result: deriveDashboard({ snapshot, model: DEMO_MODEL, constraints: fixtures.constraints }),
  };
}

const demoCache = new Map<ProfileId, ReturnType<typeof buildDemo>>();
const demo = (profile: ProfileId) => {
  const hit = demoCache.get(profile) ?? buildDemo(profile);
  demoCache.set(profile, hit);
  return hit;
};

export function liveHeader(r: NonNullable<SummaryResponse>): DashboardHeader {
  const state: AgentState = r.lastIngestStatus === "failed" ? "failed" : r.auto ? "on" : "idle";
  return {
    name: r.name.replace(/\s*\(live feed\)\s*$/i, "") || "Your company",
    asOf: r.result?.ok ? r.result.view.asOf : r.asOf,
    updatedAt: r.lastSnapshotAt,
    tools: { connected: r.sources.connected, total: r.sources.total, off: r.sources.off ?? [] },
    agent: { state, intervalMs: r.autoIntervalMs, lastError: r.lastError },
    openFindings: r.openFindings,
    openEscalations: r.openEscalations,
  };
}

const LOADING: DashboardData = { source: "loading", note: "Connecting to the backend" };
const DashboardContext = createContext<DashboardData>(LOADING);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  // With a backend configured the page is always live: an empty feed shows its own empty state
  // and a backend error surfaces as an error, never as demo numbers.
  if (!CONVEX_URL) return createElement(DemoData, { note: "Backend not configured", children });
  return createElement(LiveData, null, children);
}

function LiveData({ children }: { children: ReactNode }) {
  // Follows the company picked in the top bar (newest feed until the picker list loads).
  const { companyId } = useSelectedCompany();
  const r = useQuery(
    DASHBOARD_API.summary,
    companyId === undefined ? "skip" : companyId ? { companyId } : {},
  );
  // Read-only: the analyst's latest run for the same company the summary returned.
  const latest = useQuery(
    api.fieldAnalyst.latest,
    r?.companyId ? { companyId: r.companyId as Id<"companies"> } : "skip",
  );
  const value: DashboardData =
    r === undefined
      ? LOADING
      : r === null
        ? { source: "live", note: "Live backend", result: null }
        : {
            source: "live",
            note: "Live backend",
            header: liveHeader(r),
            result: r.result,
            risks: pickRisks(r.result, latest),
          };
  return createElement(DashboardContext.Provider, { value }, children);
}

function DemoData({ note, children }: { note: string; children: ReactNode }) {
  // Demo books were never ingested, so there is no "updated" time to show.
  const { header, result } = demo(useSelectedProfile());
  const value: DashboardData = {
    source: "demo",
    note,
    header: { ...header, updatedAt: null },
    result,
    risks: pickRisks(result, undefined),
  };
  return createElement(DashboardContext.Provider, { value }, children);
}

export const useDashboard = () => useContext(DashboardContext);
