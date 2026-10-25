"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  getBezierPath,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, RefreshCw, X } from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { NodeCard } from "../investigate/InvestigateWorkspace";
import { CIRCLE_ROW, STATUS_LABEL } from "../investigate/graph";
import type { CanvasNode } from "../investigate/types";
import { Button } from "../ui/button";
import { useFieldData } from "./data";
import {
  type BrainGraph,
  type BrainNode,
  PULSE_SECONDS,
  type Pulse,
  buildBrainGraph,
  byTime,
  freshOperations,
  layoutBrain,
  neighbors,
  pulsesFor,
} from "./graph";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  OPERATION_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import type { Anomaly, FieldOperation } from "./types";

// The agent map: built-in agents, the helpers they start, tools and data sources, all derived
// from the operation log. A dot moves only when a new operation is recorded; a node pops in
// only the first time it appears after the page loaded. History renders still.

type MapData = { node: BrainNode; enter: boolean; hovered: boolean };
type MapNode = Node<MapData, "brain">;
type MapEdgeData = { pulses: Pulse[]; active: boolean };
type MapEdge = Edge<MapEdgeData, "brain">;

const flowStyle = {
  "--xy-background-color": "hsl(var(--background))",
  "--xy-controls-button-background-color": "hsl(var(--card))",
  "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
  "--xy-controls-button-color": "hsl(var(--foreground))",
  "--xy-controls-button-color-hover": "hsl(var(--foreground))",
  "--xy-controls-button-border-color": "hsl(var(--border))",
  "--xy-controls-box-shadow": "none",
  "--xy-edge-stroke": "hsl(var(--muted-foreground) / 0.45)",
} as CSSProperties;

const SUBTITLE: Record<BrainNode["kind"], string> = {
  agent: "Agent",
  subagent: "Helper agent",
  tool: "Tool",
  source: "Data source",
};

function toCanvas(node: BrainNode): CanvasNode {
  return {
    id: node.id,
    kind: node.kind === "subagent" ? "agent" : node.kind,
    title: node.title,
    status: node.status,
  };
}

// Every handle sits on the shape's centre (edges draw under nodes, so lines meet the icon); the
// side only sets the curve's direction. Agent-to-agent links in one column run top to bottom.
const CENTER = { top: CIRCLE_ROW / 2, left: "50%" };
const HANDLES = [
  { id: "l", type: "target", position: Position.Left },
  { id: "t", type: "target", position: Position.Top },
  { id: "r", type: "source", position: Position.Right },
  { id: "b", type: "source", position: Position.Bottom },
] as const;
const AGENTISH = new Set(["agent"]);

function BrainNodeView({ data, selected }: NodeProps<MapNode>) {
  const reduced = useReducedMotion();
  const now = useNow();
  const { node, enter, hovered } = data;
  return (
    <motion.div
      initial={enter && !reduced ? { opacity: 0, scale: 0.5 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="relative"
    >
      {enter && !reduced ? (
        // One ring on first appearance: this agent or tool was just started.
        <span className="pointer-events-none absolute left-1/2 top-[36px] -translate-x-1/2 -translate-y-1/2">
          <motion.span
            aria-hidden="true"
            className="block size-16 rounded-full border-2 border-primary"
            initial={{ opacity: 0.8, scale: 0.6 }}
            animate={{ opacity: 0, scale: 1.9 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </span>
      ) : null}
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.type}
          position={h.position}
          isConnectable={false}
          style={CENTER}
          className="!pointer-events-none !opacity-0"
        />
      ))}
      <NodeCard node={toCanvas(node)} selected={selected} />
      {hovered && !selected ? (
        <div
          role="tooltip"
          className="absolute left-1/2 top-full z-10 mt-2 w-60 -translate-x-1/2 rounded-lg border bg-popover p-3 text-left text-popover-foreground shadow-lg"
        >
          <p className="text-xs text-muted-foreground">{SUBTITLE[node.kind]}</p>
          <p className="text-sm font-medium">{node.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{node.brief}</p>
          <p className="mt-2 text-xs">
            {node.operations.length
              ? `${node.operations.length} recorded ${node.operations.length === 1 ? "operation" : "operations"}, most recent ${timeAgo(node.lastAt, now)}`
              : "No recorded work yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Click for details</p>
        </div>
      ) : null}
    </motion.div>
  );
}

function BrainEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<MapEdge>) {
  const reduced = useReducedMotion();
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={
          data?.active
            ? { stroke: "hsl(var(--primary) / 0.7)", transition: "stroke 300ms" }
            : { transition: "stroke 600ms" }
        }
      />
      {reduced
        ? null
        : data?.pulses.map((pulse) => <PulseDot key={pulse.key} pulse={pulse} path={path} />)}
    </>
  );
}

/** One dot along the link's curve, once. Positions come from the drawn path, not from data. */
function PulseDot({ pulse, path }: { pulse: Pulse; path: string }) {
  const dot = useRef<SVGCircleElement>(null);
  const track = useRef<SVGPathElement>(null);
  useEffect(() => {
    const circle = dot.current;
    const line = track.current;
    if (!circle || !line) return;
    const length = line.getTotalLength();
    const controls = animate(0, 1, {
      duration: PULSE_SECONDS,
      delay: pulse.delay,
      ease: "easeInOut",
      onUpdate: (t) => {
        const at = line.getPointAtLength(t * length);
        circle.setAttribute("cx", String(at.x));
        circle.setAttribute("cy", String(at.y));
        circle.setAttribute("opacity", t <= 0 ? "0" : t > 0.9 ? String((1 - t) * 10) : "1");
      },
    });
    return () => controls.stop();
  }, [pulse.delay]);
  return (
    <g className="pointer-events-none">
      <path ref={track} d={path} fill="none" stroke="none" />
      <circle ref={dot} data-pulse={pulse.key} r={4.5} opacity={0} className="fill-primary" />
    </g>
  );
}

const nodeTypes = { brain: BrainNodeView };
const edgeTypes = { brain: BrainEdgeView };

function toFlow(
  graph: BrainGraph,
  current: MapNode[],
  appeared: ReadonlySet<string>,
  hovered: string | null,
): MapNode[] {
  const known = new Map(current.map((n) => [n.id, n]));
  const slots = layoutBrain(graph.nodes);
  return graph.nodes.map((node) => {
    const previous = known.get(node.id);
    const data = { node, enter: appeared.has(node.id), hovered: hovered === node.id };
    if (previous) return { ...previous, data, zIndex: hovered === node.id ? 10 : 0 };
    return {
      id: node.id,
      type: "brain",
      position: slots.get(node.id) ?? { x: 0, y: 0 },
      data,
      deletable: false,
      ariaLabel: `${node.title}, ${SUBTITLE[node.kind].toLowerCase()}, ${STATUS_LABEL[node.status].toLowerCase()}. Press Enter for details.`,
      className:
        "rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    };
  });
}

export function BrainMap() {
  const data = useFieldData();
  const now = useNow();
  const reduced = useReducedMotion();
  const graph = useMemo(() => buildBrainGraph(data.operations ?? []), [data.operations]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
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
    const next = pulsesFor(fresh, graph);
    if (next.length && !reduced) {
      setPulses(next);
      const last = Math.max(...next.map((p) => p.delay)) + PULSE_SECONDS;
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulses([]), last * 1000 + 400);
    }
  }, [data.operations, graph, reduced]);
  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  useEffect(() => {
    setNodes((current) => toFlow(graph, current, appeared, hovered));
  }, [graph, appeared, hovered, setNodes]);

  const edges = useMemo<MapEdge[]>(
    () =>
      graph.edges.map((edge) => {
        const mine = pulses.filter((p) => p.edgeId === edge.id);
        const kind = (id: string) => graph.nodes.find((n) => n.id === id)?.kind ?? "";
        const stacked = AGENTISH.has(kind(edge.source)) && AGENTISH.has(kind(edge.target));
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(stacked
            ? { sourceHandle: "b", targetHandle: "t" }
            : { sourceHandle: "r", targetHandle: "l" }),
          type: "brain",
          data: { pulses: mine, active: mine.length > 0 },
          focusable: false,
          selectable: false,
        };
      }),
    [graph, pulses],
  );

  const selectedId = nodes.find((n) => n.selected)?.id;
  const selected = graph.nodes.find((n) => n.id === selectedId);
  const select = (id: string | null) =>
    setNodes((current) => current.map((n) => ({ ...n, selected: n.id === id })));

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = {
    agents: graph.nodes.filter((n) => n.kind === "agent" || n.kind === "subagent").length,
    tools: graph.nodes.filter((n) => n.kind === "tool").length,
    sources: graph.nodes.filter((n) => n.kind === "source").length,
  };
  const latest = data.operations?.length
    ? data.operations.reduce((a, b) => (byTime(a, b) <= 0 ? b : a))
    : undefined;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Brain map</span>
            <DataLabel />
          </div>
          <h1 className="text-3xl font-medium tracking-tight">
            {counts.agents} agents, {counts.tools} tools and {counts.sources} data sources
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {latest
              ? `Last recorded work ${timeAgo(latest.at, now)}: ${latest.summary.replace(/[.\s]*$/, ".")}`
              : "No recorded work yet."}{" "}
            A moving dot means an operation was just recorded on that link.
          </p>
        </div>
      </header>
      <MapActions />
      <div className="relative h-[calc(100dvh-320px)] min-h-[520px] overflow-hidden rounded-xl border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeMouseEnter={(_, node) => setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
          onPaneClick={() => select(null)}
          colorMode="dark"
          style={flowStyle}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          nodesConnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.5}
            color="hsl(var(--border))"
          />
          <Controls
            showInteractive={false}
            position="bottom-left"
            className="overflow-hidden rounded-lg border [&_.react-flow__controls-button]:size-9 [&_.react-flow__controls-button]:border-border"
          />
        </ReactFlow>
        <ColumnLabels />
        {data.source === "loading" ? (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Loading the agent map...
          </p>
        ) : null}
        {selected ? (
          <div className="absolute bottom-3 right-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))]">
            <DetailPanel
              node={selected}
              graph={graph}
              now={now}
              onClose={() => select(null)}
              onSelect={select}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ColumnLabels() {
  return (
    <p className="pointer-events-none absolute left-3 top-3 flex gap-3 text-xs text-muted-foreground">
      <span>Sources</span>
      <span aria-hidden="true">→</span>
      <span>Agents and helpers</span>
      <span aria-hidden="true">→</span>
      <span>Tools</span>
    </p>
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
          Hover a node for a summary; click it for details.
        </span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-2 text-sm leading-6">{children}</div>
    </div>
  );
}

function Values({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
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

function DetailPanel({
  node,
  graph,
  now,
  onClose,
  onSelect,
}: {
  node: BrainNode;
  graph: BrainGraph;
  now: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const recent = [...node.operations].reverse().slice(0, 8);
  const reasoning = [...node.operations].reverse().find((op) => op.reasoning)?.reasoning;
  const io = [...node.operations].reverse().find((op) => op.inputs || op.outputs);
  const { from, to } = neighbors(graph, node.id);
  const linked = [...from, ...to];
  return (
    <section
      aria-label={`${node.title} details`}
      className="max-h-full overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {SUBTITLE[node.kind]} · {STATUS_LABEL[node.status]}
          </p>
          <h2 className="break-words text-base font-medium">{node.title}</h2>
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
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{node.brief}</p>

      {node.instructions ? (
        <Section title="Built-in instructions">
          <p>{node.instructions}</p>
        </Section>
      ) : null}

      <Section title={node.kind === "source" ? "Recent reads" : "Recent tool calls"}>
        {recent.length ? (
          <ol className="space-y-2">
            {recent.map((op: FieldOperation) => (
              <li key={op.id}>
                <p className="text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "font-medium",
                      op.status === "failed" ? "text-[hsl(var(--danger-text))]" : "text-foreground",
                    )}
                  >
                    {op.tool ?? OPERATION_LABEL[op.kind]}
                  </span>
                  {" · "}
                  {op.agent}
                  {" · "}
                  <time dateTime={op.at} title={clock(op.at)}>
                    {timeAgo(op.at, now)}
                  </time>
                </p>
                <p className="leading-5">{op.summary}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        )}
      </Section>

      {reasoning ? (
        <Section title="Reasoning summary">
          <p>{reasoning}</p>
        </Section>
      ) : null}

      <Section title="Connected">
        {linked.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {linked.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelect(n.id)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {n.title}
                  <span className="text-muted-foreground"> · {SUBTITLE[n.kind].toLowerCase()}</span>
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
    </section>
  );
}
