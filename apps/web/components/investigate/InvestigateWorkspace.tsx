"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ConversationPanel } from "./ConversationPanel";
import { FlowEdge, type FlowEdgeType, PULSE_SECONDS, ZoneView } from "./MapParts";
import {
  CIRCLE_ROW,
  type FlowNode,
  IDLE_DOMINO,
  KIND_LABEL,
  KNOWLEDGE_ID,
  type Pulse,
  STATUS_LABEL,
  deliver,
  graphFit,
  isHistory,
  loneFit,
  pulsesFor,
  safeHref,
  toFlowNodes,
  withKnowledge,
  zones,
} from "./graph";
import type {
  CanvasConnection,
  CanvasEdge,
  CanvasNode,
  CanvasNodeKind,
  CanvasStatus,
  InvestigateWorkspaceProps,
} from "./types";
import "@xyflow/react/dist/style.css";
import { Bot, ChartLine, Database, ExternalLink, FileText, Wrench, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Point React Flow's own colors at the app tokens so it follows the pinned dark palette.
const flowStyle = {
  "--xy-background-color": "hsl(var(--background))",
  "--xy-controls-button-background-color": "hsl(var(--card))",
  "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
  "--xy-controls-button-color": "hsl(var(--foreground))",
  "--xy-controls-button-color-hover": "hsl(var(--foreground))",
  "--xy-controls-button-border-color": "hsl(var(--border))",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "hsl(var(--card) / 0.8)",
  "--xy-edge-stroke": "hsl(var(--muted-foreground) / 0.5)",
} as CSSProperties;

const DEFAULT_NODES = [IDLE_DOMINO];
const NO_EDGES: CanvasEdge[] = [];

const CONNECTION_LABEL: Record<CanvasConnection, string> = {
  preview: "Preview · not connected yet",
  live: "Connected",
  loading: "Loading",
  offline: "Offline",
  unavailable: "Unavailable right now",
};

// One shape and tint per kind so the map scans at a glance: rounded agent tiles, portrait document
// cards for sources, small tool tiles, a wide result card and a rounded data stack for knowledge.
const KIND_LOOK: Record<
  Exclude<CanvasNodeKind, "domino">,
  { Icon: typeof Bot; shape: string; border: string; fill: string; icon: string }
> = {
  agent: {
    Icon: Bot,
    shape: "size-14 rounded-2xl",
    border: "border-violet-400/50",
    fill: "bg-violet-400/10",
    icon: "text-violet-300",
  },
  source: {
    Icon: FileText,
    shape: "h-16 w-12 rounded-md",
    border: "border-sky-400/50",
    fill: "bg-sky-400/10",
    icon: "text-sky-300",
  },
  tool: {
    Icon: Wrench,
    shape: "size-11 rounded-lg",
    border: "border-amber-400/50",
    fill: "bg-amber-400/10",
    icon: "text-amber-300",
  },
  output: {
    Icon: ChartLine,
    shape: "h-14 w-28 rounded-xl",
    border: "border-foreground/30",
    fill: "bg-foreground/5",
    icon: "text-foreground",
  },
  knowledge: {
    Icon: Database,
    shape: "size-16 rounded-[50%/24%]",
    border: "border-teal-400/50",
    fill: "bg-teal-400/10",
    icon: "text-teal-300",
  },
};

const STATUS_DOT: Record<CanvasStatus, string> = {
  idle: "bg-muted-foreground/60",
  queued: "bg-muted-foreground/60",
  running: "bg-primary",
  succeeded: "bg-foreground/80",
  failed: "bg-destructive",
};

function statusText(node: CanvasNode) {
  // Knowledge is a view of saved records, not a step, so it has no run status.
  if (node.kind === "knowledge") return `Saved evidence · ${node.evidence?.length ?? 0}`;
  const status = STATUS_LABEL[node.status];
  return node.kind === "domino" ? status : `${KIND_LABEL[node.kind]} · ${status}`;
}

// Understated status: only a running or failed shape changes its outline; the label always says why.
function shapeBorder(node: CanvasNode, tint: string) {
  if (node.status === "running") return "border-primary";
  if (node.status === "failed") return "border-destructive/70";
  return tint;
}

export function NodeCard({
  node,
  selected,
  animateStatus = false,
}: {
  node: CanvasNode;
  selected: boolean;
  animateStatus?: boolean;
}) {
  const look = node.kind === "domino" ? null : KIND_LOOK[node.kind];
  const note = node.kind === "domino" && node.status === "idle" ? "Waiting for a question" : null;
  return (
    <div className="flex w-36 flex-col items-center gap-1.5 text-center">
      <div className="grid h-[72px] place-items-center">
        <span
          className={cn(
            "grid place-items-center border transition-colors",
            look
              ? [look.shape, look.fill, shapeBorder(node, look.border)]
              : ["size-[72px] rounded-full bg-primary/10", shapeBorder(node, "border-primary/40")],
            selected
              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
              : "hover:border-muted-foreground/60",
          )}
        >
          {look ? (
            <look.Icon aria-hidden="true" className={cn("size-5", look.icon)} />
          ) : (
            <Image src="/domino-logo.svg" width={40} height={40} alt="" />
          )}
        </span>
      </div>
      <div className="w-full min-w-0 px-1">
        <p className="line-clamp-2 break-words text-xs font-medium leading-4">{node.title}</p>
        {/* Keyed by status so a real status change replays this fade once; restored nodes mount still. */}
        <motion.p
          key={node.status}
          initial={animateStatus ? { opacity: 0, y: 2 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-center justify-center gap-1.5 text-xs leading-4 text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              node.kind === "knowledge" ? "bg-teal-300" : STATUS_DOT[node.status],
            )}
          />
          {statusText(node)}
        </motion.p>
        {note ? <p className="text-xs leading-4 text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}

// Old name kept for G1 callers.
export function DominoNodeCard({ selected }: { selected: boolean }) {
  return <NodeCard node={IDLE_DOMINO} selected={selected} />;
}

function CanvasNodeView({ data, selected }: NodeProps<FlowNode>) {
  const reduced = useReducedMotion();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <motion.div
      initial={data.enter && !reduced ? { opacity: 0, scale: 0.96 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {/* Both handles sit on the circle's center; edges render under nodes, so lines end at the circle. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ top: CIRCLE_ROW / 2 }}
        className="!pointer-events-none !opacity-0"
      />
      <NodeCard
        node={data.node}
        selected={selected}
        animateStatus={mounted.current && data.live && !reduced}
      />
      <Handle
        type="source"
        position={Position.Top}
        isConnectable={false}
        style={{ top: CIRCLE_ROW / 2 }}
        className="!pointer-events-none !opacity-0"
      />
    </motion.div>
  );
}

const nodeTypes = { canvas: CanvasNodeView, zone: ZoneView };
const edgeTypes = { flow: FlowEdge };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-2 text-sm leading-6">{children}</div>
    </div>
  );
}

function emptyText(node: CanvasNode) {
  if (node.status === "queued") return "Waiting to start.";
  if (node.status === "running") return "Running now. Results appear here when it finishes.";
  if (node.status === "succeeded") return "Finished, but there is nothing to show for it.";
  if (node.status === "failed") return "Failed, and no reason was given.";
  return "Nothing has run yet.";
}

export function NodeDetails({
  node = IDLE_DOMINO,
  onClose,
  connection = "preview",
  output,
  knowledge,
}: {
  node?: CanvasNode;
  onClose: () => void;
  connection?: CanvasConnection;
  output?: ReactNode;
  knowledge?: ReactNode;
}) {
  const { profile, evidence = [], metadata = [] } = node;
  const hasContent =
    !!node.summary ||
    !!node.outputText ||
    !!node.error ||
    evidence.length > 0 ||
    !!profile ||
    !!output ||
    !!knowledge;
  return (
    <section
      aria-label={`${node.title} details`}
      className="max-h-full overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-sm font-medium">{node.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{statusText(node)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label="Close details"
          onClick={onClose}
          className="-mr-2 -mt-2 size-11 shrink-0"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {node.summary ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{node.summary}</p>
      ) : null}

      {!hasContent ? (
        <>
          <p className="mt-3 text-sm">{emptyText(node)}</p>
          {connection === "preview" ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Investigations aren't connected in this preview, so there is no evidence or output to
              show.
            </p>
          ) : null}
        </>
      ) : null}

      {node.error ? (
        <Section title="What went wrong">
          <p className="whitespace-pre-wrap text-destructive">{node.error}</p>
        </Section>
      ) : null}

      {node.outputText || output ? (
        <Section title="Result">
          {node.outputText ? <p className="whitespace-pre-wrap">{node.outputText}</p> : null}
          {output ? <div className="mt-3">{output}</div> : null}
        </Section>
      ) : null}

      {knowledge ? <Section title="Saved knowledge">{knowledge}</Section> : null}

      {evidence.length > 0 ? (
        <Section title={node.kind === "knowledge" ? "Saved sources" : "Evidence"}>
          <ul className="space-y-3">
            {evidence.map((item) => {
              const href = safeHref(item.url);
              return (
                <li key={item.id}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {item.title}
                      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <p className="font-medium">{item.title}</p>
                  )}
                  {item.publishedAt ? (
                    <p className="text-xs text-muted-foreground">Published {item.publishedAt}</p>
                  ) : null}
                  {item.excerpt ? (
                    <blockquote className="mt-1 whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
                      {item.excerpt}
                    </blockquote>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {node.kind === "knowledge" ? (
        <Section title="Learnings">
          <p className="text-muted-foreground">No validated learnings are recorded.</p>
        </Section>
      ) : null}

      {profile ? (
        <Section title="Instructions and working style">
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-muted-foreground">Role</dt>
              <dd>{profile.role}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Working style</dt>
              <dd className="whitespace-pre-wrap">{profile.workingStyle}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Instructions (version {profile.version})
              </dt>
              <dd className="whitespace-pre-wrap">{profile.instructions}</dd>
            </div>
            {profile.tools.length > 0 ? (
              <div>
                <dt className="text-xs text-muted-foreground">Can use</dt>
                <dd>{profile.tools.join(", ")}</dd>
              </div>
            ) : null}
            {profile.provider || profile.model ? (
              <div>
                <dt className="text-xs text-muted-foreground">Model</dt>
                <dd>{[profile.provider, profile.model].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
            {profile.knowledgeCutoff ? (
              <div>
                <dt className="text-xs text-muted-foreground">Knowledge cutoff</dt>
                <dd>{profile.knowledgeCutoff}</dd>
              </div>
            ) : null}
          </dl>
        </Section>
      ) : null}

      {metadata.length > 0 || hasContent ? (
        <details className="mt-4 border-t pt-2 text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center rounded text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            Technical details
          </summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-2">
            <dt className="text-muted-foreground">Node</dt>
            <dd className="break-all font-mono">{node.id}</dd>
            {metadata.map((entry) => (
              <div key={entry.label} className="contents">
                <dt className="text-muted-foreground">{entry.label}</dt>
                <dd className="break-all font-mono">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

export function InvestigateWorkspace(props: InvestigateWorkspaceProps) {
  // A new session starts clean: graph, selection, positions and draft all reset.
  return <Workspace key={props.sessionId ?? ""} {...props} />;
}

function Workspace({
  sessionId,
  nodes: supplied,
  edges = NO_EDGES,
  messages,
  connection = "preview",
  pending,
  error,
  onSend,
  onReveal,
  onAlternative,
  canReveal,
  canAlternative,
  renderOutput,
  renderKnowledge,
}: InvestigateWorkspaceProps) {
  // Omitted means the G1 preview Domino. An explicit [] is a real, empty investigation.
  // Company knowledge is a view of evidence the sources already carry, added after them.
  const incoming = useMemo(() => withKnowledge(supplied ?? DEFAULT_NODES), [supplied]);
  // The first snapshot is restored history: it appears without motion.
  const [initial] = useState(() => toFlowNodes([], incoming, true));
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdgeType> | null>(null);
  const userMoved = useRef(false);
  const lastConnection = useRef(connection);
  // Which node statuses were already shown, so a pulse fires once per new recorded transition.
  const seen = useRef<ReadonlySet<string>>(pulsesFor(new Set(), incoming, edges, true).seen);
  const pulseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const reduced = useReducedMotion();
  const fitOptions = nodes.length > 1 ? graphFit : loneFit;

  useEffect(() => {
    // Records delivered while loading or offline, or right as that ends, are history too.
    const quiet = isHistory(connection, lastConnection.current);
    lastConnection.current = connection;
    const next = pulsesFor(seen.current, incoming, edges, quiet);
    seen.current = next.seen;
    if (next.pulses.length > 0 && !reduced) {
      const fresh = next.pulses;
      setPulses((now) => [
        ...now.filter((p) => !fresh.some((f) => f.edgeId === p.edgeId)),
        ...fresh,
      ]);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulses([]), PULSE_SECONDS * 1000 + 300);
    }
    setNodes((current) => {
      // Follow new work until the person moves the view themselves. fitView waits for measurement.
      const { nodes: next, fit } = deliver(current, incoming, {
        quiet,
        follow: !userMoved.current,
        reduced: !!reduced,
      });
      if (fit) queueMicrotask(() => flowRef.current?.fitView(fit));
      return next;
    });
  }, [incoming, edges, connection, setNodes, reduced]);
  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  const flowEdges = useMemo<FlowEdgeType[]>(() => {
    const ids = new Set(nodes.map((node) => node.id));
    const pulse = new Map(pulses.map((p) => [p.edgeId, p.key]));
    const real = edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "flow" as const,
        data: { pulse: pulse.get(edge.id) },
        focusable: false,
        selectable: false,
      }));
    // A dashed link marks that knowledge is a view beside Domino. It is not an operation, so it never pulses.
    return ids.has(KNOWLEDGE_ID) && ids.has("domino")
      ? [
          ...real,
          {
            id: "view:domino->knowledge",
            source: "domino",
            target: KNOWLEDGE_ID,
            type: "flow" as const,
            data: {},
            style: { strokeDasharray: "3 5" },
            focusable: false,
            selectable: false,
          },
        ]
      : real;
  }, [nodes, edges, pulses]);
  const frames = useMemo(() => zones(nodes), [nodes]);

  const selected = nodes.find((node) => node.selected)?.data.node;
  const output = selected && renderOutput ? renderOutput(selected) : null;
  const knowledge = selected?.kind === "knowledge" ? renderKnowledge?.() : null;

  const close = useCallback(() => {
    const id = nodes.find((node) => node.selected)?.id;
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    // The Close button unmounts, so hand focus back to the node instead of dropping it to <body>.
    if (id) {
      canvasRef.current
        ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus();
    }
  }, [nodes, setNodes]);

  useEffect(() => {
    if (!selected) return;
    function onKey(event: KeyboardEvent) {
      // Escape while typing a message belongs to the message box, not the details panel.
      if (event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement)) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, close]);

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section
        aria-label="Canvas"
        className="relative flex flex-1 shrink-0 flex-col lg:min-h-0 lg:shrink"
      >
        <div ref={canvasRef} className="relative min-h-[45dvh] flex-1 lg:min-h-0">
          <div className="absolute inset-0">
            <ReactFlow
              // ponytail: frames are inert display nodes; one cast beats a second node type through every handler.
              nodes={[...(frames as unknown as FlowNode[]), ...nodes]}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              onMoveStart={(event) => {
                // Programmatic fits pass no event; only a person's pan or zoom stops auto-follow.
                if (event) userMoved.current = true;
              }}
              colorMode="dark"
              style={flowStyle}
              fitView
              fitViewOptions={fitOptions}
              minZoom={0.1}
              maxZoom={2}
              nodesConnectable={false}
              deleteKeyCode={null}
              multiSelectionKeyCode={null}
              selectionKeyCode={null}
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
                fitViewOptions={fitOptions}
                className="overflow-hidden rounded-lg border [&_.react-flow__controls-button]:size-11 [&_.react-flow__controls-button]:border-border"
              />
            </ReactFlow>
          </div>
          {nodes.length === 0 ? (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              {connection === "loading" ? "Loading the investigation." : "No steps to show yet."}
            </p>
          ) : null}
        </div>
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col items-start gap-1.5">
          <Link
            href="/"
            aria-label="Domino home"
            className="pointer-events-auto flex min-h-11 items-center gap-2.5 rounded font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Image src="/domino-logo.svg" width={28} height={28} alt="" priority />
            <span className="text-lg">
              domino<span className="text-primary">.</span>
            </span>
          </Link>
          <h1 className="text-sm font-medium">Investigate</h1>
          <p className="text-xs text-muted-foreground">{CONNECTION_LABEL[connection]}</p>
          {nodes.length > 1 ? (
            <p className="max-w-56 text-xs text-muted-foreground">
              A dot on a line marks newly recorded step activity, not data moved.
            </p>
          ) : null}
        </div>
        {/* Below the canvas on mobile so it never hides the node or zoom controls; floats right on desktop. */}
        {selected ? (
          <div
            className={cn(
              "border-t p-3 lg:pointer-events-none lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:z-10 lg:flex lg:flex-col lg:border-t-0 lg:p-0",
              // The parent's chart needs room to stay readable; plain details stay narrow.
              output ? "lg:w-[min(46rem,calc(100%-2rem))]" : "lg:w-80",
            )}
          >
            <div className="lg:pointer-events-auto lg:min-h-0">
              <NodeDetails
                node={selected}
                onClose={close}
                connection={connection}
                output={output}
                knowledge={knowledge}
              />
            </div>
          </div>
        ) : null}
      </section>
      <div className="flex shrink-0 flex-col border-t lg:min-h-0 lg:w-[400px] lg:border-l lg:border-t-0">
        <ConversationPanel
          sessionId={sessionId}
          messages={messages}
          connection={connection}
          pending={pending}
          error={error}
          onSend={onSend}
          onReveal={onReveal}
          onAlternative={onAlternative}
          canReveal={canReveal}
          canAlternative={canAlternative}
        />
      </div>
    </div>
  );
}
