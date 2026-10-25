"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { Play, Plug, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ToolId } from "../../convex/connectors/types";
import { cn } from "../../lib/utils";
import { AgentIcon } from "../icons/AgentIcon";
import { ToolLogo } from "../icons/ToolLogo";
import { VENDORS } from "../icons/vendors";
import { SourcePicker, toggleSource } from "../judge/SourcePicker";
import { TOOL_TILE } from "../judge/flow";
import { errorText } from "../judge/shared";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";
import { VENDOR_OF_TOOL } from "./BrainMapConnections";
import {
  FIELD_OPERATING_API,
  chooseReplay,
  selectOperating,
  useOperatingSelection,
  useSelectedCompany,
} from "./company";

// Agent start (convex/fieldAgents.ts). A newly selected company starts idle: every page shows the
// same guided start (connected tools, one Start agents button), then the Brain map fills live.
// Nothing here invents numbers or activity.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
export const BRAIN_MAP_HREF = "/field/map";

export type AgentsState = NonNullable<FunctionReturnType<typeof api.fieldAgents.state>>;

/** undefined while loading; null without a backend or company (pages behave as before). */
function useLiveAgentsState(companyId?: Id<"companies"> | null): AgentsState | null | undefined {
  const picked = useSelectedCompany().companyId;
  const id = companyId === undefined ? picked : companyId;
  const state = useQuery(api.fieldAgents.state, id ? { companyId: id } : "skip");
  if (id === null) return null;
  return id === undefined ? undefined : state;
}
const useDemoAgentsState = (): AgentsState | null | undefined => null;

/** Hooks are chosen once per build: without a backend URL there is no Convex provider. */
export const useAgentsState = CONVEX_URL ? useLiveAgentsState : useDemoAgentsState;

export const agentsIdle = (state: AgentsState | null | undefined) => state?.started === false;

const toolName = (tool: ToolId) => VENDORS[VENDOR_OF_TOOL[tool]]?.name ?? tool;

/** The company's connected tools as logos. `faded` while no agent has read them. */
export function SourceLogos({
  tools,
  faded = false,
  size = 22,
  className,
}: {
  tools: readonly ToolId[];
  faded?: boolean;
  size?: number;
  className?: string;
}) {
  if (tools.length === 0) return null;
  return (
    // Spans, not ul/li: this also sits inside a page header's paragraph. Each logo is titled.
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      {tools.map((tool) => (
        <span
          key={tool}
          className={cn("inline-flex", faded && "opacity-45")}
          title={toolName(tool)}
        >
          <ToolLogo vendor={VENDOR_OF_TOOL[tool]} size={size} title={toolName(tool)} />
        </span>
      ))}
    </span>
  );
}

const BANKS: readonly ToolId[] = ["plaid", "nessie"];
const NEEDS: Partial<Record<ToolId, { needs: ToolId }>> = { hubspot: { needs: "stripe" } };
const START_STEPS = ["Choose sources", "Start agents", "Watch the Brain map"] as const;

/**
 * Guided start, shown on every page of an idle company (the judge sandbox's source step, reused):
 * the connected tools as toggles, one Start agents button, then the Brain map, where reading,
 * the audit, the forecast and suggested fixes arrive live.
 */
export function AgentsIdleCard({ state, detail }: { state: AgentsState; detail?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const start = useMutation(api.fieldAgents.start);
  const tools = state.tools;
  const required = tools.find((t) => BANKS.includes(t)) ?? null;
  const needs = Object.fromEntries(
    Object.entries(NEEDS).filter(([t]) => tools.includes(t as ToolId)),
  ) as Partial<Record<ToolId, { needs: ToolId }>>;
  const [on, setOn] = useState<ReadonlySet<ToolId>>(() => new Set(tools));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (t: ToolId) =>
    setOn((cur) => (required ? toggleSource(cur, t, required, needs) : cur));
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await start({ companyId: state.companyId, sources: tools.filter((t) => on.has(t)) });
      if (pathname !== BRAIN_MAP_HREF) router.push(BRAIN_MAP_HREF);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Start the agents"
      className="space-y-5 rounded-lg border bg-card p-[var(--card-pad,1.25rem)] shadow-xs"
    >
      <div>
        <p className="text-[15px] font-semibold">Start the agents for {state.name}</p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {detail ??
            "Nothing has been read or forecast yet. Choose which connected tools the agents may read, then start them. The Brain map shows each step as it happens: reading the books, the audit, the 13-week forecast and suggested fixes."}
        </p>
      </div>
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" aria-label="Steps">
        {START_STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                i === 0 ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>{label}</span>
          </li>
        ))}
      </ol>
      <SourcePicker
        tools={tools}
        tiles={TOOL_TILE}
        on={on}
        required={required}
        needs={needs}
        onToggle={toggle}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button onClick={go} disabled={busy}>
          <Play aria-hidden="true" className="size-4" />
          {busy ? "Starting…" : "Start agents"}
        </Button>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            Reads {on.size} of {tools.length} connected {tools.length === 1 ? "tool" : "tools"}
            {pathname === BRAIN_MAP_HREF ? "" : ", then opens the Brain map"}
          </p>
        )}
      </div>
    </section>
  );
}

/** Shown only while the first real read is running (phase "reading"). */
export function AgentsWorking({ label }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-muted-foreground">
        {label ?? "Working… the agents are reading the books for the first time."}
      </p>
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

/**
 * Children once the agents have started (or without a backend). While idle: `idle` or the
 * shared card. Loading renders nothing, so an idle page never flashes old-style empty numbers.
 */
export function AgentsGate({
  children,
  idle,
  companyId,
}: {
  children: ReactNode;
  idle?: (state: AgentsState) => ReactNode;
  companyId?: Id<"companies"> | null;
}) {
  const state = useAgentsState(companyId);
  if (state === undefined) return null;
  if (state && !state.started) return <>{idle ? idle(state) : <AgentsIdleCard state={state} />}</>;
  return <>{children}</>;
}

/** Primary Start agents action. Idempotent on the server; a second press schedules nothing. */
export function StartAgentsButton({
  companyId,
  className,
}: {
  companyId: Id<"companies">;
  className?: string;
}) {
  const start = useMutation(api.fieldAgents.start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <Button
        size="lg"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await start({ companyId });
          } catch (e) {
            const data = e instanceof ConvexError ? (e.data as { message?: string }) : null;
            setError(data?.message ?? "Could not start the agents. Try again.");
            setBusy(false);
          }
        }}
      >
        <Play aria-hidden="true" className="size-4" />
        {busy ? "Starting…" : "Start agents"}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Brain map before Start agents: only the root CREAO coordinator, the company's connected tools
 * faded around it, and the Start button. No placeholder agents are drawn.
 */
export function BrainMapIdle({
  state,
  showStart = true,
}: {
  state: AgentsState;
  /** false when the guided start panel above already holds the Start button. */
  showStart?: boolean;
}) {
  const tools = state.tools;
  const radius = 150;
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-lg border bg-card shadow-xs"
      style={{ height: "max(420px, min(calc(100dvh - 240px), 640px))" }}
    >
      <div className="relative" style={{ width: radius * 2 + 80, height: radius * 2 + 80 }}>
        {tools.map((tool, i) => {
          const angle = (i / tools.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <div
              key={tool}
              className="absolute flex flex-col items-center gap-1 opacity-40"
              style={{
                left: radius + 40 + Math.cos(angle) * radius - 22,
                top: radius + 40 + Math.sin(angle) * radius - 22,
              }}
              title={`${toolName(tool)}: connected, not read yet`}
            >
              <ToolLogo vendor={VENDOR_OF_TOOL[tool]} size={44} title={toolName(tool)} />
              <span className="text-[11px] text-muted-foreground">{toolName(tool)}</span>
            </div>
          );
        })}
        <div className="absolute left-1/2 top-1/2 flex w-[220px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-xl border bg-background p-4 text-center shadow-sm">
          <AgentIcon kind="creao" size={36} />
          <div>
            <p className="text-sm font-semibold">Coordinator</p>
            <p className="text-xs text-muted-foreground">CREAO · waiting to start</p>
          </div>
          {showStart ? <StartAgentsButton companyId={state.companyId} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Brain map header actions. "Reset demo" (any operating company) opens a new started copy of the
 * prepared baseline. A company with data also offers "Start from empty": a fresh idle copy
 * of the same company and scenario (fieldOperating.replay), so the agents can be watched building
 * everything live. The prepared company and its data are kept; a replay offers the way back.
 */
export function ReplayAction() {
  return (
    <span className="flex flex-wrap items-start justify-end gap-2">
      {/* Connected tools is no longer a top-level tab; it opens from the Brain map. */}
      <Button asChild variant="ghost" size="sm">
        <Link href="/field/connect">
          <Plug aria-hidden="true" className="size-3.5" />
          Connected tools
        </Link>
      </Button>
      {CONVEX_URL ? <LiveReplayAction /> : null}
    </span>
  );
}

function LiveReplayAction() {
  const { selected } = useSelectedCompany();
  const selection = useOperatingSelection();
  const replay = useMutation(FIELD_OPERATING_API.replay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!selected) return null;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex flex-wrap items-center justify-end gap-2">
        {selected.replayOf ? (
          <Button variant="ghost" size="sm" onClick={() => chooseReplay(selection, null)}>
            <Undo2 aria-hidden="true" className="size-3.5" />
            Back to prepared data
          </Button>
        ) : selected.started ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            title="Creates a fresh copy of this company with nothing read yet. The prepared data stays as it is."
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const next = await replay({ companyId: selected.companyId });
                chooseReplay(selection, next.companyId);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {busy ? "Preparing…" : "Start from empty"}
          </Button>
        ) : null}
        <ResetDemoAction />
      </span>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Reset demo": a new copy of the selected company at its prepared baseline, with agents started
 * and no planted events, decisions or learned rules (fieldOperating.resetDemo). The current copy
 * is kept unchanged; this browser switches to the new one.
 */
export function ResetDemoAction({ size = "sm" }: { size?: "sm" | "default" }) {
  return CONVEX_URL ? <LiveResetDemo size={size} /> : null;
}

function LiveResetDemo({ size }: { size: "sm" | "default" }) {
  const { selected } = useSelectedCompany();
  const selection = useOperatingSelection();
  const reset = useMutation(FIELD_OPERATING_API.resetDemo);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!selected) return null;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await reset({ companyId: selected.companyId });
      const target = { company: selection.company, scenario: next.scenario };
      chooseReplay(target, next.companyId);
      selectOperating(target);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" className="size-3.5" />
        Reset demo
      </Button>
      <Dialog open={open} onOpenChange={(next) => (busy ? null : setOpen(next))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset the demo?</DialogTitle>
            <DialogDescription>
              Domino opens a new copy of {selected.name.split(" · ")[0]} with the prepared data and
              the agents started. It has no planted events, decisions or learned rules, and the
              clock starts at day 0. Your current copy is kept as it is.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={confirm}>
              {busy ? "Preparing…" : "Reset demo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
