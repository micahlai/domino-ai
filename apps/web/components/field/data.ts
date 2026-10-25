"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  type ReactNode,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { weeklyFixtureText } from "../../lib/feature-boundary/verify";
import {
  type DemoState,
  demoAdvanceFeed,
  demoDecide,
  demoIngest,
  demoRecordExport,
  initialDemoState,
} from "./fixture";
import type { FieldActions, FieldData, FieldFinding, FieldOperation, FieldStatus } from "./types";

// The one switch between the real field.* backend and labelled demo data. Pages call the hooks
// at the bottom and never know which one they got, except through `source` for the label.
// To wire the backend: fix the names in FIELD_API and the shape mapping in LiveData.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

// Referenced by name so this compiles before convex/field exists in _generated.
export const FIELD_API = {
  status: makeFunctionReference<"query", Record<string, never>, FieldStatus>("field:status"),
  log: makeFunctionReference<"query">("field:log"),
  findings: makeFunctionReference<"query", Record<string, never>, FieldFinding[]>("field:findings"),
  exportSeed: makeFunctionReference<"query", Record<string, never>, string>("field:exportSeed"),
  decide: makeFunctionReference<"mutation", { findingId: string; decision: string; note: string }>(
    "field:decide",
  ),
  ingestNow: makeFunctionReference<"mutation", Record<string, never>>("field:ingestNow"),
  advanceFeed: makeFunctionReference<"mutation", Record<string, never>>("field:advanceFeed"),
};

const LOG_PAGE = 100;
/** Demo only: the always-on agent picks up new entries after this short wait. */
export const DEMO_AUTO_INGEST_MS = 1500;

const noop = async () => {};
const LOADING: FieldData = {
  source: "loading",
  sourceNote: "Connecting to the backend",
  canLoadMore: false,
  loadMore: () => {},
  actions: { decide: noop, ingestNow: noop, advanceFeed: noop, exportSeed: async () => "" },
};

const FieldContext = createContext<FieldData>(LOADING);

export function FieldDataProvider({ children }: { children: ReactNode }) {
  if (!CONVEX_URL)
    return createElement(DemoFieldData, { note: "Backend not configured", children });
  return createElement(ProbedData, null, children);
}

/** Try field.status once. Missing functions (backend not deployed yet) fall back to demo data. */
function ProbedData({ children }: { children: ReactNode }) {
  const client = useConvex();
  const [probe, setProbe] = useState<"checking" | "live" | "missing">("checking");
  useEffect(() => {
    let alive = true;
    client.query(FIELD_API.status, {}).then(
      () => alive && setProbe("live"),
      () => alive && setProbe("missing"),
    );
    return () => {
      alive = false;
    };
  }, [client]);
  if (probe === "live") return createElement(LiveData, null, children);
  if (probe === "missing")
    return createElement(DemoFieldData, { note: "Field backend not available yet", children });
  return createElement(FieldContext.Provider, { value: LOADING }, children);
}

function LiveData({ children }: { children: ReactNode }) {
  const client = useConvex();
  const status = useQuery(FIELD_API.status, {});
  const findings = useQuery(FIELD_API.findings, {});
  const log = usePaginatedQuery(FIELD_API.log, {}, { initialNumItems: LOG_PAGE });
  const decide = useMutation(FIELD_API.decide);
  const ingestNow = useMutation(FIELD_API.ingestNow);
  const advanceFeed = useMutation(FIELD_API.advanceFeed);
  const actions = useMemo<FieldActions>(
    () => ({
      decide: async (args) => {
        await decide(args);
      },
      ingestNow: async () => {
        await ingestNow({});
      },
      advanceFeed: async () => {
        await advanceFeed({});
      },
      exportSeed: () => client.query(FIELD_API.exportSeed, {}),
    }),
    [client, decide, ingestNow, advanceFeed],
  );
  const operations = useMemo(
    () => (log.status === "LoadingFirstPage" ? undefined : (log.results as FieldOperation[])),
    [log.results, log.status],
  );
  const value: FieldData = {
    source: "live",
    sourceNote: "Live backend",
    status,
    findings,
    operations,
    canLoadMore: log.status === "CanLoadMore",
    loadMore: () => log.loadMore(LOG_PAGE),
    actions,
  };
  return createElement(FieldContext.Provider, { value }, children);
}

export function DemoFieldData({ note, children }: { note: string; children: ReactNode }) {
  // Built after mount: the pages are prerendered, and history stamped "3 h ago" must use the
  // viewer's clock, not the build machine's.
  const [state, setState] = useState<DemoState | null>(null);
  useEffect(() => {
    setState(initialDemoState(new Date(Date.now() - 3 * 3_600_000).toISOString()));
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = useCallback((change: (s: DemoState, now: string) => DemoState) => {
    setState((s) => (s ? change(s, new Date().toISOString()) : s));
  }, []);
  const actions = useMemo<FieldActions>(
    () => ({
      decide: async (args) => apply((s, now) => demoDecide(s, args, now)),
      ingestNow: async () => apply(demoIngest),
      advanceFeed: async () => {
        apply(demoAdvanceFeed);
        // The real agent is always on; in the demo it notices the new entries shortly after.
        clearTimeout(timer.current);
        timer.current = setTimeout(() => apply(demoIngest), DEMO_AUTO_INGEST_MS);
      },
      exportSeed: async () => {
        apply(demoRecordExport);
        return weeklyFixtureText("validKestrelWeeklySeed");
      },
    }),
    [apply],
  );
  const value: FieldData = {
    source: "demo",
    sourceNote: note,
    status: state?.status,
    operations: state?.operations,
    findings: state?.findings,
    canLoadMore: false,
    loadMore: () => {},
    actions,
  };
  return createElement(FieldContext.Provider, { value }, children);
}

export const useFieldData = () => useContext(FieldContext);
export const useFieldStatus = () => useFieldData().status;
export const useFieldLog = () => useFieldData().operations;
export const useFieldFindings = () => useFieldData().findings;
export const useFieldActions = () => useFieldData().actions;
