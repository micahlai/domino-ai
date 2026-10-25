"use client";

import { useMutation, useQuery } from "convex/react";
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
import type { ToolId } from "../../convex/connectors/types";
import { useSelectedCompany } from "./company";
import demo from "./connect-demo.json";

// The connect page's one switch between the real connections.* backend and labelled demo
// data. Demo numbers are recorded pullAll results over the same mock company (see
// convex/tests/connectors/demo.test.ts), one per set of connected tools: nothing is invented.

export type ConnectTool = {
  tool: ToolId;
  status: "connected" | "disconnected" | "error";
  account: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  counts: Record<string, number>;
  recordsIn: number;
  recordsOut: number;
  skipped: number;
  checksOk: number;
  checksTotal: number;
  lastError: string | null;
};

type ListResult = { companyId: string; name: string; asOf: string; tools: ConnectTool[] } | null;

export type ConnectData = {
  source: "live" | "demo" | "loading";
  note: string;
  name: string | null;
  asOf: string | null;
  /** undefined while loading; null when the backend has no company yet. */
  tools: ConnectTool[] | undefined | null;
  connect: (tool: ToolId) => Promise<void>;
  disconnect: (tool: ToolId) => Promise<void>;
  syncNow: () => Promise<void>;
};

export const CONNECT_API = {
  list: makeFunctionReference<"query", { companyId?: string }, ListResult>("connections:list"),
  connect: makeFunctionReference<
    "mutation",
    { companyId?: string; tool: ToolId; consent: boolean }
  >("connections:connect"),
  disconnect: makeFunctionReference<"mutation", { companyId?: string; tool: ToolId }>(
    "connections:disconnect",
  ),
  syncNow: makeFunctionReference<"mutation", { companyId?: string }>("connections:syncNow"),
};

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const noop = async () => {};
const LOADING: ConnectData = {
  source: "loading",
  note: "Connecting to the backend",
  name: null,
  asOf: null,
  tools: undefined,
  connect: noop,
  disconnect: noop,
  syncNow: noop,
};
const Context = createContext<ConnectData>(LOADING);
export const useConnectData = () => useContext(Context);

export function ConnectDataProvider({ children }: { children: ReactNode }) {
  // With a backend configured the page is always live; demo data only without one.
  if (!CONVEX_URL)
    return createElement(DemoConnectData, { note: "Backend not configured", children });
  return createElement(Live, null, children);
}

function Live({ children }: { children: ReactNode }) {
  // Follows the company picked in the top bar (newest feed until the picker list loads).
  const { companyId: picked } = useSelectedCompany();
  const list = useQuery(
    CONNECT_API.list,
    picked === undefined ? "skip" : picked ? { companyId: picked } : {},
  );
  const companyId = list?.companyId;
  const connect = useMutation(CONNECT_API.connect);
  const disconnect = useMutation(CONNECT_API.disconnect);
  const syncNow = useMutation(CONNECT_API.syncNow);
  const value = useMemo<ConnectData>(
    () => ({
      source: "live",
      note: "Live backend",
      name: list?.name ?? null,
      asOf: list?.asOf ?? null,
      tools: list === undefined ? undefined : (list?.tools ?? null),
      connect: async (tool) => {
        await connect({ companyId, tool, consent: true });
      },
      disconnect: async (tool) => {
        await disconnect({ companyId, tool });
      },
      syncNow: async () => {
        await syncNow({ companyId });
      },
    }),
    [list, companyId, connect, disconnect, syncNow],
  );
  return createElement(Context.Provider, { value }, children);
}

type DemoRun = Omit<
  ConnectTool,
  "status" | "account" | "connectedAt" | "lastSyncAt" | "lastError"
> & {
  error: string | null;
};
const RUNS = demo.runs as unknown as Record<string, DemoRun[]>;
const ORDER: ToolId[] = ["plaid", "stripe", "qbo", "gusto", "ramp", "hubspot"];
/** Demo only: a read takes a moment, as a real sync would. */
export const DEMO_SYNC_MS = 900;

type DemoState = {
  tools: Partial<Record<ToolId, { connectedAt: string; lastSyncAt: string | null }>>;
  /** The tools read in the last demo sync: its recorded run is what the cards show. */
  synced: string;
};

const keyOf = (tools: DemoState["tools"]) =>
  ORDER.filter((t) => tools[t])
    .sort()
    .join(",");

/** Local demo connections. Starts with the bank connected so the page is not empty. */
export function DemoConnectData({ note, children }: { note: string; children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
    setState({ tools: { plaid: { connectedAt: earlier, lastSyncAt: earlier } }, synced: "plaid" });
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);
  const syncAll = useCallback(() => {
    timers.current.push(
      setTimeout(() => {
        const at = new Date().toISOString();
        setState((s) => {
          if (!s) return s;
          const tools = Object.fromEntries(
            Object.entries(s.tools).map(([k, v]) => [k, { ...v, lastSyncAt: at }]),
          );
          return { tools, synced: keyOf(tools) };
        });
      }, DEMO_SYNC_MS),
    );
  }, []);
  const value = useMemo<ConnectData>(() => {
    const run = state ? (RUNS[state.synced] ?? []) : [];
    return {
      source: "demo",
      note,
      name: "Kestrel Data",
      asOf: demo.asOf,
      tools: state
        ? ORDER.map((tool) => {
            const s = state.tools[tool];
            const synced = s?.lastSyncAt ? run.find((x) => x.tool === tool) : undefined;
            return {
              tool,
              status: s ? ("connected" as const) : ("disconnected" as const),
              account: s ? "Kestrel Data (sandbox)" : null,
              connectedAt: s?.connectedAt ?? null,
              lastSyncAt: s?.lastSyncAt ?? null,
              counts: synced?.counts ?? {},
              recordsIn: synced?.recordsIn ?? 0,
              recordsOut: synced?.recordsOut ?? 0,
              skipped: synced?.skipped ?? 0,
              checksOk: synced?.checksOk ?? 0,
              checksTotal: synced?.checksTotal ?? 0,
              lastError: null,
            };
          })
        : undefined,
      connect: async (tool) => {
        const at = new Date().toISOString();
        setState(
          (s) =>
            s && { ...s, tools: { ...s.tools, [tool]: { connectedAt: at, lastSyncAt: null } } },
        );
        syncAll();
      },
      disconnect: async (tool) => {
        setState((s) => {
          if (!s) return s;
          const tools = { ...s.tools };
          delete tools[tool];
          // Numbers for the remaining tools are the recorded run without this tool.
          return { tools, synced: keyOf(tools) };
        });
      },
      syncNow: async () => syncAll(),
    };
  }, [state, note, syncAll]);
  return createElement(Context.Provider, { value }, children);
}
