"use client";

import {
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowDownLeft, ArrowUpRight, Check, Download, RefreshCw, X } from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";
import { AGENT_KIND_LABEL, AgentIcon, type AgentKind } from "../icons/AgentIcon";
import { TOOL_CATEGORY_LABEL, ToolIcon } from "../icons/ToolIcon";
import { ToolLogo } from "../icons/ToolLogo";
import { VENDORS, type VendorId } from "../icons/vendors";
import { STATUS_LABEL } from "../investigate/graph";
import type { CanvasStatus } from "../investigate/types";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page";
import { useSelectedCompanyName } from "./company";
import { useFieldData } from "./data";
import {
  type BrainGraph,
  type BrainNode,
  PULSE_SECONDS,
  type Pulse,
  type ToolChip,
  activityFor,
  buildBrainGraph,
  byTime,
  collapsedInstances,
  finishedAge,
  freshOperations,
  instanceNodeId,
  isAgent,
  isWorking,
  neighbors,
  pulsesFor,
} from "./graph";
import { type Box, type MapLayout, type Route, type Stack, layoutMap } from "./map-layout";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  OPERATION_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import { SWARM_BEAT_MS, type SwarmState, initialSwarm, swarmStep } from "./swarm-demo";
import { describeTool } from "./tool-names";
import type { Anomaly, FieldOperation } from "./types";

// The agent web: data sources on the left, outputs on the right, and in between every agent as
// a cluster. A coordinator sits in the middle with the copies it started around it; finished
// copies fold into a "+N finished" stack. Everything comes from the operation log: a dot travels
// a link only when a message or a step is recorded on it, a working agent pulses, and a node
// springs in only the first time it appears after the page loaded. History renders still.

/** How long a finished copy stays on the map (fading) before it folds into its stack. */
const FINISH_GRACE_MS = 3200;
const LEAVE_MS = 600;

type Focus = { id: string | null; related: ReadonlySet<string> };
type View = {
  lit: ReadonlyMap<string, number>;
  hovered: string | null;
  selected: string | null;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
};
type CardData = View & {
  type: "card";
  node: BrainNode;
  box: Box;
  chips: ToolChip[];
  enter: boolean;
  leaving: boolean;
  dimmed: boolean;
  /** Root agents: how many of their copies are working now. */
  running: number;
  /** Cards in the lower part of the web open their hover card upward, so it is not cut off. */
  above: boolean;
};
type StackData = View & { type: "stack"; stack: Stack; titles: string[]; dimmed: boolean };
type MapNode = Node<CardData, "card"> | Node<StackData, "stack">;
type RouteData = { route: Route; pulses: Pulse[]; active: boolean; dimmed: boolean };
type MapEdge = Edge<RouteData, "route">;

const flowStyle = {
  "--xy-background-color": "transparent",
  "--xy-controls-button-background-color": "hsl(var(--card))",
  "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
  "--xy-controls-button-color": "hsl(var(--foreground))",
  "--xy-controls-button-color-hover": "hsl(var(--foreground))",
  "--xy-controls-button-border-color": "hsl(var(--border))",
  "--xy-controls-box-shadow": "none",
} as CSSProperties;

const KIND_LABEL: Record<BrainNode["kind"], string> = {
  agent: "Agent",
  subagent: "Helper agent",
  tool: "Tool",
  source: "Data source",
  output: "Output",
};

const kindOf = (node: BrainNode): AgentKind => node.agentKind ?? "domino";
const kindLabel = (node: BrainNode) =>
  isAgent(node)
    ? node.kind === "subagent"
      ? `${AGENT_KIND_LABEL[kindOf(node)]} · started by another agent`
      : AGENT_KIND_LABEL[kindOf(node)]
    : node.kind === "source"
      ? (node.subtitle ?? "Data source")
      : KIND_LABEL[node.kind];

const LIFECYCLE_LABEL = { spawned: "Starting", working: "Working", done: "Done", failed: "Failed" };
const stateLabel = (node: BrainNode) =>
  node.lifecycle ? LIFECYCLE_LABEL[node.lifecycle] : STATUS_LABEL[node.status];
const stateOf = (node: BrainNode): CanvasStatus =>
  node.lifecycle
    ? node.lifecycle === "done"
      ? "succeeded"
      : node.lifecycle === "failed"
        ? "failed"
        : "running"
    : node.status;

const DOT: Record<CanvasStatus, string> = {
  idle: "bg-muted-foreground/35",
  queued: "bg-clay",
  running: "bg-[hsl(var(--primary-ink))]",
  succeeded: "bg-[hsl(var(--safe))]",
  failed: "bg-destructive",
};

function StatusDot({ status, className }: { status: CanvasStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT[status],
        status === "running" && "motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

/** "8 s", "4 min", "1 h 5 min". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** "working for 12 s" or "took 40 s", from the agent's status rows. */
function elapsed(node: BrainNode, now: number): string | undefined {
  if (!node.startedAt) return undefined;
  const start = Date.parse(node.startedAt);
  if (node.endedAt && !isWorking(node)) return `took ${duration(Date.parse(node.endedAt) - start)}`;
  return `${node.lifecycle === "spawned" ? "starting for" : "working for"} ${duration(now - start)}`;
}

function NodeIcon({ node, size }: { node: BrainNode; size: number }) {
  if (isAgent(node)) return <AgentIcon kind={kindOf(node)} size={size} />;
  if (node.kind === "source") return <ToolLogo vendor={node.vendor ?? "generic"} size={size} />;
  const category =
    node.kind === "tool" ? (node.tool?.category ?? "other") : (node.category ?? "other");
  return <ToolIcon category={category} tile size={size} />;
}

function lastLine(node: { operations: FieldOperation[]; lastAt?: string }, now: number) {
  return node.operations.length ? timeAgo(node.lastAt, now) : "No work yet";
}

const HIDDEN_HANDLE = "!pointer-events-none !opacity-0 !min-h-0 !min-w-0 !size-px !border-0";

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </>
  );
}

const CARD =
  "relative rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-[box-shadow,border-color,opacity] duration-300";
const GLOW =
  "border-[hsl(var(--primary-ink)/0.55)] shadow-[0_0_0_4px_hsl(var(--primary-ink)/0.12),0_8px_24px_-12px_hsl(var(--primary-ink)/0.5)]";
const SELECTED = "border-foreground/40 shadow-[0_0_0_3px_hsl(var(--foreground)/0.08)]";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card";

/** The ring around a working agent: it breathes outward, or holds still with reduced motion. */
function WorkingRing({ radius }: { radius: number }) {
  const reduced = useReducedMotion();
  const ring =
    "pointer-events-none absolute -inset-[3px] border-2 border-[hsl(var(--primary-ink))]";
  if (reduced)
    return (
      <span
        aria-hidden="true"
        className={cn(ring, "opacity-50")}
        style={{ borderRadius: radius }}
      />
    );
  return (
    <motion.span
      aria-hidden="true"
      className={ring}
      style={{ borderRadius: radius }}
      initial={{ opacity: 0.55, scale: 1 }}
      animate={{ opacity: [0.55, 0], scale: [1, 1.07] }}
      transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
    />
  );
}

function CardNode({ data }: NodeProps<Node<CardData, "card">>) {
  const reduced = useReducedMotion();
  const { node, box, enter, leaving, dimmed, onHover, lit, selected } = data;
  const glowing = lit.has(node.id);
  const working = isWorking(node);
  const done = node.lifecycle === "done";
  const hoverChip = data.chips.find((c) => c.id === data.hovered);
  const showHover =
    (data.hovered === node.id || hoverChip) && selected !== (hoverChip?.id ?? node.id);
  const opacity = leaving ? 0 : dimmed ? 0.4 : done && node.kind === "subagent" ? 0.62 : 1;
  return (
    <motion.div
      initial={enter && !reduced ? { opacity: 0, scale: 0.6 } : false}
      animate={{ opacity, scale: leaving && !reduced ? 0.86 : 1 }}
      transition={
        enter && !reduced
          ? { type: "spring", stiffness: 260, damping: 20 }
          : { duration: leaving ? LEAVE_MS / 1000 : 0.3, ease: "easeOut" }
      }
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: box.w, height: box.h }}
    >
      <Handles />
      {working ? <WorkingRing radius={box.depth ? 13 : 15} /> : null}
      <div
        className={cn(
          CARD,
          glowing && GLOW,
          selected === node.id && SELECTED,
          "h-full overflow-hidden",
        )}
        style={glowing ? { transitionDelay: `${lit.get(node.id) ?? 0}s` } : undefined}
      >
        {box.depth > 0 ? (
          <InstanceBody node={node} data={data} done={done} />
        ) : isAgent(node) ? (
          <AgentBody node={node} data={data} />
        ) : (
          <SideBody node={node} data={data} />
        )}
      </div>
      {showHover ? <HoverCard node={node} chip={hoverChip} above={data.above} /> : null}
    </motion.div>
  );
}

function openLabel(node: BrainNode) {
  const task = node.currentTask && isWorking(node) ? `, working on ${node.currentTask}` : "";
  return `${node.title}, ${kindLabel(node).toLowerCase()}, ${stateLabel(node).toLowerCase()}${task}. Open details.`;
}

function AgentBody({ node, data }: { node: BrainNode; data: CardData }) {
  const now = useNow();
  const working = isWorking(node);
  return (
    <>
      <button
        type="button"
        onClick={() => data.onOpen(node.id)}
        aria-label={openLabel(node)}
        className={cn(
          "nodrag nopan flex h-[60px] w-full items-center gap-3 rounded-[inherit] px-3 text-left",
          FOCUS,
        )}
      >
        <NodeIcon node={node} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium leading-5">{node.title}</span>
            {data.running > 0 ? (
              <span className="shrink-0 rounded-full bg-[hsl(var(--primary-ink)/0.1)] px-1.5 text-[11px] font-medium leading-4 text-[hsl(var(--primary-ink))] tabular-nums">
                {data.running} running
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
            <StatusDot status={stateOf(node)} />
            <span className="truncate">
              {working && node.currentTask
                ? node.currentTask
                : `${AGENT_KIND_LABEL[kindOf(node)]} · ${lastLine(node, now)}`}
            </span>
          </span>
        </span>
      </button>
      {data.chips.length ? (
        <ul
          aria-label={`Tools ${node.title} used`}
          className="grid grid-cols-2 gap-1.5 border-t px-2.5 py-2.5"
        >
          {data.chips.map((chip) => (
            <li key={chip.id} className="min-w-0">
              <ChipButton chip={chip} data={data} ownerId={node.id} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ChipButton({ chip, data, ownerId }: { chip: ToolChip; data: CardData; ownerId: string }) {
  const lit = data.lit.has(chip.id);
  return (
    <button
      type="button"
      onClick={() => data.onOpen(chip.id)}
      onMouseEnter={() => data.onHover(chip.id)}
      onMouseLeave={() => data.onHover(ownerId)}
      aria-label={`${chip.label}, ${chip.tools.length} ${chip.tools.length === 1 ? "tool" : "tools"}, ${chip.calls} ${chip.calls === 1 ? "call" : "calls"}. Open details.`}
      className={cn(
        "nodrag nopan flex h-[26px] w-full items-center gap-1.5 rounded-md border bg-background px-1.5 text-left text-xs transition-colors duration-300 hover:bg-muted",
        FOCUS,
        lit && "border-[hsl(var(--primary-ink)/0.4)] bg-[hsl(var(--primary-ink)/0.08)]",
        data.selected === chip.id && "bg-muted",
      )}
      style={lit ? { transitionDelay: `${data.lit.get(chip.id)}s` } : undefined}
    >
      <ToolIcon
        category={chip.category}
        size={13}
        className={cn(
          "text-muted-foreground",
          chip.status === "failed" && "text-[hsl(var(--danger-text))]",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{TOOL_CATEGORY_LABEL[chip.category]}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{chip.calls}</span>
    </button>
  );
}

function InstanceBody({ node, data, done }: { node: BrainNode; data: CardData; done: boolean }) {
  // The kind of tool it used last: enough to see what it is doing without crowding the name.
  const lastTool = [...node.operations].reverse().find((op) => op.tool);
  const categories = lastTool
    ? [describeTool(lastTool.tool ?? "", lastTool.toolCategory).category]
    : [];
  const working = isWorking(node);
  return (
    <button
      type="button"
      onClick={() => data.onOpen(node.id)}
      aria-label={openLabel(node)}
      className={cn(
        "nodrag nopan relative flex h-full w-full items-center gap-2.5 rounded-[inherit] px-2.5 text-left",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium leading-5">{node.title}</span>
          {done ? (
            <Check aria-hidden="true" className="size-3.5 shrink-0 text-[hsl(var(--safe))]" />
          ) : null}
          <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1">
            {categories.map((c) => (
              <ToolIcon key={c} category={c} size={12} className="text-muted-foreground" />
            ))}
          </span>
        </span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {working
            ? (node.currentTask ?? stateLabel(node))
            : done
              ? "Finished"
              : node.lifecycle === "failed"
                ? "Failed"
                : (node.currentTask ?? node.brief)}
        </span>
      </span>
      {node.progress !== undefined ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-2.5 bottom-1.5 h-[3px] rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-[hsl(var(--primary-ink))] transition-[width] duration-700 ease-out"
            style={{ width: `${Math.round(node.progress * 100)}%` }}
          />
        </span>
      ) : null}
    </button>
  );
}

function SideBody({ node, data }: { node: BrainNode; data: CardData }) {
  const now = useNow();
  return (
    <button
      type="button"
      onClick={() => data.onOpen(node.id)}
      aria-label={openLabel(node)}
      className={cn(
        "nodrag nopan flex h-full w-full items-center gap-3 rounded-[inherit] px-3 text-left",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-5">{node.title}</span>
        <span className="flex items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
          <StatusDot status={node.status} />
          {node.kind === "source" ? (
            <>
              {node.subtitle}
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="truncate">{lastLine(node, now)}</span>
        </span>
      </span>
    </button>
  );
}

function StackNode({ data }: NodeProps<Node<StackData, "stack">>) {
  const { stack, titles, dimmed, onOpen, onHover, hovered } = data;
  const n = stack.members.length;
  return (
    <motion.div
      animate={{ opacity: dimmed ? 0.4 : 1 }}
      onMouseEnter={() => onHover(stack.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: stack.box.w, height: stack.box.h }}
      className="relative"
    >
      <Handles />
      <span
        aria-hidden="true"
        className="absolute inset-x-2 -bottom-1.5 h-full rounded-xl border bg-card/70"
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-1 -bottom-[3px] h-full rounded-xl border bg-card/90"
      />
      <motion.button
        key={n}
        type="button"
        initial={{ scale: 1.06 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3 }}
        onClick={() => onOpen(stack.id)}
        aria-label={`${n} finished ${n === 1 ? "agent" : "agents"}. Open the list.`}
        className={cn(
          CARD,
          "nodrag nopan flex h-full w-full items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
          FOCUS,
          data.selected === stack.id && SELECTED,
        )}
      >
        <Check aria-hidden="true" className="size-3.5 text-[hsl(var(--safe))]" />+{n} finished
      </motion.button>
      {hovered === stack.id && data.selected !== stack.id ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-3 w-56 rounded-xl border bg-popover p-3 text-xs text-popover-foreground shadow-[0_12px_32px_-12px_hsl(var(--foreground)/0.25)]"
        >
          <p className="text-muted-foreground">Finished and folded away</p>
          <p className="mt-1 leading-5">
            {titles.slice(-6).join(", ")}
            {titles.length > 6 ? ` and ${titles.length - 6} more` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">Click for the list</p>
        </div>
      ) : null}
    </motion.div>
  );
}

function HoverCard({ node, chip, above }: { node: BrainNode; chip?: ToolChip; above: boolean }) {
  const place = above ? "bottom-full mb-2" : "top-full mt-2";
  const now = useNow(1000);
  if (chip) {
    const tools = [
      ...new Map(chip.operations.flatMap((op) => (op.tool ? [[op.tool, op]] : []))).values(),
    ];
    return (
      <div role="tooltip" className={cn(TOOLTIP, place)}>
        <p className="text-xs text-muted-foreground">Tools · {node.title}</p>
        <p className="text-sm font-medium">{chip.label}</p>
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {tools.map((op) => {
            const info = describeTool(op.tool ?? "", op.toolCategory);
            return (
              <li key={op.tool} className="flex items-center gap-1.5">
                <span className="truncate">{info.label}</span>
                {info.demoActor ? <DemoActorTag /> : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs">
          {chip.calls} {chip.calls === 1 ? "call" : "calls"}, most recent{" "}
          {timeAgo(chip.lastAt, now)}
        </p>
      </div>
    );
  }
  const working = isWorking(node);
  const time = elapsed(node, now);
  const lastMessage = node.messages.at(-1);
  return (
    <div role="tooltip" className={cn(TOOLTIP, place)}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot status={stateOf(node)} />
        {isAgent(node)
          ? `${stateLabel(node)} · ${AGENT_KIND_LABEL[kindOf(node)]}`
          : kindLabel(node)}
      </p>
      <p className="text-sm font-medium">{node.title}</p>
      {isAgent(node) && node.currentTask ? (
        <p className="mt-1 text-xs leading-5">
          <span className="text-muted-foreground">{working ? "Working on: " : "Last task: "}</span>
          {node.currentTask}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{node.brief}</p>
      )}
      {time ? <p className="mt-1 text-xs tabular-nums text-muted-foreground">{time}</p> : null}
      {working && node.progress !== undefined ? (
        <span aria-hidden="true" className="mt-1.5 block h-1 rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-[hsl(var(--primary-ink))]"
            style={{ width: `${Math.round(node.progress * 100)}%` }}
          />
        </span>
      ) : null}
      {lastMessage ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
          Last message: {lastMessage.summary}
        </p>
      ) : !isAgent(node) ? (
        <p className="mt-2 text-xs">
          {node.operations.length
            ? `${node.operations.length} recorded, most recent ${timeAgo(node.lastAt, now)}`
            : "No recorded work yet"}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">Click for details</p>
    </div>
  );
}

const TOOLTIP =
  "pointer-events-none absolute left-3 z-20 w-72 rounded-xl border bg-popover p-3 text-left text-popover-foreground shadow-[0_12px_32px_-12px_hsl(var(--foreground)/0.25)]";

function DemoActorTag() {
  return (
    <span className="shrink-0 rounded border border-dashed px-1 text-[10px] leading-4 text-muted-foreground">
      demo actor
    </span>
  );
}

const ROUTE_LOOK: Record<Route["kind"], { stroke: string; width: number; dash?: string }> = {
  feeds: { stroke: "hsl(var(--foreground) / 0.16)", width: 1.25 },
  produces: { stroke: "hsl(var(--foreground) / 0.12)", width: 1.25 },
  handoff: { stroke: "hsl(var(--foreground) / 0.2)", width: 1.25 },
  message: { stroke: "hsl(var(--primary-ink) / 0.35)", width: 1.25, dash: "3 4" },
  uses: { stroke: "transparent", width: 0 },
};

function RouteEdge({ id, data }: EdgeProps<MapEdge>) {
  const reduced = useReducedMotion();
  if (!data) return null;
  const { route, pulses, active, dimmed } = data;
  const look = ROUTE_LOOK[route.kind];
  const stroke = active ? "hsl(var(--primary-ink) / 0.8)" : look.stroke;
  // Paths glide with their cards when the web re-settles (CSS `d`; browsers without it jump).
  const glide = reduced
    ? undefined
    : { d: `path("${route.path}")`, transition: "d 500ms ease, stroke 300ms" };
  return (
    <g
      className="transition-opacity duration-300"
      style={{ opacity: dimmed ? 0.15 : 1 }}
      data-route={id}
    >
      <path
        d={route.path}
        fill="none"
        stroke={stroke}
        strokeWidth={active ? 1.75 : look.width}
        strokeDasharray={active ? undefined : look.dash}
        strokeLinecap="round"
        style={glide as CSSProperties}
      />
      {reduced
        ? null
        : pulses.map((pulse) => <PulseDot key={pulse.key} pulse={pulse} path={route.path} />)}
    </g>
  );
}

/** One dot along the drawn route, once. Positions come from the path, not from data. */
function PulseDot({ pulse, path }: { pulse: Pulse; path: string }) {
  const dot = useRef<SVGGElement>(null);
  const track = useRef<SVGPathElement>(null);
  useEffect(() => {
    const g = dot.current;
    const line = track.current;
    if (!g || !line) return;
    const length = line.getTotalLength();
    const controls = animate(0, 1, {
      duration: PULSE_SECONDS,
      delay: pulse.delay,
      ease: "easeInOut",
      onUpdate: (t) => {
        const at = line.getPointAtLength((pulse.reverse ? 1 - t : t) * length);
        g.setAttribute("transform", `translate(${at.x} ${at.y})`);
        g.setAttribute("opacity", t <= 0 ? "0" : t > 0.85 ? String((1 - t) / 0.15) : "1");
      },
    });
    return () => controls.stop();
  }, [pulse.delay, pulse.reverse]);
  return (
    <g className="pointer-events-none">
      <path ref={track} d={path} fill="none" stroke="none" />
      <g ref={dot} opacity={0} data-pulse={pulse.key}>
        <circle r={7} fill="hsl(var(--primary-ink) / 0.16)" />
        <circle r={3} fill="hsl(var(--primary-ink))" />
      </g>
    </g>
  );
}

const nodeTypes = { card: CardNode, stack: StackNode };
const edgeTypes = { route: RouteEdge };

/** Re-fit only when the web outgrows what was fitted, so it does not zoom on every change. */
function FitOnGrow({ width, height }: { width: number; height: number }) {
  const { fitView } = useReactFlow();
  const fitted = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!fitted.current) {
      fitted.current = { w: width, h: height };
      return;
    }
    if (width <= fitted.current.w + 24 && height <= fitted.current.h + 24) return;
    fitted.current = { w: width, h: height };
    const id = requestAnimationFrame(() => fitView({ padding: 0.04, maxZoom: 1, duration: 400 }));
    return () => cancelAnimationFrame(id);
  }, [width, height, fitView]);
  // The pane narrows when the details panel docks beside it (or the window resizes): refit so
  // the Outputs lane stays in view instead of hiding under the panel.
  const pane = useStore((s) => s.width);
  const paneSeen = useRef<number | null>(null);
  useEffect(() => {
    if (!pane) return;
    const before = paneSeen.current;
    paneSeen.current = pane;
    if (before === null || Math.abs(before - pane) < 24) return;
    const id = requestAnimationFrame(() => fitView({ padding: 0.04, maxZoom: 1, duration: 300 }));
    return () => cancelAnimationFrame(id);
  }, [pane, fitView]);
  return null;
}

/** Demo only: the scripted swarm ticks on a timer. Live data never mixes with it. */
function useDemoSwarm(enabled: boolean): FieldOperation[] | undefined {
  const [state, setState] = useState<SwarmState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setState((s) => s ?? initialSwarm(Date.now()));
    const id = setInterval(
      () => setState((s) => (s ? swarmStep(s, new Date().toISOString()) : s)),
      SWARM_BEAT_MS,
    );
    return () => clearInterval(id);
  }, [enabled]);
  return enabled ? state?.ops : undefined;
}

/** The node a detail id belongs to: a chip id is "<agent id>|<group>". */
const ownerOf = (id: string) => id.split("|")[0] ?? id;

export function BrainMap() {
  const data = useFieldData();
  const company = useSelectedCompanyName();
  const demo = data.source === "demo";
  const swarm = useDemoSwarm(demo);
  const operations = useMemo(
    () => (data.operations ? [...data.operations, ...(swarm ?? [])] : undefined),
    [data.operations, swarm],
  );
  const now = useNow(500);
  const reduced = useReducedMotion();
  const graph = useMemo(() => buildBrainGraph(operations ?? []), [operations]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Finished copies fade, then fold into their cluster's stack. Keys keep the layout memo stable.
  // The copy a person is pointing at or reading about stays put until they move on.
  const held = (id: string) =>
    (hovered !== null && ownerOf(hovered) === id) ||
    (selected !== null && ownerOf(selected) === id);
  const collapsedKey = [...collapsedInstances(graph, now, FINISH_GRACE_MS)]
    .filter((id) => !held(id))
    .sort()
    .join(" ");
  const leavingKey = graph.nodes
    .filter((n) => {
      const age = finishedAge(n, now);
      return (
        !held(n.id) &&
        age !== undefined &&
        age >= FINISH_GRACE_MS - LEAVE_MS &&
        age < FINISH_GRACE_MS
      );
    })
    .map((n) => n.id)
    .sort()
    .join(" ");
  const collapsed = useMemo(
    () => new Set(collapsedKey ? collapsedKey.split(" ") : []),
    [collapsedKey],
  );
  const leaving = useMemo(() => new Set(leavingKey ? leavingKey.split(" ") : []), [leavingKey]);
  const layout = useMemo(() => layoutMap(graph, { collapsed }), [graph, collapsed]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [lit, setLit] = useState<ReadonlyMap<string, number>>(new Map());
  // Ids already shown. The first real delivery is history: remembered, never animated.
  const seenOps = useRef<Set<string> | null>(null);
  const seenNodes = useRef<Set<string> | null>(null);
  const [appeared, setAppeared] = useState<ReadonlySet<string>>(new Set());
  const batch = useRef(0);
  const litBatch = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!operations) return;
    const quiet = seenOps.current === null;
    const { seen, fresh } = freshOperations(seenOps.current ?? new Set(), operations, quiet);
    seenOps.current = seen;
    const ids = graph.nodes.map((n) => n.id);
    const newNodes = quiet ? [] : ids.filter((id) => !seenNodes.current?.has(id));
    seenNodes.current = new Set(ids);
    if (newNodes.length) setAppeared((cur) => new Set([...cur, ...newNodes]));
    if (!fresh.length) return;
    const id = ++batch.current;
    const next = reduced
      ? []
      : pulsesFor(fresh, graph).map((p) => ({ ...p, key: `${p.key}@${id}` }));
    const active = activityFor(fresh);
    for (const key of active.keys()) litBatch.current.set(key, id);
    setPulses((cur) => [...cur, ...next]);
    setLit((cur) => new Map([...cur, ...active]));
    const last = Math.max(0, ...next.map((p) => p.delay + PULSE_SECONDS), ...active.values());
    const keys = new Set(next.map((p) => p.key));
    const timer = setTimeout(
      () => {
        timers.current.delete(timer);
        setPulses((cur) => cur.filter((p) => !keys.has(p.key)));
        setLit((cur) => {
          const kept = new Map(cur);
          for (const key of active.keys())
            if (litBatch.current.get(key) === id) {
              kept.delete(key);
              litBatch.current.delete(key);
            }
          return kept;
        });
      },
      last * 1000 + 1200,
    );
    timers.current.add(timer);
  }, [operations, graph, reduced]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
    };
  }, []);

  const clusterOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of layout.clusters) for (const m of c.members) map.set(m, c.id);
    for (const s of layout.stacks) for (const m of s.members) map.set(m, s.clusterId);
    return map;
  }, [layout]);

  const focusId = selected ? ownerOf(selected) : hovered ? ownerOf(hovered) : null;
  const focus = useMemo<Focus>(() => {
    if (!focusId) return { id: null, related: new Set() };
    const stack = layout.stacks.find((s) => s.id === focusId);
    if (stack) return { id: focusId, related: new Set([focusId, stack.clusterId]) };
    const { from, to } = neighbors(graph, focusId);
    return {
      id: focusId,
      related: new Set([focusId, ...from.map((n) => n.id), ...to.map((n) => n.id)]),
    };
  }, [graph, layout, focusId]);

  const onOpen = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);
  const onHover = useCallback((id: string | null) => setHovered(id), []);

  useEffect(() => {
    const view: View = { lit, hovered, selected, onOpen, onHover };
    const running = (id: string) =>
      graph.nodes.filter((n) => n.kind === "subagent" && clusterOf.get(n.id) === id && isWorking(n))
        .length;
    const cards: MapNode[] = graph.nodes.flatMap((node) => {
      const box = layout.boxes.get(node.id);
      if (!box) return [];
      const raised = hovered === node.id || hovered?.startsWith(`${node.id}|`);
      return [
        {
          id: node.id,
          type: "card",
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          data: {
            type: "card",
            node,
            box,
            chips: layout.chips.get(node.id) ?? [],
            enter: appeared.has(node.id),
            leaving: leaving.has(node.id),
            dimmed: focus.id !== null && !focus.related.has(node.id),
            running: box.depth === 0 && isAgent(node) ? running(node.id) : 0,
            above: box.y + box.h / 2 > layout.height * 0.55,
            ...view,
          },
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: raised ? 20 : box.depth ? 2 : 1,
          // Not selectable or draggable, so React Flow would drop pointer events; cards handle their own.
          style: { pointerEvents: "all" },
        } satisfies MapNode,
      ];
    });
    const stacks: MapNode[] = layout.stacks.map((stack) => ({
      id: stack.id,
      type: "stack",
      position: { x: stack.box.x, y: stack.box.y },
      width: stack.box.w,
      height: stack.box.h,
      data: {
        type: "stack",
        stack,
        titles: stack.members.map((m) => graph.nodes.find((n) => n.id === m)?.title ?? m),
        dimmed: focus.id !== null && !focus.related.has(stack.id),
        ...view,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: hovered === stack.id ? 20 : 2,
      style: { pointerEvents: "all" },
    }));
    const next = [...cards, ...stacks];
    setNodes((current) => {
      const known = new Map(current.map((n) => [n.id, n]));
      return next.map((n) => {
        const previous = known.get(n.id);
        return previous ? ({ ...previous, ...n, measured: previous.measured } as MapNode) : n;
      });
    });
  }, [
    graph,
    layout,
    appeared,
    leaving,
    focus,
    lit,
    hovered,
    selected,
    onOpen,
    onHover,
    setNodes,
    clusterOf,
  ]);

  const edges = useMemo<MapEdge[]>(
    () =>
      layout.routes.map((route) => {
        const mine = pulses.filter((p) => p.edgeId === route.id);
        const touches =
          focus.id !== null && (route.source === focus.id || route.target === focus.id);
        return {
          id: route.id,
          source: route.source,
          target: route.target,
          type: "route",
          data: {
            route,
            pulses: mine,
            active: mine.length > 0 || touches,
            dimmed: focus.id !== null && !touches,
          },
          focusable: false,
          selectable: false,
        };
      }),
    [layout, pulses, focus],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const detailStack = selected ? layout.stacks.find((s) => s.id === selected) : undefined;
  const detailNode =
    selected && !detailStack ? graph.nodes.find((n) => n.id === ownerOf(selected)) : undefined;
  const detailChip = selected?.includes("|")
    ? layout.chips.get(ownerOf(selected))?.find((c) => c.id === selected)
    : undefined;

  const agents = graph.nodes.filter(isAgent);
  const working = agents.filter(isWorking);
  const finished = agents.filter((n) => n.kind === "subagent" && n.lifecycle === "done").length;
  const messages = agents.reduce((sum, n) => sum + n.messages.length, 0) / 2;
  const coordinator = [...agents]
    .map((a) => ({
      a,
      kids: working.filter((w) => w.kind === "subagent" && clusterOf.get(w.id) === a.id),
    }))
    .sort((x, y) => y.kids.length - x.kids.length)[0];
  const worked = (n: BrainNode) => n.operations.length > 0;
  const counts = {
    agents: agents.filter(worked).length,
    sources: graph.nodes.filter((n) => n.kind === "source" && worked(n)).length,
    outputs: graph.nodes.filter((n) => n.kind === "output" && worked(n)).length,
  };
  const latest = operations?.length
    ? operations.reduce((a, b) => (byTime(a, b) <= 0 ? b : a))
    : undefined;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const roleName = (n: BrainNode) => (n.role ?? n.title).replace(/[-_]+/g, " ").toLowerCase();
  const headline =
    coordinator && coordinator.kids.length > 1
      ? (() => {
          const roles = [...new Set(coordinator.kids.map(roleName))];
          const what =
            roles.length === 1
              ? plural(coordinator.kids.length, roles[0] ?? "agent")
              : plural(coordinator.kids.length, "agent");
          return `${coordinator.a.title} is running ${what} in parallel`;
        })()
      : working.length
        ? `${plural(working.length, "agent")} working now`
        : counts.agents && counts.outputs
          ? `${plural(counts.agents, "agent")} turned ${plural(counts.sources, "data source")} into ${plural(counts.outputs, "output")}`
          : counts.agents
            ? `${plural(counts.agents, "agent")} read ${plural(counts.sources, "data source")}; no outputs yet`
            : "No agent has recorded work yet";
  const kindsShown = [...new Set(agents.map(kindOf))];
  const vendorsShown = [
    ...new Set(graph.nodes.flatMap((n) => (n.kind === "source" && n.vendor ? [n.vendor] : []))),
  ];
  const apifyUsed = graph.nodes.some((n) => n.kind === "tool" && n.tool?.category === "apify");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {company}
            <DataLabel />
            {demo ? <span className="text-xs">Scripted demo agents</span> : null}
          </span>
        }
        title={headline}
        description={
          latest
            ? `Last recorded work ${timeAgo(latest.at, now)}: ${latest.summary.replace(/[.\s]*$/, ".")}`
            : "Work appears here as soon as it is recorded."
        }
      />
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          <strong className="font-semibold tabular-nums">{working.length}</strong>{" "}
          <span className="text-muted-foreground">working now</span>
        </span>
        <span>
          <strong className="font-semibold tabular-nums">{finished}</strong>{" "}
          <span className="text-muted-foreground">copies finished</span>
        </span>
        <span>
          <strong className="font-semibold tabular-nums">{Math.round(messages)}</strong>{" "}
          <span className="text-muted-foreground">messages between agents</span>
        </span>
      </p>
      <MapActions />
      <div
        className={cn(
          "relative flex overflow-hidden rounded-lg border bg-card shadow-xs",
          // Cards glide when the web re-settles. A media query, so server and client agree.
          "motion-safe:[&_.react-flow__node]:transition-transform motion-safe:[&_.react-flow__node]:duration-500",
        )}
        // Tall enough for the web at the screen's width, never taller than the screen.
        style={{
          height: `max(360px, min(calc(100dvh - 240px), ${Math.max(layout.height * 0.75, 560)}px, calc(${(layout.height / Math.max(layout.width, 1)).toFixed(3)} * (100vw - 32px) + 48px)))`,
        }}
      >
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onPaneClick={() => setSelected(null)}
            colorMode="light"
            style={flowStyle}
            fitView
            fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <FitOnGrow width={layout.width} height={layout.height} />
            <Controls
              showInteractive={false}
              position="bottom-left"
              className="overflow-hidden rounded-lg border [&_.react-flow__controls-button]:size-8 [&_.react-flow__controls-button]:border-border"
            />
          </ReactFlow>
          {data.source === "loading" ? (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Loading the agent map...
            </p>
          ) : null}
        </div>
        {detailNode || detailStack ? (
          <>
            {/* On wide screens the panel docks beside the map and the map refits into the space
                left, so no lane is hidden. Narrower, it slides over the map above a backdrop. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close details"
              onClick={() => setSelected(null)}
              className="absolute inset-0 z-10 cursor-default bg-foreground/15 lg:hidden"
            />
            <div className="absolute inset-y-0 right-0 z-20 w-[min(24rem,100%)] border-l bg-card shadow-lg lg:static lg:z-auto lg:w-[22rem] lg:shrink-0 lg:shadow-none xl:w-[24rem]">
              {detailStack ? (
                <StackPanel
                  stack={detailStack}
                  graph={graph}
                  now={now}
                  onClose={() => setSelected(null)}
                  onSelect={setSelected}
                />
              ) : detailNode ? (
                <DetailPanel
                  node={detailNode}
                  chip={detailChip}
                  chips={layout.chips.get(detailNode.id) ?? []}
                  graph={graph}
                  onClose={() => setSelected(null)}
                  onSelect={setSelected}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <Legend kinds={kindsShown} vendors={vendorsShown} apify={apifyUsed} />
    </div>
  );
}

const LEGEND_ORDER: AgentKind[] = ["domino", "claude", "creao", "system", "simulator", "person"];

function Legend({
  kinds,
  vendors,
  apify,
}: { kinds: AgentKind[]; vendors: VendorId[]; apify: boolean }) {
  const group = "flex flex-wrap items-center gap-x-4 gap-y-2";
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <div className={group}>
        <span className="w-32 font-medium text-foreground">Who runs each agent</span>
        {LEGEND_ORDER.filter(
          (k) => kinds.includes(k) || ["domino", "claude", "creao", "system"].includes(k),
        ).map((kind) => (
          <span key={kind} className={cn(item, !kinds.includes(kind) && "opacity-60")}>
            <AgentIcon kind={kind} size={18} />
            {AGENT_KIND_LABEL[kind]}
          </span>
        ))}
      </div>
      <div className={group}>
        <span className="w-32 font-medium text-foreground">Data and tools</span>
        {vendors.map((v) => (
          <span key={v} className={item}>
            <ToolLogo vendor={v} size={18} />
            {VENDORS[v].name}
          </span>
        ))}
        {vendors.includes("apify") ? null : (
          <span className={cn(item, !apify && "opacity-60")}>
            <ToolLogo vendor="apify" size={18} />
            Apify (demo actors)
          </span>
        )}
      </div>
      <div className={group}>
        <span className="w-32 font-medium text-foreground">Lines</span>
        <span className={item}>
          <svg width="28" height="8" aria-hidden="true">
            <path d="M1 4h26" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1.5" />
          </svg>
          Data in, work handed off, results out
        </span>
        <span className={item}>
          <svg width="28" height="8" aria-hidden="true">
            <path
              d="M1 4h26"
              stroke="hsl(var(--primary-ink) / 0.6)"
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
          </svg>
          Messages between agents
        </span>
        <span className={item}>
          <span
            aria-hidden="true"
            className="size-3 rounded-[4px] border-2 border-[hsl(var(--primary-ink))]"
          />
          Pulsing ring: working now
        </span>
      </div>
    </div>
  );
}

function MapActions() {
  const { actions, source, needsSetup } = useFieldData();
  const [busy, setBusy] = useState(false);
  const [anomaly, setAnomaly] = useState<Anomaly | "">("");
  const [error, setError] = useState<string | null>(null);
  const off = busy || source === "loading" || needsSetup;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={off}
        onClick={() => run(() => actions.advanceFeed(anomaly || undefined))}
      >
        <Download aria-hidden="true" className="size-3.5" />
        New entries arrive
      </Button>
      <AnomalyPicker value={anomaly} onChange={setAnomaly} disabled={off} />
      <Button size="sm" variant="outline" disabled={off} onClick={() => run(actions.ingestNow)}>
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Ingest now
      </Button>
      <AutoIngestToggle />
      {error ? (
        <span className="text-xs text-[hsl(var(--danger-text))]">{error}</span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Hover an agent to see what it is doing; click it for its messages and tools.
        </span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t px-4 py-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-2 text-sm leading-6">{children}</div>
    </section>
  );
}

function Values({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-2 text-xs">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-all font-mono">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatusPill({ status, label }: { status: CanvasStatus; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
      <StatusDot status={status} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

function ActivityList({
  operations,
  now,
  showAgent,
}: {
  operations: FieldOperation[];
  now: number;
  showAgent: boolean;
}) {
  if (!operations.length) return <p className="text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ol className="space-y-3">
      {operations.map((op) => {
        const tool = op.tool ? describeTool(op.tool, op.toolCategory) : undefined;
        return (
          <li key={op.id} className="flex gap-2.5">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
              <ToolIcon category={tool?.category ?? "other"} size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "font-medium",
                    op.status === "failed" ? "text-[hsl(var(--danger-text))]" : "text-foreground",
                  )}
                >
                  {tool?.label ?? OPERATION_LABEL[op.kind]}
                </span>
                {tool?.demoActor ? <DemoActorTag /> : null}
                {showAgent ? <span>· {op.agent}</span> : null}
                <span>
                  ·{" "}
                  <time dateTime={op.at} title={clock(op.at)}>
                    {timeAgo(op.at, now)}
                  </time>
                </span>
              </p>
              <p className="leading-5">{op.summary}</p>
              {op.tool ? (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{op.tool}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function NodeChip({ node, onSelect }: { node: BrainNode; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-background py-1 pl-1 pr-2 text-xs hover:bg-muted",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={18} />
      {node.title}
    </button>
  );
}

function MessageList({
  node,
  graph,
  now,
  onSelect,
}: {
  node: BrainNode;
  graph: BrainGraph;
  now: number;
  onSelect: (id: string) => void;
}) {
  const recent = [...node.messages].reverse().slice(0, 10);
  if (!recent.length) return <p className="text-muted-foreground">No messages yet.</p>;
  const find = (ref?: string) =>
    ref ? graph.nodes.find((n) => n.id === instanceNodeId(ref)) : undefined;
  return (
    <ol className="space-y-3">
      {recent.map((op) => {
        const from = find(op.from ?? op.instanceId ?? op.agent);
        const sent = from?.id === node.id;
        const other = sent ? find(op.to) : from;
        const Arrow = sent ? ArrowUpRight : ArrowDownLeft;
        return (
          <li key={op.id} className="flex gap-2.5">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
              <Arrow aria-hidden="true" className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>{sent ? "To" : "From"}</span>
                {other ? (
                  <button
                    type="button"
                    onClick={() => onSelect(other.id)}
                    className={cn(
                      "font-medium text-foreground underline-offset-2 hover:underline",
                      FOCUS,
                    )}
                  >
                    {other.title}
                  </button>
                ) : (
                  <span className="font-medium text-foreground">{sent ? op.to : op.from}</span>
                )}
                <span>
                  ·{" "}
                  <time dateTime={op.at} title={clock(op.at)}>
                    {timeAgo(op.at, now)}
                  </time>
                </span>
              </p>
              <p className="leading-5">{op.summary}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PanelShell({
  title,
  icon,
  eyebrow,
  pill,
  onClose,
  children,
}: {
  title: string;
  icon: ReactNode;
  eyebrow: string;
  pill?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${title} details`}
      className="flex h-full flex-col overflow-hidden bg-card text-card-foreground"
    >
      <div className="flex items-start gap-3 p-4">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{eyebrow}</p>
          <h2 className="break-words text-base font-semibold leading-6">{title}</h2>
          {pill ? <div className="mt-1.5">{pill}</div> : null}
        </div>
        <Button
          variant="ghost"
          aria-label="Close details"
          onClick={onClose}
          className="-mr-2 -mt-2 size-9 p-0"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function StackPanel({
  stack,
  graph,
  now,
  onClose,
  onSelect,
}: {
  stack: Stack;
  graph: BrainGraph;
  now: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const owner = graph.nodes.find((n) => n.id === stack.clusterId);
  const members = stack.members
    .flatMap((id) => graph.nodes.find((n) => n.id === id) ?? [])
    .reverse();
  return (
    <PanelShell
      title={`${members.length} finished ${members.length === 1 ? "agent" : "agents"}`}
      eyebrow={owner ? `Started by ${owner.title}` : "Finished agents"}
      icon={
        <span className="grid size-9 place-items-center rounded-lg border bg-background">
          <Check aria-hidden="true" className="size-4 text-[hsl(var(--safe))]" />
        </span>
      }
      onClose={onClose}
    >
      <p className="px-4 pb-3 text-sm leading-6 text-muted-foreground">
        Copies that finished their task are folded here so the map stays readable. Their work and
        messages are kept.
      </p>
      <Section title="Most recent first">
        <ul className="space-y-1">
          {members.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onSelect(n.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted",
                  FOCUS,
                )}
              >
                <NodeIcon node={n} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {n.currentTask ?? n.brief}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(n.endedAt, now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </PanelShell>
  );
}

function DetailPanel({
  node,
  chip,
  chips,
  graph,
  onClose,
  onSelect,
}: {
  node: BrainNode;
  chip?: ToolChip;
  chips: ToolChip[];
  graph: BrainGraph;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const now = useNow(1000);
  const ops = chip ? chip.operations : node.operations;
  const agent = isAgent(node);
  const recent = [...ops]
    .reverse()
    .filter((op) => !agent || chip || op.tool)
    .slice(0, 8);
  const reasoning = [...ops].reverse().find((op) => op.reasoning)?.reasoning;
  const io = [...ops].reverse().find((op) => op.inputs || op.outputs);
  const { from, to } = neighbors(graph, node.id);
  const linked = chip ? [node] : [...new Map([...from, ...to].map((n) => [n.id, n])).values()];
  const title = chip ? chip.label : node.title;
  const working = isWorking(node);
  const time = elapsed(node, now);
  return (
    <PanelShell
      title={title}
      eyebrow={chip ? `Tools used by ${node.title}` : kindLabel(node)}
      icon={
        chip ? (
          <ToolIcon category={chip.category} tile size={36} />
        ) : (
          <NodeIcon node={node} size={36} />
        )
      }
      pill={
        <StatusPill
          status={chip ? chip.status : stateOf(node)}
          label={chip ? undefined : stateLabel(node)}
        />
      }
      onClose={onClose}
    >
      {chip ? null : (
        <p className="px-4 pb-3 text-sm leading-6 text-muted-foreground">{node.brief}</p>
      )}

      {!chip && agent && (node.currentTask || time) ? (
        <Section title={working ? "Working on now" : "Last task"}>
          {node.currentTask ? <p>{node.currentTask}</p> : null}
          {time ? <p className="text-xs tabular-nums text-muted-foreground">{time}</p> : null}
          {node.progress !== undefined ? (
            <span aria-hidden="true" className="mt-2 block h-1.5 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-[hsl(var(--primary-ink))] transition-[width] duration-700"
                style={{ width: `${Math.round(node.progress * 100)}%` }}
              />
            </span>
          ) : null}
        </Section>
      ) : null}

      {!chip && node.instructions ? (
        <Section title="Instructions">
          <p>{node.instructions}</p>
        </Section>
      ) : null}

      {chip ? (
        <Section title={chip.tools.length === 1 ? "Tool" : `${chip.tools.length} tools`}>
          <ul className="space-y-1.5">
            {chip.tools.map((id) => {
              const t = graph.nodes.find((n) => n.id === id);
              const calls = chip.operations.filter(
                (op) => `tool:${op.tool?.trim().toLowerCase()}` === id,
              ).length;
              return (
                <li key={id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{t?.title ?? id}</span>
                      {t?.tool?.demoActor ? <DemoActorTag /> : null}
                    </span>
                    <code className="block break-all text-[11px] text-muted-foreground">
                      {t?.tool?.raw}
                    </code>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {calls} {calls === 1 ? "call" : "calls"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {!chip && chips.length ? (
        <Section title="Tools, by kind">
          <ul className="space-y-1">
            {chips.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-muted",
                    FOCUS,
                  )}
                >
                  <ToolIcon category={c.category} className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {c.tools.length > 1 ? `${c.tools.length} tools · ` : ""}
                    {c.calls} {c.calls === 1 ? "call" : "calls"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title={
          node.kind === "source"
            ? "Recent reads"
            : chip || agent
              ? "Recent tool calls"
              : "Recent work"
        }
      >
        <ActivityList operations={recent} now={now} showAgent={!agent} />
      </Section>

      {!chip && agent ? (
        <Section title="Messages with other agents">
          <MessageList node={node} graph={graph} now={now} onSelect={onSelect} />
        </Section>
      ) : null}

      {reasoning ? (
        <Section title="Reasoning summary">
          <p>{reasoning}</p>
        </Section>
      ) : null}

      <Section title={chip ? "Used by" : "Connected"}>
        {linked.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {linked.map((n) => (
              <li key={n.id}>
                <NodeChip node={n} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No links recorded yet.</p>
        )}
      </Section>

      {io ? (
        <Section title={`Inputs and outputs (latest, ${timeAgo(io.at, now)})`}>
          {io.inputs ? (
            <div className="mb-2">
              <p className="mb-1 text-xs text-muted-foreground">Inputs</p>
              <Values values={io.inputs} />
            </div>
          ) : null}
          {io.outputs ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Outputs</p>
              <Values values={io.outputs} />
            </div>
          ) : null}
        </Section>
      ) : null}
    </PanelShell>
  );
}
