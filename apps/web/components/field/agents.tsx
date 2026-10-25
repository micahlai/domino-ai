"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ToolId } from "../../convex/connectors/types";
import { cn } from "../../lib/utils";
import { AgentIcon } from "../icons/AgentIcon";
import { ToolLogo } from "../icons/ToolLogo";
import { VENDORS } from "../icons/vendors";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { VENDOR_OF_TOOL } from "./BrainMapConnections";
import { useSelectedCompany } from "./company";

// Agent start (convex/fieldAgents.ts). A newly selected company starts idle: pages show the
// company and its connected tools, plus one calm card pointing at the Brain map, where a person
// presses Start agents. Nothing here invents numbers or activity.

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

/** The one calm card every idle page shows instead of numbers. */
export function AgentsIdleCard({ state, detail }: { state: AgentsState; detail?: ReactNode }) {
  return (
    <section
      aria-label="Agents not started"
      className="rounded-lg border bg-card p-[var(--card-pad,1.25rem)] shadow-xs"
    >
      <p className="text-[15px] font-semibold">Your agents haven't run yet</p>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
        {detail ??
          `${state.name} is connected, but nothing has been read or forecast. Start the agents on the Brain map and this page fills in as their work arrives.`}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button asChild size="sm">
          <Link href={BRAIN_MAP_HREF}>
            Start them on the Brain map
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </Button>
        <SourceLogos tools={state.tools} faded size={20} />
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
export function BrainMapIdle({ state }: { state: AgentsState }) {
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
          <StartAgentsButton companyId={state.companyId} />
        </div>
      </div>
    </div>
  );
}
