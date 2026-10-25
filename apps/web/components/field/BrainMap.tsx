"use client";

import {
  ControlButton,
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
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  List,
  Maximize,
  Network,
  RefreshCw,
  X,
} from "lucide-react";
import { type Transition, animate, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";
import { AGENT_KIND_LABEL, AGENT_TINT, AgentIcon, type AgentKind } from "../icons/AgentIcon";
import { TOOL_CATEGORY_LABEL, ToolIcon } from "../icons/ToolIcon";
import { ToolLogo } from "../icons/ToolLogo";
import { VENDORS, type VendorId } from "../icons/vendors";
import type { CanvasStatus } from "../investigate/types";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  type CameraEvent,
  type CameraState,
  INITIAL_CAMERA,
  cameraStep,
  fitViewport,
} from "./BrainMapCamera";
import { useConnectedVendors } from "./BrainMapConnections";
import { type PanelFocusState, panelFocus } from "./BrainMapFocus";
import { type Draw, EDGE_SECONDS, type GrowNode, growthPlan } from "./BrainMapGrowth";
import { toolOfVendor, useSourceDetail } from "./BrainMapSourceData";
import { SourceHover, SourcePanel } from "./BrainMapSourcePanel";
import { BrainMapIdle, useAgentsState } from "./agents";
import { useSelectedCompanyName } from "./company";
import { nodeResults, resolveMapNode } from "./cross-links";
import { useFieldData } from "./data";
import {
  type BrainGraph,
  type BrainNode,
  PULSE_SECONDS,
  type Pulse,
  type SavedState,
  type ToolChip,
  type ToolProvider,
  type ToolboxGroup,
  activityFor,
  buildBrainGraph,
  byTime,
  collapsedInstances,
  finishedAge,
  freshOperations,
  growthRoot,
  hasWork,
  idleAgents,
  instanceNodeId,
  isAgent,
  isWorking,
  mapCounts,
  mapSources,
  neighbors,
  opAgentId,
  pulsesFor,
  toolChips,
  toolNodeId,
  toolProvider,
  toolboxGroups,
  toolboxId,
  withSavedState,
} from "./graph";
import { plainStatus, statusLine } from "./header-text";
import {
  type Box,
  IDLE_CLUSTER,
  type Lane,
  type LayoutMemory,
  MAX_CHIPS,
  type MapLayout,
  type Route,
  type Stack,
  TOOLBOX_ROWS,
  layoutMap,
} from "./map-layout";
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
/** The growth schedule: ids already accounted for, and absolute times (ms) to pop and draw. */
type GrowthState = {
  known: ReadonlySet<string>;
  knownRoutes: ReadonlySet<string>;
  pop: ReadonlyMap<string, number>;
  draw: ReadonlyMap<string, { at: number; reverse: boolean }>;
  rows: ReadonlyMap<string, number>;
};
const NO_GROWTH: GrowthState = {
  known: new Set(),
  knownRoutes: new Set(),
  pop: new Map(),
  draw: new Map(),
  rows: new Map(),
};
type View = {
  lit: ReadonlyMap<string, number>;
  hovered: string | null;
  selected: string | null;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
};
/** Growth: new and not planned yet (hidden), or popping in after `grow` seconds. */
type Growing = { pending: boolean; grow: number | undefined };
type CardData = View &
  Growing & {
    type: "card";
    node: BrainNode;
    box: Box;
    chips: ToolChip[];
    leaving: boolean;
    dimmed: boolean;
    /** Root agents: how many of their copies are working now. */
    running: number;
    /** Cards in the lower part of the web open their hover card upward, so it is not cut off. */
    above: boolean;
  };
type StackData = View &
  Growing & {
    type: "stack";
    stack: Stack;
    titles: string[];
    dimmed: boolean;
    onToggle: (clusterId: string) => void;
  };
type ToolboxData = View &
  Growing & {
    type: "toolbox";
    group: ToolboxGroup;
    items: BrainNode[];
    box: Box;
    dimmed: boolean;
    /** Tool rows popping in, with their delay in seconds. */
    rows: ReadonlyMap<string, number>;
  };
type LaneData = { type: "lane"; lane: Lane; label: string; count: string };
type MapNode =
  | Node<CardData, "card">
  | Node<StackData, "stack">
  | Node<ToolboxData, "toolbox">
  | Node<LaneData, "lane">;
type RouteData = {
  route: Route;
  pulses: Pulse[];
  /** On the selected or hovered card's path: the only blue lines. */
  active: boolean;
  /** A step is travelling this line now. */
  busy: boolean;
  dimmed: boolean;
  /** Growth: hidden until planned, then drawn in after `delay` seconds (from its target end). */
  pending: boolean;
  draw?: Draw;
};
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

const LANE_LABEL: Record<Lane["id"], string> = {
  source: "Data sources",
  agent: "Agents",
  output: "Outputs",
  toolbox: "Toolbox",
};

/** Any agent kind the log records (Claude, CREAO, ...) keeps its own logo; unknown is Domino. */
const kindOf = (node: BrainNode): AgentKind =>
  node.agentKind && Object.hasOwn(AGENT_KIND_LABEL, node.agentKind) ? node.agentKind : "domino";
const kindLabel = (node: BrainNode) =>
  isAgent(node)
    ? node.kind === "subagent"
      ? `${AGENT_KIND_LABEL[kindOf(node)]} · started by another agent`
      : AGENT_KIND_LABEL[kindOf(node)]
    : node.kind === "source"
      ? (node.subtitle ?? "Data source")
      : KIND_LABEL[node.kind];

const LIFECYCLE_LABEL = { spawned: "Starting", working: "Working", done: "Done", failed: "Failed" };
const AGENT_STATUS: Record<CanvasStatus, string> = {
  idle: "Not used yet",
  queued: "Waiting",
  running: "Working",
  succeeded: "Done",
  failed: "Failed",
};
const stateOf = (node: BrainNode): CanvasStatus =>
  node.lifecycle
    ? node.lifecycle === "done"
      ? "succeeded"
      : node.lifecycle === "failed"
        ? "failed"
        : "running"
    : node.status === "idle" && hasWork(node)
      ? "succeeded"
      : node.status;
/** The status word every card shows: "Working", "Done", "Failed"; sources say "Read". */
const stateLabel = (node: BrainNode) => {
  if (node.lifecycle) return LIFECYCLE_LABEL[node.lifecycle];
  const s = stateOf(node);
  if (node.kind === "source")
    return s === "failed" ? "Read failed" : hasWork(node) ? "Read" : "Not read yet";
  if (node.kind === "output")
    return s === "failed" ? "Failed" : hasWork(node) ? "Ready" : "None yet";
  return AGENT_STATUS[s];
};

/** Restrained meaning: green for done, red for failed, plain text otherwise. Never the blue. */
const STATUS_TEXT: Record<CanvasStatus, string> = {
  idle: "text-muted-foreground",
  queued: "text-muted-foreground",
  running: "text-foreground",
  succeeded: "text-safe",
  failed: "text-destructive",
};
const DOT: Record<CanvasStatus, string> = {
  idle: "bg-muted-foreground/40",
  queued: "bg-muted-foreground",
  running: "bg-foreground",
  succeeded: "bg-safe",
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

/** Dot plus status word, e.g. "Working". */
function StatusText({
  node,
  className,
  label,
}: { node: BrainNode; className?: string; label?: string }) {
  const s = stateOf(node);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-medium",
        STATUS_TEXT[s],
        className,
      )}
    >
      <StatusDot status={s} />
      {label ?? stateLabel(node)}
    </span>
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

/**
 * Squircle corners: a superellipse where the browser supports `corner-shape`, a plain rounded
 * corner elsewhere.
 */
const SQUIRCLE =
  "rounded-[14px] supports-[corner-shape:squircle]:rounded-[22px] [corner-shape:squircle]";
const CARD = cn(
  "relative border bg-card text-card-foreground shadow-xs transition-[border-color,opacity] duration-300",
  SQUIRCLE,
);
/** A new event touched this card: a quiet border change, no glow. */
const LIT = "border-foreground/35";
/** Blue marks only the selected card and its links. */
const SELECTED = "border-[hsl(var(--primary-ink))] ring-1 ring-[hsl(var(--primary-ink))]";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card";

/** Pop in: from 60% past full size, then settle, fading in. Constant objects so it runs once. */
const HIDDEN = { opacity: 0, scale: 0.6 };
const SHOWN = { opacity: 1, scale: 1 };
const POP = { opacity: [0, 1, 1], scale: [0.6, 1.06, 1] };
const popTransition = (delay: number): Transition => ({
  duration: 0.8,
  delay,
  times: [0, 0.62, 1],
  ease: ["easeOut", "easeInOut"],
});
const RIPPLE_FROM = { opacity: 0, scale: 1 };
const RIPPLE_TO = { opacity: [0, 0.5, 0], scale: [1, 1, 1.18] };
const PULSE = { opacity: [0.45, 0], scale: [1, 1.06] };
const PULSE_TRANSITION: Transition = {
  duration: 1.6,
  ease: "easeOut",
  repeat: Number.POSITIVE_INFINITY,
};

/**
 * Growth for one card: hidden until its parent's link has reached it, then it pops in with a
 * soft ripple. `pending` cards are new and not planned yet; `grow` is the delay in seconds.
 */
function Grow({
  pending,
  grow,
  children,
  className,
}: {
  pending: boolean;
  grow: number | undefined;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={cn("relative size-full", className)}>{children}</div>;
  const popping = grow !== undefined;
  return (
    <motion.div
      initial={pending || popping ? HIDDEN : false}
      animate={pending ? HIDDEN : popping ? POP : SHOWN}
      transition={popping ? popTransition(grow) : { duration: 0 }}
      className={cn("relative size-full", className)}
    >
      {children}
      {popping ? (
        <motion.span
          aria-hidden="true"
          initial={RIPPLE_FROM}
          animate={RIPPLE_TO}
          transition={{ duration: 1, delay: grow + 0.3, ease: "easeOut" }}
          className={cn(
            "pointer-events-none absolute inset-0 border-2 border-[hsl(var(--primary-ink)/0.35)]",
            SQUIRCLE,
          )}
        />
      ) : null}
    </motion.div>
  );
}

/** A soft ring breathing out of a working agent's card. Reduced motion: none. */
function WorkingPulse() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <motion.span
      aria-hidden="true"
      initial={false}
      animate={PULSE}
      transition={PULSE_TRANSITION}
      className={cn("pointer-events-none absolute -inset-1 border border-foreground/30", SQUIRCLE)}
    />
  );
}

/** Hover summaries open on keyboard focus too. */
const hoverOn = (onHover: View["onHover"], id: string) => ({
  onFocus: () => onHover(id),
  onBlur: () => onHover(null),
  "data-open-id": id,
});

/** Where a card's hover card opens: beside the side lanes, under (or over) agents. */
function hoverPlace(node: BrainNode, above: boolean) {
  if (node.kind === "source") return "left-full top-0 ml-2";
  if (node.kind === "output") return "right-full top-0 mr-2";
  return cn("left-3", above ? "bottom-full mb-2" : "top-full mt-2");
}

function CardNode({ data }: NodeProps<Node<CardData, "card">>) {
  const reduced = useReducedMotion();
  const { node, box, leaving, dimmed, onHover, lit, selected } = data;
  const glowing = lit.has(node.id);
  const done =
    node.lifecycle === "done" || (node.kind === "subagent" && stateOf(node) === "succeeded");
  const hoverChip = data.chips.find((c) => c.id === data.hovered);
  const showHover =
    (data.hovered === node.id || hoverChip) && selected !== (hoverChip?.id ?? node.id);
  const opacity = leaving ? 0 : dimmed ? 0.4 : 1;
  return (
    <motion.div
      animate={{ opacity, scale: leaving && !reduced ? 0.92 : 1 }}
      transition={{ duration: leaving ? LEAVE_MS / 1000 : 0.3, ease: "easeOut" }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: box.w, height: box.h }}
      className="relative"
    >
      <Handles />
      <Grow pending={data.pending} grow={data.grow}>
        {isAgent(node) && isWorking(node) ? <WorkingPulse /> : null}
        <div
          className={cn(
            CARD,
            glowing && LIT,
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
      </Grow>
      {showHover ? (
        <HoverCard node={node} chip={hoverChip} place={hoverPlace(node, data.above)} />
      ) : null}
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
  // At most MAX_CHIPS chips: the last place says "+N" and opens the full list.
  const over = data.chips.length > MAX_CHIPS;
  const shown = over ? data.chips.slice(0, MAX_CHIPS - 1) : data.chips;
  const rest = data.chips.length - shown.length;
  return (
    <>
      <button
        type="button"
        onClick={() => data.onOpen(node.id)}
        aria-label={openLabel(node)}
        {...hoverOn(data.onHover, node.id)}
        className={cn(
          "nodrag nopan flex h-14 w-full items-center gap-2.5 rounded-[inherit] px-3 text-left",
          FOCUS,
        )}
      >
        <NodeIcon node={node} size={30} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium leading-5">{node.title}</span>
            {data.running > 0 ? (
              <span className="shrink-0 rounded-md border px-1.5 text-xs font-medium leading-5 tabular-nums">
                {data.running} working
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
            <StatusText node={node} />
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {working && node.currentTask
                ? node.currentTask
                : hasWork(node)
                  ? lastLine(node, now)
                  : AGENT_KIND_LABEL[kindOf(node)]}
            </span>
          </span>
        </span>
      </button>
      {data.chips.length ? (
        <ul
          aria-label={`Tools ${node.title} used`}
          className="grid grid-cols-2 gap-1.5 border-t px-2 py-2"
        >
          {shown.map((chip) => (
            <li key={chip.id} className="min-w-0">
              <ChipButton chip={chip} data={data} ownerId={node.id} />
            </li>
          ))}
          {rest > 0 && over ? (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => data.onOpen(node.id)}
                aria-label={`${rest} more kinds of tools. Open details.`}
                className={cn(
                  "nodrag nopan flex h-[26px] w-full items-center justify-center rounded-[10px] border bg-background px-1.5 text-xs text-muted-foreground hover:bg-muted",
                  FOCUS,
                )}
              >
                +{rest} more
              </button>
            </li>
          ) : null}
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
      {...hoverOn(data.onHover, chip.id)}
      aria-label={`${chip.label}, ${chip.tools.length} ${chip.tools.length === 1 ? "tool" : "tools"}, ${chip.calls} ${chip.calls === 1 ? "call" : "calls"}. Open details.`}
      className={cn(
        "nodrag nopan flex h-[26px] w-full items-center gap-1.5 rounded-[10px] border bg-background px-1.5 text-left text-xs transition-colors duration-300 hover:bg-muted",
        FOCUS,
        lit && "border-foreground/35",
        data.selected === chip.id && "border-[hsl(var(--primary-ink))] bg-muted",
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
    ? [describeTool(lastTool.tool ?? "", lastTool.toolCategory, lastTool.toolLabel).category]
    : [];
  const working = isWorking(node);
  const detail = working || done ? node.currentTask : (node.currentTask ?? node.brief);
  return (
    <button
      type="button"
      onClick={() => data.onOpen(node.id)}
      aria-label={openLabel(node)}
      {...hoverOn(data.onHover, node.id)}
      className={cn(
        "nodrag nopan relative flex h-full w-full items-center gap-2 rounded-[inherit] px-2.5 text-left",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium leading-5">{node.title}</span>
          <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1">
            {categories.map((c) => (
              <ToolIcon key={c} category={c} size={13} className="text-muted-foreground" />
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <StatusText node={node} />
          {detail ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{detail}</span>
            </>
          ) : null}
        </span>
      </span>
      {node.progress !== undefined ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 bottom-1 h-[3px] rounded-full bg-muted"
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

/** Outputs lead with what is saved; sources with when they were last read. */
function sideLine(node: BrainNode, now: number) {
  if (node.kind === "output") return node.saved ?? lastLine(node, now);
  return node.operations.length ? timeAgo(node.lastAt, now) : (node.saved ?? "No work yet");
}

function SideBody({ node, data }: { node: BrainNode; data: CardData }) {
  const now = useNow();
  return (
    <button
      type="button"
      onClick={() => data.onOpen(node.id)}
      aria-label={openLabel(node)}
      {...hoverOn(data.onHover, node.id)}
      className={cn(
        "nodrag nopan flex h-full w-full items-center gap-2.5 rounded-[inherit] px-2.5 text-left",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-5">{node.title}</span>
        <span className="flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <StatusText node={node} />
          <span aria-hidden="true">·</span>
          <span className="truncate">{sideLine(node, now)}</span>
        </span>
      </span>
    </button>
  );
}

/** "8 completed helpers" or "2 agents not used yet". */
export function stackLabel(stack: Stack): string {
  const n = stack.members.length;
  return stack.clusterId === IDLE_CLUSTER
    ? `${n} ${n === 1 ? "agent" : "agents"} not used yet`
    : `${n} completed ${n === 1 ? "helper" : "helpers"}`;
}

function StackNode({ data }: NodeProps<Node<StackData, "stack">>) {
  const { stack, titles, dimmed, onToggle, onHover, hovered } = data;
  const label = stackLabel(stack);
  const Chevron = stack.expanded ? ChevronDown : ChevronRight;
  return (
    <motion.div
      animate={{ opacity: dimmed ? 0.4 : 1 }}
      onMouseEnter={() => onHover(stack.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: stack.box.w, height: stack.box.h }}
      className="relative"
    >
      <Handles />
      <Grow pending={data.pending} grow={data.grow}>
        <button
          type="button"
          onClick={() => onToggle(stack.clusterId)}
          aria-expanded={Boolean(stack.expanded)}
          aria-label={`${label}. ${stack.expanded ? "Fold them away" : "Show them on the map"}.`}
          {...hoverOn(onHover, stack.id)}
          className={cn(
            CARD,
            "nodrag nopan flex h-full w-full items-center gap-1.5 px-2.5 text-left text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
            FOCUS,
          )}
        >
          <Chevron aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {stack.expanded ? `Fold ${label}` : <StackCount stack={stack} label={label} />}
          </span>
        </button>
      </Grow>
      {hovered === stack.id && !stack.expanded ? (
        <div role="tooltip" className={cn(TOOLTIP, "left-0 top-full mt-2 w-64")}>
          <p className="text-xs text-muted-foreground">
            {stack.clusterId === IDLE_CLUSTER ? "No recorded work yet" : "Finished and folded away"}
          </p>
          <p className="mt-1 text-[13px] leading-5">
            {titles.slice(-6).join(", ")}
            {titles.length > 6 ? ` and ${titles.length - 6} more` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Press to show them on the map</p>
        </div>
      ) : null}
    </motion.div>
  );
}

/** The stack's count settles with a small bounce each time another helper folds into it. */
function StackCount({ stack, label }: { stack: Stack; label: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      key={stack.members.length}
      className="inline-block origin-left"
      initial={reduced ? false : { scale: 1.12, opacity: 0.5 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 20 }}
    >
      {label}
    </motion.span>
  );
}

const PROVIDER: Record<ToolProvider, { name: string; note: string; icon: ReactNode }> = {
  apify: {
    name: "Apify",
    note: "Web data actors (demo)",
    icon: <ToolLogo vendor="apify" size={26} />,
  },
  claude: { name: "Claude", note: "Model calls", icon: <AgentIcon kind="claude" size={26} /> },
  creao: { name: "CREAO", note: "Model calls", icon: <AgentIcon kind="creao" size={26} /> },
  crs: {
    name: "CRS",
    note: "Identity and fraud checks (sandbox)",
    icon: <ToolLogo vendor="crs" size={26} />,
  },
};

/** One outside provider in the toolbox, with the tools of it agents used. */
function ToolboxNode({ data }: NodeProps<Node<ToolboxData, "toolbox">>) {
  const reduced = useReducedMotion();
  const { group, items, dimmed, onHover, onOpen, lit, selected } = data;
  const p = PROVIDER[group.provider];
  const calls = items.reduce((sum, n) => sum + n.operations.length, 0);
  // The card has room for TOOLBOX_ROWS rows; the last says "+N more" when there are more.
  const shown = items.length > TOOLBOX_ROWS ? items.slice(0, TOOLBOX_ROWS - 1) : items;
  const hidden = items.slice(shown.length);
  return (
    <motion.div
      animate={{ opacity: dimmed ? 0.4 : 1 }}
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: data.box.w, height: data.box.h }}
      className="relative"
    >
      <Handles />
      <Grow pending={data.pending} grow={data.grow}>
        <section
          aria-label={`${p.name} tools`}
          className={cn(CARD, "h-full overflow-hidden", lit.has(group.id) && LIT)}
        >
          <div className="flex h-11 items-center gap-2.5 px-2.5">
            {p.icon}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-5">{p.name}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">
                {items.length} {items.length === 1 ? "tool" : "tools"} · {calls}{" "}
                {calls === 1 ? "call" : "calls"}
              </span>
            </span>
          </div>
          <ul aria-label={p.note} className="border-t px-1.5 py-1">
            {shown.map((n) => {
              const rowGrow = data.rows.get(n.id);
              return (
                <motion.li
                  key={n.id}
                  initial={!reduced && rowGrow !== undefined ? HIDDEN : false}
                  animate={!reduced && rowGrow !== undefined ? POP : SHOWN}
                  transition={rowGrow !== undefined ? popTransition(rowGrow) : { duration: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(n.id)}
                    aria-label={`${n.title}, ${n.operations.length} ${n.operations.length === 1 ? "call" : "calls"}. Open details.`}
                    className={cn(
                      "nodrag nopan flex h-6 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs transition-colors duration-300 hover:bg-muted",
                      FOCUS,
                      lit.has(n.id) && "bg-muted",
                      selected === n.id && "bg-muted text-foreground",
                    )}
                  >
                    <ToolIcon category={n.tool?.category ?? "apify"} size={12} />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {n.operations.length}
                    </span>
                  </button>
                </motion.li>
              );
            })}
            {hidden.length ? (
              <li>
                <button
                  type="button"
                  onClick={() => hidden[0] && onOpen(hidden[0].id)}
                  aria-label={`${hidden.length} more ${p.name} tools. Open details.`}
                  className={cn(
                    "nodrag nopan flex h-6 w-full items-center rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-muted",
                    FOCUS,
                  )}
                >
                  +{hidden.length} more
                </button>
              </li>
            ) : null}
          </ul>
        </section>
      </Grow>
    </motion.div>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData, "lane">>) {
  return (
    <h3
      className="flex items-baseline gap-2 truncate text-[13px] font-semibold leading-5 text-foreground"
      style={{ width: data.lane.w }}
    >
      {data.label}
      <span className="font-normal text-muted-foreground">{data.count}</span>
    </h3>
  );
}

function HoverCard({ node, chip, place }: { node: BrainNode; chip?: ToolChip; place: string }) {
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
            const info = describeTool(op.tool ?? "", op.toolCategory, op.toolLabel);
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
  const tool = node.kind === "source" ? toolOfVendor(node.vendor) : undefined;
  if (tool)
    return (
      <div role="tooltip" className={cn(TOOLTIP, place)}>
        <SourceHoverCard node={node} now={now} />
      </div>
    );
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
          {node.saved ? `${node.saved}. ` : ""}
          {node.operations.length
            ? `${node.operations.length} in the loaded events, most recent ${timeAgo(node.lastAt, now)}`
            : node.saved
              ? "None in the loaded events"
              : "No recorded work yet"}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">Press for details</p>
    </div>
  );
}

function SourceHoverCard({ node, now }: { node: BrainNode; now: number }) {
  const state = useSourceDetail(toolOfVendor(node.vendor), node.lastAt);
  return (
    <SourceHover
      detail={state.state === "ready" ? state.detail : undefined}
      vendor={node.vendor ?? "generic"}
      title={node.title}
      now={now}
    />
  );
}

const TOOLTIP =
  "pointer-events-none absolute z-20 w-72 rounded-lg border bg-popover p-3 text-left text-popover-foreground shadow-md";

function DemoActorTag() {
  return (
    <span className="shrink-0 rounded border px-1 text-xs leading-4 text-muted-foreground">
      demo actor
    </span>
  );
}

const ROUTE_LOOK: Record<Route["kind"], { stroke: string; width: number; dash?: string }> = {
  feeds: { stroke: "hsl(var(--foreground) / 0.16)", width: 1.25 },
  produces: { stroke: "hsl(var(--foreground) / 0.12)", width: 1.25 },
  handoff: { stroke: "hsl(var(--foreground) / 0.2)", width: 1.25 },
  message: { stroke: "hsl(var(--foreground) / 0.28)", width: 1.25, dash: "3 4" },
  /** An agent to the outside tools it used: a faint dotted line. */
  uses: { stroke: "hsl(var(--foreground) / 0.14)", width: 1, dash: "1 4" },
};

function RouteEdge({ id, data }: EdgeProps<MapEdge>) {
  const reduced = useReducedMotion();
  // A growing link extends from its parent's end; once there it renders like any other link.
  const [grown, setGrown] = useState(false);
  if (!data) return null;
  const { route, pulses, active, dimmed } = data;
  const look = ROUTE_LOOK[route.kind];
  const stroke = active
    ? "hsl(var(--primary-ink) / 0.8)"
    : data.busy
      ? "hsl(var(--foreground) / 0.35)"
      : look.stroke;
  if (data.pending && !reduced) return null;
  const growing = Boolean(data.draw) && !grown && !reduced;
  // Paths glide with their cards if the web ever re-settles (CSS `d`; browsers without it jump).
  const glide = reduced
    ? undefined
    : { d: `path("${route.path}")`, transition: "d 500ms ease, stroke 300ms" };
  return (
    <g
      className="transition-opacity duration-300"
      style={{ opacity: dimmed ? 0.15 : 1 }}
      data-route={id}
    >
      {growing && data.draw ? (
        <motion.path
          d={route.path}
          fill="none"
          stroke="hsl(var(--foreground) / 0.32)"
          strokeWidth={1.5}
          strokeLinecap="round"
          initial={{ pathLength: 0, pathOffset: data.draw.reverse ? 1 : 0, opacity: 1 }}
          animate={{ pathLength: 1, pathOffset: 0 }}
          transition={{ delay: data.draw.delay, duration: EDGE_SECONDS, ease: "easeOut" }}
          onAnimationComplete={() => setGrown(true)}
        />
      ) : (
        <path
          d={route.path}
          fill="none"
          stroke={stroke}
          strokeWidth={active ? 1.75 : look.width}
          strokeDasharray={active ? undefined : look.dash}
          strokeLinecap="round"
          style={glide as CSSProperties}
        />
      )}
      {reduced
        ? null
        : pulses.map((pulse) => <PulseDot key={pulse.key} pulse={pulse} path={route.path} />)}
    </g>
  );
}

/** Light particles trailing each other along the drawn route, once: data moving. */
const PARTICLES = [
  { lag: 0, r: 2.6 },
  { lag: 0.07, r: 2 },
  { lag: 0.14, r: 1.5 },
];

function PulseDot({ pulse, path }: { pulse: Pulse; path: string }) {
  const dots = useRef<(SVGGElement | null)[]>([]);
  const track = useRef<SVGPathElement>(null);
  useEffect(() => {
    const line = track.current;
    if (!line) return;
    const length = line.getTotalLength();
    const controls = animate(0, 1 + (PARTICLES.at(-1)?.lag ?? 0), {
      duration: PULSE_SECONDS * 1.15,
      delay: pulse.delay,
      ease: "easeInOut",
      onUpdate: (v) => {
        PARTICLES.forEach((p, i) => {
          const g = dots.current[i];
          if (!g) return;
          const t = Math.min(1, Math.max(0, v - p.lag));
          const at = line.getPointAtLength((pulse.reverse ? 1 - t : t) * length);
          g.setAttribute("transform", `translate(${at.x} ${at.y})`);
          g.setAttribute("opacity", t <= 0 ? "0" : t > 0.85 ? String((1 - t) / 0.15) : "1");
        });
      },
    });
    return () => controls.stop();
  }, [pulse.delay, pulse.reverse]);
  return (
    <g className="pointer-events-none">
      <path ref={track} d={path} fill="none" stroke="none" />
      {PARTICLES.map((p, i) => (
        <g
          key={p.lag}
          ref={(el) => {
            dots.current[i] = el;
          }}
          opacity={0}
          data-pulse={i === 0 ? pulse.key : undefined}
        >
          {i === 0 ? <circle r={7} fill="hsl(var(--primary-ink) / 0.14)" /> : null}
          <circle r={p.r} fill="hsl(var(--primary-ink))" fillOpacity={1 - i * 0.25} />
        </g>
      ))}
    </g>
  );
}

const nodeTypes = { card: CardNode, stack: StackNode, toolbox: ToolboxNode, lane: LaneNode };
const edgeTypes = { route: RouteEdge };

/**
 * The map's camera. It fits the whole map once, when the first data has loaded, and after that
 * only a person moves it (drag, pinch, zoom buttons, the fit button): new events, new cards,
 * finished helpers and resizes never change zoom or position. Rules live in BrainMapCamera.ts.
 */
function Camera({
  bounds,
  ready,
  narrow,
  layout,
  api,
}: {
  bounds: MapLayout["bounds"];
  ready: boolean;
  narrow: boolean;
  layout: MapLayout;
  api: RefObject<((event: CameraEvent) => void) | null>;
}) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const reduced = useReducedMotion();
  const state = useRef<CameraState>(INITIAL_CAMERA);
  const live = useRef({ bounds, width, height, narrow, reduced });
  live.current = { bounds, width, height, narrow, reduced };
  const send = useCallback(
    (event: CameraEvent) => {
      const step = cameraStep(state.current, event);
      state.current = step.state;
      const view = live.current;
      if (!step.fit || !view.width || !view.height) return;
      void setViewport(
        fitViewport(view.bounds, view.width, view.height, view.narrow ? { minZoom: 0.3 } : {}),
        { duration: view.reduced || event === "ready" ? 0 : 300 },
      );
    },
    [setViewport],
  );
  api.current = send;
  useEffect(() => {
    if (ready && width > 0 && height > 0) send("ready");
  }, [ready, width, height, send]);
  const seen = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!width || !height) return;
    const prev = seen.current;
    seen.current = { w: width, h: height };
    // By rule a resize (window, docked panel) leaves the view alone.
    if (prev && (prev.w !== width || prev.h !== height)) send("resize");
  }, [width, height, send]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every new layout is a data update, which by rule leaves the view alone.
  useEffect(() => send("data"), [layout, send]);
  return null;
}

/** True below 640px. False on the server and first paint, then follows the viewport. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
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

/**
 * `embedded`: no page header or feed buttons, for a host page that has its own (/judge).
 * Before Start agents only the idle coordinator shows; once started the live map mounts and
 * grows as real operations arrive.
 */
export function BrainMap({ embedded = false }: { embedded?: boolean } = {}) {
  const agents = useAgentsState();
  const company = useSelectedCompanyName();
  if (agents === undefined) return null;
  if (agents && !agents.started)
    return (
      <div className="space-y-5">
        {embedded ? null : (
          <PageHeader
            eyebrow={company}
            title="Your agents are ready to start"
            description="The tools are connected but nothing has been read yet. Press Start agents: the coordinator calls in helpers as real work is recorded."
          />
        )}
        <BrainMapIdle state={agents} />
      </div>
    );
  return <BrainMapLive embedded={embedded} />;
}

function BrainMapLive({ embedded }: { embedded: boolean }) {
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
  const narrow = useNarrow();
  const [mobileMap, setMobileMap] = useState(false);
  const logGraph = useMemo(() => buildBrainGraph(operations ?? []), [operations]);
  // Saved state, so outputs and sources read before the loaded events still count.
  const savedKey = JSON.stringify({
    sources: data.status?.sources,
    booksVersions: data.status?.counts.snapshots,
    flags: data.findings
      ? {
          total: data.findings.length,
          open: data.findings.filter((f) => f.status === "open").length,
        }
      : undefined,
  } satisfies SavedState);
  const fullGraph = useMemo(
    () => withSavedState(logGraph, JSON.parse(savedKey) as SavedState),
    [logGraph, savedKey],
  );
  // Only connected sources; Apify and the model providers live in the toolbox instead.
  const connected = useConnectedVendors();
  const graph = useMemo(() => mapSources(fullGraph, connected), [fullGraph, connected]);
  const toolbox = useMemo(() => toolboxGroups(fullGraph), [fullGraph]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Cross-links open the map on one node (?node=agent:audit). Applied once, when it exists.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("node");
    if (!param) {
      linked.current = true;
      return;
    }
    const id = resolveMapNode(
      param,
      fullGraph.nodes.map((n) => n.id),
    );
    if (id) {
      linked.current = true;
      setSelected(id);
    }
  }, [fullGraph]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const onToggle = useCallback(
    (clusterId: string) =>
      setExpanded((cur) => {
        const next = new Set(cur);
        if (!next.delete(clusterId)) next.add(clusterId);
        return next;
      }),
    [],
  );

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
  const idleKey = idleAgents(graph)
    .filter((id) => !held(id))
    .join(" ");
  // Each layout starts from the last one's memory, so existing tiles keep their places. While a
  // stack is open the memory is not saved, so folding it again restores the usual places.
  const memory = useRef<LayoutMemory | undefined>(undefined);
  const layout = useMemo(
    () =>
      layoutMap(graph, {
        collapsed,
        expanded,
        idle: idleKey ? idleKey.split(" ") : [],
        toolbox,
        memory: memory.current,
      }),
    [graph, collapsed, expanded, idleKey, toolbox],
  );
  useEffect(() => {
    if (!expanded.size) memory.current = layout.memory;
  }, [layout, expanded]);

  const camera = useRef<((event: CameraEvent) => void) | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [lit, setLit] = useState<ReadonlyMap<string, number>>(new Map());
  // Operations already shown. The first real delivery is history: remembered, never pulsed.
  const seenOps = useRef<Set<string> | null>(null);
  const batch = useRef(0);
  const litBatch = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!operations) return;
    const quiet = seenOps.current === null;
    const { seen, fresh } = freshOperations(seenOps.current ?? new Set(), operations, quiet);
    seenOps.current = seen;
    if (!fresh.length) return;
    const id = ++batch.current;
    // Data back from an outside tool runs from its toolbox card to the agent that called it.
    const toolPulses = fresh.flatMap((op, i): Pulse[] => {
      const tool = op.tool
        ? fullGraph.nodes.find((n) => n.id === toolNodeId(op.tool ?? ""))
        : undefined;
      const provider = tool ? toolProvider(tool) : undefined;
      return provider
        ? [
            {
              key: `${op.id}:t`,
              edgeId: `${opAgentId(op)}->${toolboxId(provider)}`,
              delay: i * 0.3 * PULSE_SECONDS,
              reverse: true,
            },
          ]
        : [];
    });
    const next = reduced
      ? []
      : [...pulsesFor(fresh, graph), ...toolPulses].map((p) => ({ ...p, key: `${p.key}@${id}` }));
    const active = activityFor(fresh);
    for (const op of fresh) {
      const tool = op.tool
        ? fullGraph.nodes.find((n) => n.id === toolNodeId(op.tool ?? ""))
        : undefined;
      const provider = tool ? toolProvider(tool) : undefined;
      if (tool && provider) {
        active.set(toolboxId(provider), 0);
        active.set(tool.id, 0);
      }
    }
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
  }, [operations, graph, fullGraph, reduced]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
    };
  }, []);

  // Growth: the web grows out from its root. Each new card waits for a link to extend to it
  // from a card already on screen, then pops in (BrainMapGrowth.ts). The first load grows the
  // whole web in order; later cards grow the same way. Reduced motion: everything shows at once.
  const grown = useRef<{
    nodes: Set<string>;
    routes: Set<string>;
    rows: Set<string>;
    pop: Map<string, number>;
  } | null>(null);
  const [plan, setPlan] = useState<GrowthState>(NO_GROWTH);
  const ready = data.source !== "loading" && operations !== undefined;
  useEffect(() => {
    if (!ready) return;
    const nodeIds = [...layout.boxes.keys(), ...layout.stacks.map((st) => st.id)];
    const rowIds = toolbox.flatMap((g) => g.items);
    const first = grown.current === null;
    const g = grown.current ?? {
      nodes: new Set(),
      routes: new Set(),
      rows: new Set(),
      pop: new Map(),
    };
    grown.current = g;
    const freshNodes = nodeIds.filter((id) => !g.nodes.has(id));
    const freshRoutes = layout.routes.filter((r) => !g.routes.has(r.id));
    const freshRows = rowIds.filter((id) => !g.rows.has(id));
    if (!first && !freshNodes.length && !freshRoutes.length && !freshRows.length) return;
    for (const id of freshNodes) g.nodes.add(id);
    for (const r of freshRoutes) g.routes.add(r.id);
    for (const id of freshRows) g.rows.add(id);
    const now = Date.now();
    const pop = new Map<string, number>();
    const draw = new Map<string, { at: number; reverse: boolean }>();
    const rows = new Map<string, number>();
    if (!reduced) {
      const fresh = new Set(freshNodes);
      const known = new Map(
        nodeIds
          .filter((id) => !fresh.has(id))
          .map((id) => [id, ((g.pop.get(id) ?? 0) - now) / 1000]),
      );
      const kindOfId = (id: string): GrowNode["kind"] => {
        if (id.startsWith("toolbox:")) return "tool";
        if (id.startsWith("stack:")) return "swarm";
        const n = graph.nodes.find((x) => x.id === id);
        if (n?.kind === "source") return "source";
        if (n?.kind === "output") return "output";
        return n?.kind === "subagent" ? "swarm" : "agent";
      };
      const result = growthPlan(
        freshNodes.map((id) => ({ id, kind: kindOfId(id) })),
        freshRoutes,
        known,
        growthRoot(graph),
      );
      for (const [id, s] of result.pop) {
        pop.set(id, now + s * 1000);
        g.pop.set(id, now + s * 1000);
      }
      for (const [id, d] of result.draw)
        draw.set(id, { at: now + d.delay * 1000, reverse: d.reverse });
      // Tool rows pop in one by one once their toolbox card is there.
      freshRows.forEach((id, i) => {
        const card = toolbox.find((tb) => tb.items.includes(id));
        const base = card ? (g.pop.get(card.id) ?? now) : now;
        rows.set(id, Math.max(now, base + 500) + i * 120);
      });
    }
    const keep = <T,>(m: ReadonlyMap<string, T>, at: (v: T) => number) =>
      [...m].filter(([, v]) => at(v) > now - 3000);
    setPlan((cur) => ({
      known: new Set([...cur.known, ...nodeIds]),
      knownRoutes: new Set([...cur.knownRoutes, ...layout.routes.map((r) => r.id)]),
      pop: new Map([...keep(cur.pop, (v) => v), ...pop]),
      draw: new Map([...keep(cur.draw, (v) => v.at), ...draw]),
      rows: new Map([...keep(cur.rows, (v) => v), ...rows]),
    }));
  }, [layout, toolbox, ready, reduced, graph]);

  const clusterOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of layout.clusters) for (const m of c.members) map.set(m, c.id);
    for (const s of layout.stacks) for (const m of s.members) map.set(m, s.clusterId);
    return map;
  }, [layout]);

  const focusId = selected ? ownerOf(selected) : hovered ? ownerOf(hovered) : null;
  const focus = useMemo<Focus>(() => {
    if (!focusId) return { id: null, related: new Set() };
    const tools = toolbox.find((g) => g.id === focusId || g.items.includes(focusId));
    if (tools) return { id: focusId, related: new Set([focusId, tools.id, ...tools.users]) };
    const stack = layout.stacks.find((s) => s.id === focusId);
    if (stack) return { id: focusId, related: new Set([focusId, stack.clusterId]) };
    const { from, to } = neighbors(graph, focusId);
    return {
      id: focusId,
      related: new Set([focusId, ...from.map((n) => n.id), ...to.map((n) => n.id)]),
    };
  }, [graph, layout, focusId, toolbox]);

  const onOpen = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);
  const onHover = useCallback((id: string | null) => setHovered(id), []);
  const counts = useMemo(() => mapCounts(graph), [graph]);
  const laneCount = useMemo(() => {
    const total = (kind: BrainNode["kind"]) => graph.nodes.filter((n) => n.kind === kind).length;
    return {
      source: `${counts.sources} of ${total("source")} read`,
      agent: `${counts.agents} with recorded work`,
      output: `${counts.outputs} of ${total("output")} ready`,
      toolbox: toolbox.length
        ? `${toolbox.reduce((sum, g) => sum + g.items.length, 0)} outside tools used`
        : "No outside tools used yet",
    };
  }, [graph, counts, toolbox]);

  useEffect(() => {
    const view: View = { lit, hovered, selected, onOpen, onHover };
    const now = Date.now();
    const growing = (id: string): Growing => {
      const at = plan.pop.get(id);
      return {
        pending: !reduced && !plan.known.has(id),
        grow: at === undefined ? undefined : Math.max(0, (at - now) / 1000),
      };
    };
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
            ...growing(node.id),
            leaving: leaving.has(node.id),
            dimmed: focus.id !== null && !focus.related.has(node.id),
            running: box.depth === 0 && isAgent(node) ? running(node.id) : 0,
            above: box.y + box.h / 2 > layout.bounds.y + layout.bounds.h * 0.55,
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
        ...growing(stack.id),
        titles: stack.members.map((m) => graph.nodes.find((n) => n.id === m)?.title ?? m),
        dimmed: focus.id !== null && !focus.related.has(stack.id),
        onToggle,
        ...view,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: hovered === stack.id ? 20 : 2,
      style: { pointerEvents: "all" },
    }));
    const lanes: MapNode[] = layout.lanes.map((lane) => ({
      id: `lane:${lane.id}`,
      type: "lane",
      position: { x: lane.x, y: lane.y },
      data: { type: "lane", lane, label: LANE_LABEL[lane.id], count: laneCount[lane.id] },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
    }));
    const tools: MapNode[] = toolbox.flatMap((group) => {
      const box = layout.boxes.get(group.id);
      if (!box) return [];
      return [
        {
          id: group.id,
          type: "toolbox",
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          data: {
            type: "toolbox",
            group,
            box,
            items: group.items.flatMap((id) => fullGraph.nodes.find((n) => n.id === id) ?? []),
            dimmed: focus.id !== null && !focus.related.has(group.id),
            rows: new Map(
              group.items.flatMap((id) => {
                const at = plan.rows.get(id);
                return at === undefined ? [] : [[id, Math.max(0, (at - now) / 1000)] as const];
              }),
            ),
            ...growing(group.id),
            ...view,
          },
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: 1,
          style: { pointerEvents: "all" },
        } satisfies MapNode,
      ];
    });
    const next = [...lanes, ...cards, ...stacks, ...tools];
    setNodes((current) => {
      const known = new Map(current.map((n) => [n.id, n]));
      return next.map((n) => {
        const previous = known.get(n.id);
        return previous ? ({ ...previous, ...n, measured: previous.measured } as MapNode) : n;
      });
    });
  }, [
    graph,
    fullGraph,
    toolbox,
    layout,
    plan,
    reduced,
    leaving,
    focus,
    lit,
    hovered,
    selected,
    onOpen,
    onHover,
    onToggle,
    laneCount,
    setNodes,
    clusterOf,
  ]);

  const edges = useMemo<MapEdge[]>(() => {
    const now = Date.now();
    return layout.routes.map((route): MapEdge => {
      const mine = pulses.filter((p) => p.edgeId === route.id);
      const touches = focus.id !== null && (route.source === focus.id || route.target === focus.id);
      const draw = plan.draw.get(route.id);
      return {
        id: route.id,
        source: route.source,
        target: route.target,
        type: "route",
        data: {
          route,
          pulses: mine,
          active: touches,
          busy: mine.length > 0,
          dimmed: focus.id !== null && !touches,
          pending: !reduced && !plan.knownRoutes.has(route.id),
          ...(draw && {
            draw: { delay: Math.max(0, (draw.at - now) / 1000), reverse: draw.reverse },
          }),
        },
        focusable: false,
        selectable: false,
      };
    });
  }, [layout, pulses, focus, plan, reduced]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const detailNode = selected ? fullGraph.nodes.find((n) => n.id === ownerOf(selected)) : undefined;
  const detailChip = selected?.includes("|")
    ? layout.chips.get(ownerOf(selected))?.find((c) => c.id === selected)
    : undefined;

  // Desktop panel focus: move to the panel heading on open, back to what opened it on close.
  // On phones the Sheet (a dialog) traps and restores focus itself.
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusState = useRef<PanelFocusState<HTMLElement>>({ returnTo: null, openId: null });
  useEffect(() => {
    if (narrow) return;
    const active = document.activeElement;
    focusState.current = panelFocus(focusState.current, selected, {
      active: active instanceof HTMLElement ? active : null,
      inPanel: (el) => Boolean(panel.current?.contains(el)),
      focusHeading: () => heading.current?.focus({ preventScroll: true }),
      opener: (id) => document.querySelector<HTMLElement>(`[data-open-id="${CSS.escape(id)}"]`),
    });
  }, [selected, narrow]);

  const agents = graph.nodes.filter(isAgent);
  const working = agents.filter(isWorking);
  const coordinator = [...agents]
    .map((a) => ({
      a,
      kids: working.filter((w) => w.kind === "subagent" && clusterOf.get(w.id) === a.id),
    }))
    .sort((x, y) => y.kids.length - x.kids.length)[0];
  const latest = operations?.length
    ? operations.reduce((a, b) => (byTime(a, b) <= 0 ? b : a))
    : undefined;
  const latestWork = latest
    ? statusLine(latest.summary, timeAgo(latest.at, now))
    : "Work appears here as soon as it is recorded.";
  // The raw summary keeps run ids and status codes; it sits behind the info button.
  const latestRaw =
    latest && plainStatus(latest.summary) !== latest.summary ? latest.summary : null;
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
      : counts.working
        ? `${plural(counts.working, "agent")} working now`
        : counts.agents && counts.outputs
          ? `${plural(counts.agents, "agent")} turned ${plural(counts.sources, "data source")} into ${plural(counts.outputs, "output")}`
          : counts.agents
            ? `${plural(counts.agents, "agent")} read ${plural(counts.sources, "data source")}; no outputs yet`
            : "No agent has recorded work yet";
  // Activity counts come from the loaded events only; say so.
  const loaded = data.operations?.length ?? 0;
  const scope =
    data.source === "live" ? `in the latest ${plural(loaded, "event")}` : "in this demo session";
  const flags = data.findings;
  const openFlags = flags?.filter((f) => f.status === "open").length ?? 0;
  const versions = data.status?.counts.snapshots ?? 0;
  const visibleAgents = agents.filter((n) => layout.boxes.has(n.id));
  const kindsShown = [...new Set((visibleAgents.length ? visibleAgents : agents).map(kindOf))];
  const vendorsShown = [
    ...new Set(graph.nodes.flatMap((n) => (n.kind === "source" && n.vendor ? [n.vendor] : []))),
  ];
  const apifyTools = graph.nodes.filter((n) => n.kind === "tool" && n.tool?.category === "apify");
  const apifyUsed = apifyTools.length > 0;
  const apifyDemo = apifyUsed && apifyTools.every((n) => n.tool?.demoActor);
  const messageLines = layout.routes.some((r) => r.kind === "message");
  const showList = narrow && !mobileMap;

  const detailTool =
    detailNode?.kind === "source" && !detailChip ? toolOfVendor(detailNode.vendor) : undefined;
  const detail =
    detailNode && detailTool ? (
      <SourceDetailPanel
        node={detailNode}
        graph={graph}
        onClose={() => setSelected(null)}
        onSelect={setSelected}
        headingRef={heading}
        inSheet={narrow}
      />
    ) : detailNode ? (
      <DetailPanel
        node={detailNode}
        chip={detailChip}
        chips={layout.chips.get(detailNode.id) ?? []}
        graph={graph}
        onClose={() => setSelected(null)}
        onSelect={setSelected}
        headingRef={heading}
        inSheet={narrow}
      />
    ) : null;

  return (
    <div className="space-y-5">
      {embedded ? null : (
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
            // Activity messages wrap differently; fixed heights keep the canvas in place.
            <span className="flex h-12 items-start gap-1.5 sm:h-6">
              <span className="line-clamp-2 sm:line-clamp-1" title={latestRaw ?? latestWork}>
                {latestWork}
              </span>
              {latestRaw ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Show run details"
                      className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground before:absolute before:-inset-3 before:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info aria-hidden="true" className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="break-all">{latestRaw}</TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatGroup
          stats={[
            [counts.working, "working now"],
            [counts.completedHelpers, "completed helpers"],
            [counts.messages, "messages between agents"],
          ]}
          scope={scope}
        />
        <StatGroup
          stats={[
            [versions, versions === 1 ? "books version saved" : "books versions saved"],
            ...(flags
              ? ([
                  [
                    flags.length,
                    `${flags.length === 1 ? "flag" : "flags"} for review, ${openFlags} open`,
                  ],
                ] as const)
              : []),
          ]}
          scope="all time"
        />
      </div>
      {embedded ? null : <MapActions />}
      {narrow ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{showList ? "Agents" : "Agent map"}</p>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() => setMobileMap((v) => !v)}
          >
            {showList ? (
              <Network aria-hidden="true" className="size-4" />
            ) : (
              <List aria-hidden="true" className="size-4" />
            )}
            {showList ? "Open map" : "Show list"}
          </Button>
        </div>
      ) : null}
      {showList ? (
        <AgentList
          graph={graph}
          clusterOf={clusterOf}
          loading={data.source === "loading"}
          onOpen={setSelected}
        />
      ) : (
        <div
          className={cn(
            "relative flex overflow-hidden rounded-lg border bg-card shadow-xs",
            // Cards glide when the web re-settles. A media query, so server and client agree.
            "motion-safe:[&_.react-flow__node]:transition-transform motion-safe:[&_.react-flow__node]:duration-500",
          )}
          style={{ height: "max(420px, min(calc(100dvh - 240px), 760px))" }}
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
              onMove={(event) => {
                // Only a person's drag, pinch or double-click carries an event.
                if (event) camera.current?.("user-move");
              }}
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
              <Camera
                bounds={layout.bounds}
                ready={data.source !== "loading" && operations !== undefined}
                narrow={narrow}
                layout={layout}
                api={camera}
              />
              <Controls
                showInteractive={false}
                showFitView={false}
                position="bottom-left"
                onZoomIn={() => camera.current?.("user-move")}
                onZoomOut={() => camera.current?.("user-move")}
                className="overflow-hidden rounded-lg border shadow-xs [&_.react-flow__controls-button]:size-8 [&_.react-flow__controls-button]:border-border"
              >
                <ControlButton
                  onClick={() => camera.current?.("fit")}
                  aria-label="Fit the whole map"
                  title="Fit the whole map"
                >
                  <Maximize aria-hidden="true" />
                </ControlButton>
              </Controls>
            </ReactFlow>
            {data.source === "loading" ? (
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                Loading the agent map...
              </p>
            ) : null}
          </div>
          {detail && !narrow ? (
            // Docks beside the map; the view stays where it is (the fit button refits).
            <div ref={panel} className="w-[360px] shrink-0 border-l bg-card">
              {detail}
            </div>
          ) : null}
        </div>
      )}
      {narrow ? (
        <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-sm">
            {detail}
          </SheetContent>
        </Sheet>
      ) : null}
      {showList ? null : (
        <Legend
          kinds={kindsShown}
          vendors={vendorsShown}
          apify={apifyUsed}
          apifyDemo={apifyDemo}
          messages={messageLines}
          motion={!reduced}
        />
      )}
    </div>
  );
}

const LEGEND_ORDER: AgentKind[] = ["domino", "claude", "creao", "system", "simulator", "person"];

/** Only what the map shows right now. */
function Legend({
  kinds,
  vendors,
  apify,
  apifyDemo,
  messages,
  motion: moving,
}: {
  kinds: AgentKind[];
  vendors: VendorId[];
  apify: boolean;
  apifyDemo: boolean;
  messages: boolean;
  motion: boolean;
}) {
  const group = "flex flex-wrap items-center gap-x-4 gap-y-2";
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <div className={group}>
        <span className="w-32 font-medium text-foreground">Who runs each agent</span>
        {LEGEND_ORDER.filter((k) => kinds.includes(k)).map((kind) => (
          <span key={kind} className={item}>
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
        {apify && !vendors.includes("apify") ? (
          <span className={item}>
            <ToolLogo vendor="apify" size={18} />
            {apifyDemo ? "Apify (demo actors)" : "Apify"}
          </span>
        ) : null}
      </div>
      <div className={group}>
        <span className="w-32 font-medium text-foreground">Lines</span>
        <span className={item}>
          <svg width="28" height="8" aria-hidden="true">
            <path d="M1 4h26" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1.5" />
          </svg>
          Data in, work handed off, results out
        </span>
        {messages ? (
          <span className={item}>
            <svg width="28" height="8" aria-hidden="true">
              <path
                d="M1 4h26"
                stroke="hsl(var(--foreground) / 0.4)"
                strokeWidth="1.5"
                strokeDasharray="3 4"
              />
            </svg>
            Messages between agents
          </span>
        ) : null}
        {moving ? (
          <span className={item}>
            <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--primary-ink))]" />
            A dot runs along a line when a new step is recorded
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Phones: the agents as a plain list, the default below 640px. Each row names the agent, its
 * status, what it is doing, the tools it used and the sources it read. Completed helpers and
 * agents not used yet fold under one line each.
 */
function AgentList({
  graph,
  clusterOf,
  loading,
  onOpen,
}: {
  graph: BrainGraph;
  clusterOf: ReadonlyMap<string, string>;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const now = useNow();
  if (loading) return <p className="text-sm text-muted-foreground">Loading the agents...</p>;
  const agents = graph.nodes.filter(isAgent);
  const idle = new Set(idleAgents(graph));
  const roots = agents.filter((n) => n.kind === "agent" && !idle.has(n.id));
  const helpersOf = (id: string) =>
    agents.filter((n) => n.kind === "subagent" && (clusterOf.get(n.id) ?? n.parentId) === id);
  const unused = agents.filter((n) => idle.has(n.id));
  const completed = (n: BrainNode) =>
    n.lifecycle ? n.lifecycle === "done" : stateOf(n) === "succeeded";
  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs">
        {roots.map((root) => {
          const helpers = helpersOf(root.id);
          const done = helpers.filter(completed);
          const active = helpers.filter((n) => !completed(n));
          return (
            <li key={root.id}>
              <AgentRow node={root} graph={graph} now={now} onOpen={onOpen} />
              {active.length ? (
                <ul aria-label={`Helpers ${root.title} started`} className="border-t bg-background">
                  {active.map((n) => (
                    <li key={n.id} className="pl-6">
                      <AgentRow node={n} graph={graph} now={now} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {done.length ? (
                <details className="group border-t bg-background">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-90"
                    />
                    {done.length} completed {done.length === 1 ? "helper" : "helpers"}
                  </summary>
                  <ul className="border-t">
                    {done.map((n) => (
                      <li key={n.id} className="pl-6">
                        <AgentRow node={n} graph={graph} now={now} onOpen={onOpen} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
      {unused.length ? (
        <details className="group rounded-lg border bg-card shadow-xs">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-90"
            />
            {unused.length} {unused.length === 1 ? "agent" : "agents"} not used yet
          </summary>
          <ul className="divide-y border-t">
            {unused.map((n) => (
              <li key={n.id}>
                <AgentRow node={n} graph={graph} now={now} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function AgentRow({
  node,
  graph,
  now,
  onOpen,
}: {
  node: BrainNode;
  graph: BrainGraph;
  now: number;
  onOpen: (id: string) => void;
}) {
  const chips = toolChips(node);
  const sources = neighbors(graph, node.id).from.filter((n) => n.kind === "source");
  const task = node.currentTask ?? (hasWork(node) ? lastLine(node, now) : node.brief);
  return (
    <button
      type="button"
      onClick={() => onOpen(node.id)}
      aria-label={openLabel(node)}
      className={cn(
        "flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted",
        FOCUS,
      )}
    >
      <NodeIcon node={node} size={28} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-medium">{node.title}</span>
          <StatusText node={node} className="text-[13px]" />
        </span>
        <span className="block text-[13px] leading-5 text-muted-foreground">{task}</span>
        {chips.length ? (
          <span className="block text-xs text-muted-foreground">
            Tools: {chips.map((c) => `${TOOL_CATEGORY_LABEL[c.category]} (${c.calls})`).join(", ")}
          </span>
        ) : null}
        {sources.length ? (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Reads
            {sources.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1">
                <ToolLogo vendor={s.vendor ?? "generic"} size={16} />
                {s.title}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
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
      {label ?? AGENT_STATUS[status]}
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
  if (!operations.length)
    return <p className="text-muted-foreground">Nothing in the loaded events.</p>;
  return (
    <ol className="space-y-3">
      {operations.map((op) => {
        const tool = op.tool ? describeTool(op.tool, op.toolCategory, op.toolLabel) : undefined;
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

type PanelPlace = {
  /** Receives focus when the desktop panel opens. */
  headingRef?: RefObject<HTMLHeadingElement | null>;
  /** Inside the phone Sheet: the Sheet supplies the title role and the close button. */
  inSheet?: boolean;
};

function PanelShell({
  title,
  icon,
  eyebrow,
  pill,
  onClose,
  children,
  headingRef,
  inSheet,
}: {
  title: string;
  icon: ReactNode;
  eyebrow: string;
  pill?: ReactNode;
  onClose: () => void;
  children: ReactNode;
} & PanelPlace) {
  const titleClass = "break-words text-base font-semibold leading-6 focus:outline-none";
  return (
    <section
      aria-label={`${title} details`}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground"
    >
      <div className={cn("flex items-start gap-3 p-4", inSheet && "pr-12")}>
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{eyebrow}</p>
          {inSheet ? (
            <SheetTitle className={titleClass}>{title}</SheetTitle>
          ) : (
            <h2 ref={headingRef} tabIndex={-1} className={titleClass}>
              {title}
            </h2>
          )}
          {pill ? <div className="mt-1.5">{pill}</div> : null}
        </div>
        {inSheet ? null : (
          <Button
            variant="ghost"
            aria-label="Close details"
            onClick={onClose}
            className="-mr-2 -mt-2 size-9 p-0"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function DetailPanel({
  node,
  chip,
  chips,
  graph,
  onClose,
  onSelect,
  headingRef,
  inSheet,
}: {
  node: BrainNode;
  chip?: ToolChip;
  chips: ToolChip[];
  graph: BrainGraph;
  onClose: () => void;
  onSelect: (id: string) => void;
} & PanelPlace) {
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
      headingRef={headingRef}
      inSheet={inSheet}
    >
      {chip ? null : (
        <p className="px-4 pb-3 text-sm leading-6 text-muted-foreground">{node.brief}</p>
      )}

      {!chip && node.saved ? (
        <Section title="Saved so far">
          <p>{node.saved}</p>
        </Section>
      ) : null}

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

      {!chip && nodeResults(node).length ? (
        <Section title="See results">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {nodeResults(node).map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className={cn(
                    "rounded text-[13px] font-medium text-primary underline-offset-4 hover:underline",
                    FOCUS,
                  )}
                >
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

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

/** A connector's source card: brand header, what it read and the records it provides. */
function SourceDetailPanel({
  node,
  graph,
  onClose,
  onSelect,
  headingRef,
  inSheet,
}: {
  node: BrainNode;
  graph: BrainGraph;
  onClose: () => void;
  onSelect: (id: string) => void;
} & PanelPlace) {
  const now = useNow(1000);
  const state = useSourceDetail(toolOfVendor(node.vendor), node.lastAt);
  const { to } = neighbors(graph, node.id);
  return (
    <SourcePanel
      detail={state.state === "ready" ? state.detail : undefined}
      note={state.state === "missing" ? state.reason : undefined}
      demo={state.state === "ready" && state.demo}
      vendor={node.vendor ?? "generic"}
      title={node.title}
      subtitle={node.subtitle}
      now={now}
      onClose={onClose}
      headingRef={headingRef}
      inSheet={inSheet}
    >
      <Section title="Reads in the loaded events">
        <ActivityList operations={[...node.operations].reverse().slice(0, 8)} now={now} showAgent />
      </Section>
      <Section title="Read by">
        {to.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {to.map((n) => (
              <li key={n.id}>
                <NodeChip node={n} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No agent has read it in the loaded events.</p>
        )}
      </Section>
    </SourcePanel>
  );
}

/** Small count chips with one muted scope label, e.g. "in the latest 40 events". */
function StatGroup({
  stats,
  scope,
}: {
  stats: readonly (readonly [number, string])[];
  scope: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {stats.map(([n, label]) => (
        <span
          key={label}
          className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 shadow-xs"
        >
          <strong className="font-semibold tabular-nums text-foreground">{n}</strong>
          <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
      <span className="px-0.5 text-muted-foreground">{scope}</span>
    </div>
  );
}
