"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
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
import { api } from "../../convex/_generated/api";
import { weeklyFixtureText } from "../../lib/feature-boundary/verify";
import { FIELD_OPERATING_API, useOperatingSelection, useSelectedCompany } from "./company";
import {
  type DemoState,
  demoAdvanceFeed,
  demoDecide,
  demoIngest,
  demoRecordExport,
  demoSetAutoIngest,
  initialDemoState,
} from "./fixture";
import { toFinding, toOperations, toStatus } from "./live";
import { optimisticDecide } from "./optimistic";
import type { FieldActions, FieldData } from "./types";

// The one switch between the real field.* backend (convex/field.ts) and labelled demo data.
// Demo data is used only when NEXT_PUBLIC_CONVEX_URL is empty; with a URL set, backend errors
// show as errors instead of silently swapping in fake data.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const LOG_PAGE = 100;
/** Demo only: with auto-ingest on, the demo agent picks up new entries after this short wait. */
export const DEMO_AUTO_INGEST_MS = 1500;

const noop = async () => {};
const LOADING: FieldData = {
  source: "loading",
  sourceNote: "Connecting to the backend",
  canLoadMore: false,
  loadMore: () => {},
  actions: {
    decide: noop,
    ingestNow: noop,
    advanceFeed: noop,
    setAutoIngest: noop,
    setup: noop,
    exportSeed: async () => "",
  },
};

const FieldContext = createContext<FieldData>(LOADING);

export function FieldDataProvider({ children }: { children: ReactNode }) {
  if (!CONVEX_URL)
    return createElement(DemoFieldData, { note: "Backend not configured", children });
  return createElement(LiveData, null, children);
}

function LiveData({ children }: { children: ReactNode }) {
  const client = useConvex();
  const selection = useOperatingSelection();
  // Every field.* read follows the company picked in the top bar.
  const picked = useSelectedCompany();
  const status = useQuery(
    api.field.status,
    picked.companyId ? { companyId: picked.companyId } : "skip",
  );
  const companyId = status?.companyId;
  const open = useQuery(api.field.findings, companyId ? { companyId, status: "open" } : "skip");
  const approved = useQuery(
    api.field.findings,
    companyId ? { companyId, status: "approved" } : "skip",
  );
  const rejected = useQuery(
    api.field.findings,
    companyId ? { companyId, status: "rejected" } : "skip",
  );
  const log = usePaginatedQuery(api.field.log, companyId ? { companyId } : "skip", {
    initialNumItems: LOG_PAGE,
  });
  const [decideError, setDecideError] = useState<FieldData["decideError"]>(null);
  const decideOnServer = useMutation(api.field.decide);
  const decide = useMemo(
    () => decideOnServer.withOptimisticUpdate(optimisticDecide),
    [decideOnServer],
  );
  const ingestNow = useMutation(api.field.ingestNow);
  const advanceFeed = useMutation(api.field.advanceFeed);
  const setAutoIngest = useMutation(api.field.setAutoIngest);
  const ensure = useMutation(FIELD_OPERATING_API.ensure);
  const actions = useMemo<FieldActions>(() => {
    const need = () => {
      if (!companyId) throw new Error("Connect the mock sources first");
      return companyId;
    };
    return {
      decide: async ({ findingId, decision, note }) => {
        setDecideError(null);
        try {
          await decide({ companyId: need(), findingId, decision, ...(note && { note }) });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not save the decision.";
          setDecideError({ findingId, message });
          throw e;
        }
      },
      ingestNow: async () => {
        await ingestNow({ companyId: need() });
      },
      advanceFeed: async (anomaly) => {
        await advanceFeed({ companyId: need(), ...(anomaly && { anomaly }) });
      },
      setAutoIngest: async (enabled) => {
        await setAutoIngest({ companyId: need(), enabled });
      },
      setup: async () => {
        await ensure(selection);
      },
      exportSeed: async () =>
        (await client.query(api.field.exportSeed, { companyId: need() })).json,
    };
  }, [client, companyId, decide, ingestNow, advanceFeed, setAutoIngest, ensure, selection]);
  const loaded = log.status !== "LoadingFirstPage";
  const operations = useMemo(
    () => (loaded ? toOperations(log.results) : undefined),
    [log.results, loaded],
  );
  const findings = useMemo(
    () =>
      open && approved && rejected ? [...open, ...approved, ...rejected].map(toFinding) : undefined,
    [open, approved, rejected],
  );
  const needsSetup = status === null;
  const value: FieldData = {
    source: status === undefined ? "loading" : "live",
    sourceNote: "Live backend",
    status: status && loaded ? toStatus(status, log.results) : undefined,
    needsSetup,
    findings: needsSetup ? [] : findings,
    operations: needsSetup ? [] : operations,
    canLoadMore: log.status === "CanLoadMore",
    loadMore: () => log.loadMore(LOG_PAGE),
    actions,
    decideError,
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
  const auto = useRef(true);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = useCallback((change: (s: DemoState, now: string) => DemoState) => {
    setState((s) => (s ? change(s, new Date().toISOString()) : s));
  }, []);
  const actions = useMemo<FieldActions>(
    () => ({
      decide: async (args) => apply((s, now) => demoDecide(s, args, now)),
      ingestNow: async () => apply(demoIngest),
      // Demo ignores the anomaly choice: its batches carry their own scripted flags.
      advanceFeed: async () => {
        apply(demoAdvanceFeed);
        clearTimeout(timer.current);
        if (auto.current) timer.current = setTimeout(() => apply(demoIngest), DEMO_AUTO_INGEST_MS);
      },
      setAutoIngest: async (enabled) => {
        auto.current = enabled;
        apply((s) => demoSetAutoIngest(s, enabled));
      },
      setup: noop,
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
