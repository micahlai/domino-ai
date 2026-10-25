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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, RefreshCw, X } from "lucide-react";
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
import { ToolIcon } from "../icons/ToolIcon";
import { ToolLogo } from "../icons/ToolLogo";
import { STATUS_LABEL } from "../investigate/graph";
import type { CanvasStatus } from "../investigate/types";
import { Button } from "../ui/button";
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
  freshOperations,
  isAgent,
  neighbors,
  pulsesFor,
} from "./graph";
import { type Box, type Lane, type MapLayout, type Route, layoutMap } from "./map-layout";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  OPERATION_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import { describeTool } from "./tool-names";
import type { Anomaly, FieldOperation } from "./types";

// The agent map: data sources -> agents (with the tools each one used as chips) -> outputs, all
// derived from the operation log. A dot travels a link only when a new operation is recorded on
// it, the agent that did the work glows briefly, and a node fades in only the first time it
// appears after the page loaded. History renders still.

type Focus = { id: string | null; related: ReadonlySet<string> };
type CardData = {
  type: "card";
  node: BrainNode;
  box: Box;
  chips: ToolChip[];
  enter: boolean;
  lit: ReadonlyMap<string, number>;
  hovered: string | null;
  selected: string | null;
  dimmed: boolean;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
};
type LaneData = { type: "lane"; lane: Lane; count: number; height: number };
type MapNode = Node<CardData, "card"> | Node<LaneData, "lane">;
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

const agentKindOf = (node: BrainNode): AgentKind => node.agentKind ?? "domino";
const kindLabel = (node: BrainNode) =>
  node.kind === "subagent"
    ? "Helper agent"
    : isAgent(node)
      ? AGENT_KIND_LABEL[agentKindOf(node)]
      : node.kind === "source"
        ? (node.subtitle ?? "Data source")
        : KIND_LABEL[node.kind];

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

function NodeIcon({ node, size }: { node: BrainNode; size: number }) {
  if (isAgent(node)) return <AgentIcon kind={agentKindOf(node)} size={size} />;
  if (node.kind === "source") return <ToolLogo vendor={node.vendor ?? "generic"} size={size} />;
  const category =
    node.kind === "tool" ? (node.tool?.category ?? "other") : (node.category ?? "other");
  return <ToolIcon category={category} tile size={size} />;
}

/** One-line state under a card title: when it last did something, or that it has not yet. */
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

function CardNode({ data }: NodeProps<Node<CardData, "card">>) {
  const reduced = useReducedMotion();
  const now = useNow();
  const { node, box, chips, enter, lit, hovered, selected, dimmed, onOpen, onHover } = data;
  const glowing = lit.has(node.id);
  const style: CSSProperties = {
    width: box.w,
    height: box.h,
    transitionDelay: glowing ? `${lit.get(node.id) ?? 0}s` : undefined,
  };
  const hoverChip = chips.find((c) => c.id === hovered);
  const showHover = (hovered === node.id || hoverChip) && selected !== (hoverChip?.id ?? node.id);
  const agent = isAgent(node);
  return (
    <motion.div
      initial={enter && !reduced ? { opacity: 0, y: 8, scale: 0.98 } : false}
      animate={{ opacity: dimmed ? 0.45 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <Handles />
      <div
        className={cn(CARD, glowing && GLOW, selected === node.id && SELECTED, "overflow-hidden")}
        style={style}
      >
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          aria-label={`${node.title}, ${kindLabel(node).toLowerCase()}, ${STATUS_LABEL[node.status].toLowerCase()}. Open details.`}
          className={cn(
            "nodrag nopan flex w-full items-center gap-3 rounded-[inherit] px-3 text-left",
            FOCUS,
            agent ? "h-[60px]" : "h-full",
          )}
        >
          <NodeIcon node={node} size={agent ? 32 : 30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-5">{node.title}</span>
            <span className="flex items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground">
              <StatusDot status={node.status} />
              {agent ? kindLabel(node) : node.kind === "source" ? node.subtitle : null}
              {agent || node.kind === "source" ? <span aria-hidden="true">·</span> : null}
              <span className="truncate">{lastLine(node, now)}</span>
            </span>
          </span>
        </button>
        {agent && chips.length ? (
          <ul aria-label={`Tools ${node.title} used`} className="border-t px-2 py-2">
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  onClick={() => onOpen(chip.id)}
                  onMouseEnter={() => onHover(chip.id)}
                  onMouseLeave={() => onHover(node.id)}
                  aria-label={`${chip.label}, ${chip.calls} ${chip.calls === 1 ? "call" : "calls"}. Open details.`}
                  className={cn(
                    "nodrag nopan flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] transition-colors duration-300 hover:bg-muted",
                    FOCUS,
                    lit.has(chip.id) && "bg-[hsl(var(--primary-ink)/0.1)]",
                    selected === chip.id && "bg-muted",
                  )}
                  style={lit.has(chip.id) ? { transitionDelay: `${lit.get(chip.id)}s` } : undefined}
                >
                  <ToolIcon
                    category={chip.category}
                    className={cn(
                      "text-muted-foreground",
                      chip.status === "failed" && "text-[hsl(var(--danger-text))]",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{chip.label}</span>
                  {chip.tools.length > 1 ? (
                    <span className="rounded border px-1 text-[11px] leading-4 text-muted-foreground">
                      {chip.tools.length} tools
                    </span>
                  ) : null}
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {chip.calls} {chip.calls === 1 ? "call" : "calls"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {showHover ? <HoverCard node={node} chip={hoverChip} now={now} /> : null}
    </motion.div>
  );
}

function HoverCard({ node, chip, now }: { node: BrainNode; chip?: ToolChip; now: number }) {
  const raw = chip ? [...new Set(chip.operations.flatMap((op) => op.tool ?? []))] : [];
  const count = chip ? chip.calls : node.operations.length;
  const last = chip ? chip.lastAt : node.lastAt;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-3 top-full z-20 mt-2 w-64 rounded-xl border bg-popover p-3 text-left text-popover-foreground shadow-[0_12px_32px_-12px_hsl(var(--foreground)/0.25)]"
    >
      <p className="text-xs text-muted-foreground">
        {chip ? `Tool · ${node.title}` : kindLabel(node)}
      </p>
      <p className="text-sm font-medium">{chip ? chip.label : node.title}</p>
      {chip ? (
        <p className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground">
          {raw.join(", ")}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{node.brief}</p>
      )}
      <p className="mt-2 text-xs">
        {count
          ? `${count} recorded ${count === 1 ? "call" : "calls"}, most recent ${timeAgo(last, now)}`
          : "No recorded work yet"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">Click for details</p>
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData, "lane">>) {
  const { lane, count, height } = data;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none rounded-2xl border border-dashed border-border/70 bg-muted/30"
      style={{ width: lane.w + 24, height: height + 8 }}
    >
      <p className="flex h-10 items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
        {lane.title}
        <span className="rounded-full bg-background px-1.5 text-[11px] tabular-nums">{count}</span>
      </p>
    </div>
  );
}

function RouteEdge({ id, data }: EdgeProps<MapEdge>) {
  const reduced = useReducedMotion();
  if (!data) return null;
  const { route, pulses, active, dimmed } = data;
  const end = route.points.at(-1);
  const stroke = active ? "hsl(var(--primary-ink))" : "hsl(var(--foreground) / 0.22)";
  return (
    <g
      className="transition-opacity duration-300"
      style={{ opacity: dimmed ? 0.18 : 1 }}
      data-route={id}
    >
      <path
        d={route.path}
        fill="none"
        stroke={stroke}
        strokeWidth={active ? 1.75 : 1.25}
        strokeLinejoin="round"
        style={{ transition: "stroke 300ms, stroke-width 300ms" }}
      />
      {end ? (
        <circle
          cx={end.x}
          cy={end.y}
          r={2.75}
          fill="hsl(var(--card))"
          stroke={stroke}
          strokeWidth={1.25}
        />
      ) : null}
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
        const at = line.getPointAtLength(t * length);
        g.setAttribute("transform", `translate(${at.x} ${at.y})`);
        g.setAttribute("opacity", t <= 0 ? "0" : t > 0.85 ? String((1 - t) / 0.15) : "1");
      },
    });
    return () => controls.stop();
  }, [pulse.delay]);
  return (
    <g className="pointer-events-none">
      <path ref={track} d={path} fill="none" stroke="none" />
      <g ref={dot} opacity={0} data-pulse={pulse.key}>
        <circle r={8} fill="hsl(var(--primary-ink) / 0.16)" />
        <circle r={3.5} fill="hsl(var(--primary-ink))" />
      </g>
    </g>
  );
}

const nodeTypes = { card: CardNode, lane: LaneNode };
const edgeTypes = { route: RouteEdge };

/** Re-fit when the map grows (a helper or a new tool appears), not on every render. */
function FitOnGrow({ width, height }: { width: number; height: number }) {
  const { fitView } = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void width;
    void height;
    const id = requestAnimationFrame(() => fitView({ padding: 0.06, maxZoom: 1, duration: 300 }));
    return () => cancelAnimationFrame(id);
  }, [width, height, fitView]);
  return null;
}

function toFlowNodes(
  graph: BrainGraph,
  layout: MapLayout,
  view: Omit<CardData, "type" | "node" | "box" | "chips" | "enter" | "dimmed"> & {
    appeared: ReadonlySet<string>;
    focus: Focus;
  },
): MapNode[] {
  const { appeared, focus, ...rest } = view;
  const count = (lane: Lane["id"]) =>
    graph.nodes.filter((n) =>
      lane === "agent" ? isAgent(n) : lane === "source" ? n.kind === "source" : n.kind === "output",
    ).length;
  const lanes: MapNode[] = layout.lanes.map((lane) => ({
    id: `lane:${lane.id}`,
    type: "lane",
    position: { x: lane.x - 12, y: 0 },
    data: { type: "lane", lane, count: count(lane.id), height: layout.height },
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
  }));
  const cards: MapNode[] = graph.nodes.flatMap((node) => {
    const box = layout.boxes.get(node.id);
    if (!box) return [];
    const raised = rest.hovered === node.id || rest.hovered?.startsWith(`${node.id}|`);
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
          dimmed: focus.id !== null && !focus.related.has(node.id),
          ...rest,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: raised ? 20 : 1,
        // Not selectable or draggable, so React Flow would drop pointer events; cards handle their own.
        style: { pointerEvents: "all" },
      } satisfies MapNode,
    ];
  });
  return [...lanes, ...cards];
}

/** The node a detail id belongs to: a chip id is "<agent id>|<group>". */
const ownerOf = (id: string) => id.split("|")[0] ?? id;

export function BrainMap() {
  const data = useFieldData();
  const now = useNow();
  const reduced = useReducedMotion();
  const graph = useMemo(() => buildBrainGraph(data.operations ?? []), [data.operations]);
  const layout = useMemo(() => layoutMap(graph), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [lit, setLit] = useState<ReadonlyMap<string, number>>(new Map());
  // Ids already shown. The first real delivery is history: remembered, never animated.
  const seenOps = useRef<Set<string> | null>(null);
  const seenNodes = useRef<Set<string> | null>(null);
  const [appeared, setAppeared] = useState<ReadonlySet<string>>(new Set());
  const pulseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!data.operations) return;
    const quiet = seenOps.current === null;
    const { seen, fresh } = freshOperations(seenOps.current ?? new Set(), data.operations, quiet);
    seenOps.current = seen;
    const ids = graph.nodes.map((n) => n.id);
    const newNodes = quiet ? [] : ids.filter((id) => !seenNodes.current?.has(id));
    seenNodes.current = new Set(ids);
    if (newNodes.length) setAppeared((now) => new Set([...now, ...newNodes]));
    if (!fresh.length) return;
    const next = reduced ? [] : pulsesFor(fresh, graph);
    const active = activityFor(fresh);
    setPulses(next);
    setLit(active);
    const last = Math.max(0, ...next.map((p) => p.delay + PULSE_SECONDS), ...active.values());
    clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(
      () => {
        setPulses([]);
        setLit(new Map());
      },
      last * 1000 + 1400,
    );
  }, [data.operations, graph, reduced]);
  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  const focusId = selected ? ownerOf(selected) : hovered ? ownerOf(hovered) : null;
  const focus = useMemo<Focus>(() => {
    if (!focusId) return { id: null, related: new Set() };
    const { from, to } = neighbors(graph, focusId);
    return {
      id: focusId,
      related: new Set([focusId, ...from.map((n) => n.id), ...to.map((n) => n.id)]),
    };
  }, [graph, focusId]);

  const onOpen = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);
  const onHover = useCallback((id: string | null) => setHovered(id), []);

  useEffect(() => {
    const next = toFlowNodes(graph, layout, {
      appeared,
      focus,
      lit,
      hovered,
      selected,
      onOpen,
      onHover,
    });
    setNodes((current) => {
      const known = new Map(current.map((n) => [n.id, n]));
      return next.map((n) => {
        const previous = known.get(n.id);
        return previous ? ({ ...previous, ...n, measured: previous.measured } as MapNode) : n;
      });
    });
  }, [graph, layout, appeared, focus, lit, hovered, selected, onOpen, onHover, setNodes]);

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

  const detailNode = selected ? graph.nodes.find((n) => n.id === ownerOf(selected)) : undefined;
  const detailChip = selected?.includes("|")
    ? layout.chips.get(ownerOf(selected))?.find((c) => c.id === selected)
    : undefined;

  const worked = (n: BrainNode) => n.operations.length > 0;
  const counts = {
    agents: graph.nodes.filter((n) => isAgent(n) && worked(n)).length,
    sources: graph.nodes.filter((n) => n.kind === "source" && worked(n)).length,
    outputs: graph.nodes.filter((n) => n.kind === "output" && worked(n)).length,
  };
  const latest = data.operations?.length
    ? data.operations.reduce((a, b) => (byTime(a, b) <= 0 ? b : a))
    : undefined;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const kindsShown = [...new Set(graph.nodes.filter(isAgent).map(agentKindOf))];

  return (
    <div className="space-y-4">
      <header className="max-w-3xl space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Brain map</span>
          <DataLabel />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {counts.agents
            ? `${plural(counts.agents, "agent")} turned ${plural(counts.sources, "data source")} into ${plural(counts.outputs, "output")}`
            : "No agent has recorded work yet"}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {latest
            ? `Last recorded work ${timeAgo(latest.at, now)}: ${latest.summary.replace(/[.\s]*$/, ".")}`
            : "Work appears here as soon as it is recorded."}{" "}
          A moving dot means work was just recorded on that link.
        </p>
      </header>
      <MapActions />
      <div
        className="relative min-h-[520px] overflow-hidden rounded-2xl border bg-card"
        // As tall as the lanes need (so there is no empty band), never taller than the screen.
        style={{ height: `min(calc(100dvh - 260px), ${layout.height + 56}px)` }}
      >
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
          fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
          minZoom={0.3}
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
        {detailNode ? (
          <div className="absolute bottom-3 right-3 top-3 z-10 w-[min(23rem,calc(100%-1.5rem))]">
            <DetailPanel
              node={detailNode}
              chip={detailChip}
              chips={layout.chips.get(detailNode.id) ?? []}
              graph={graph}
              now={now}
              onClose={() => setSelected(null)}
              onSelect={setSelected}
            />
          </div>
        ) : null}
      </div>
      <Legend kinds={kindsShown} />
    </div>
  );
}

const LEGEND_ORDER: AgentKind[] = ["domino", "claude", "creao", "system", "simulator", "person"];

function Legend({ kinds }: { kinds: AgentKind[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Who runs each agent</span>
      {LEGEND_ORDER.map((kind) => (
        <span
          key={kind}
          className={cn("inline-flex items-center gap-1.5", !kinds.includes(kind) && "opacity-60")}
        >
          <AgentIcon kind={kind} size={18} />
          {AGENT_KIND_LABEL[kind]}
        </span>
      ))}
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
        <Download aria-hidden="true" className="mr-1.5 size-3.5" />
        New entries arrive
      </Button>
      <AnomalyPicker value={anomaly} onChange={setAnomaly} disabled={off} />
      <Button size="sm" variant="outline" disabled={off} onClick={() => run(actions.ingestNow)}>
        <RefreshCw aria-hidden="true" className="mr-1.5 size-3.5" />
        Ingest now
      </Button>
      <AutoIngestToggle />
      {error ? (
        <span className="text-xs text-[hsl(var(--danger-text))]">{error}</span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Hover a card for a summary; click it or a tool for details.
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

function StatusPill({ status }: { status: CanvasStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
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
        const tool = op.tool ? describeTool(op.tool) : undefined;
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

function DetailPanel({
  node,
  chip,
  chips,
  graph,
  now,
  onClose,
  onSelect,
}: {
  node: BrainNode;
  chip?: ToolChip;
  chips: ToolChip[];
  graph: BrainGraph;
  now: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const ops = chip ? chip.operations : node.operations;
  const recent = [...ops].reverse().slice(0, 8);
  const reasoning = [...ops].reverse().find((op) => op.reasoning)?.reasoning;
  const io = [...ops].reverse().find((op) => op.inputs || op.outputs);
  const { from, to } = neighbors(graph, node.id);
  const linked = chip ? [node] : [...from, ...to];
  const tools = chip ? chip.tools.flatMap((id) => graph.nodes.find((n) => n.id === id) ?? []) : [];
  const title = chip ? chip.label : node.title;
  return (
    <section
      aria-label={`${title} details`}
      className="flex max-h-full flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-[0_16px_40px_-16px_hsl(var(--foreground)/0.3)]"
    >
      <div className="flex items-start gap-3 p-4">
        {chip ? (
          <ToolIcon category={chip.category} tile size={36} />
        ) : (
          <NodeIcon node={node} size={36} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {chip ? `Tool used by ${node.title}` : kindLabel(node)}
          </p>
          <h2 className="break-words text-base font-semibold leading-6">{title}</h2>
          <div className="mt-1.5">
            <StatusPill status={chip ? chip.status : node.status} />
          </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chip ? null : (
          <p className="px-4 pb-3 text-sm leading-6 text-muted-foreground">{node.brief}</p>
        )}

        {chip ? (
          <Section title={tools.length === 1 ? "Tool id" : `${tools.length} tools`}>
            <ul className="space-y-1.5">
              {tools.map((t) => {
                const calls = chip.operations.filter(
                  (op) => `tool:${op.tool?.trim().toLowerCase()}` === t.id,
                ).length;
                return (
                  <li key={t.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate">{t.title}</span>
                      <code className="block break-all text-[11px] text-muted-foreground">
                        {t.tool?.raw}
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

        {!chip && node.instructions ? (
          <Section title="Built-in instructions">
            <p>{node.instructions}</p>
          </Section>
        ) : null}

        {!chip && chips.length ? (
          <Section title="Tools">
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
              : chip || isAgent(node)
                ? "Recent tool calls"
                : "Recent work"
          }
        >
          <ActivityList operations={recent} now={now} showAgent={!isAgent(node)} />
        </Section>

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
                  <button
                    type="button"
                    onClick={() => onSelect(n.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border bg-background py-1 pl-1 pr-2 text-xs hover:bg-muted",
                      FOCUS,
                    )}
                  >
                    <NodeIcon node={n} size={18} />
                    {n.title}
                  </button>
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
      </div>
    </section>
  );
}
