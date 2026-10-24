"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
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
import {
  type FlowNode,
  IDLE_DOMINO,
  KIND_LABEL,
  STATUS_LABEL,
  safeHref,
  toFlowNodes,
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
import { Bot, ChartLine, ExternalLink, FileText, Wrench, X } from "lucide-react";
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

// Shared by the initial fit and the Fit View button so a lone node never jumps to maxZoom.
const loneFit = { padding: 0.8, maxZoom: 1 };
const graphFit = { padding: 0.2, maxZoom: 1 };

const DEFAULT_NODES = [IDLE_DOMINO];
const NO_EDGES: CanvasEdge[] = [];

const CONNECTION_LABEL: Record<CanvasConnection, string> = {
  preview: "Preview · not connected yet",
  live: "Connected",
  loading: "Loading",
  offline: "Offline",
  unavailable: "Unavailable right now",
};

const KIND_ICON: Record<Exclude<CanvasNodeKind, "domino">, typeof Bot> = {
  agent: Bot,
  source: FileText,
  tool: Wrench,
  output: ChartLine,
};

const STATUS_DOT: Record<CanvasStatus, string> = {
  idle: "bg-muted-foreground/60",
  queued: "bg-muted-foreground/60",
  running: "bg-primary",
  succeeded: "bg-foreground/80",
  failed: "bg-destructive",
};

function statusText(node: CanvasNode) {
  const status = STATUS_LABEL[node.status];
  return node.kind === "domino" ? status : `${KIND_LABEL[node.kind]} · ${status}`;
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
  const Icon = node.kind === "domino" ? null : KIND_ICON[node.kind];
  const line =
    node.summary ??
    (node.kind === "domino" && node.status === "idle" ? "Waiting for a question" : null);
  return (
    <div
      className={cn(
        "flex w-60 items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-card-foreground shadow-sm transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/40",
      )}
    >
      {Icon ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <Image src="/domino-logo.svg" width={36} height={36} alt="" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{node.title}</p>
        {/* Keyed by status so a real status change replays this fade once; restored nodes mount still. */}
        <motion.p
          key={node.status}
          initial={animateStatus ? { opacity: 0, y: 2 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", STATUS_DOT[node.status])}
          />
          {statusText(node)}
        </motion.p>
        {line ? <p className="mt-1 truncate text-xs text-muted-foreground">{line}</p> : null}
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
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <NodeCard node={data.node} selected={selected} animateStatus={mounted.current && !reduced} />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
    </motion.div>
  );
}

const nodeTypes = { canvas: CanvasNodeView };

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
  return "Nothing has run yet.";
}

export function NodeDetails({
  node = IDLE_DOMINO,
  onClose,
  connection = "preview",
  output,
}: {
  node?: CanvasNode;
  onClose: () => void;
  connection?: CanvasConnection;
  output?: ReactNode;
}) {
  const { profile, evidence = [], metadata = [] } = node;
  const hasContent =
    !!node.summary ||
    !!node.outputText ||
    !!node.error ||
    evidence.length > 0 ||
    !!profile ||
    !!output;
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

      {evidence.length > 0 ? (
        <Section title="Evidence">
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
}: InvestigateWorkspaceProps) {
  const incoming = supplied?.length ? supplied : DEFAULT_NODES;
  // The first snapshot is restored history: it appears without motion.
  const [initial] = useState(() => toFlowNodes([], incoming, edges, true));
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const userMoved = useRef(false);
  const lastConnection = useRef(connection);
  const reduced = useReducedMotion();
  const fitOptions = nodes.length > 1 ? graphFit : loneFit;

  useEffect(() => {
    // Records delivered while loading, or right as loading ends, are history too.
    const quiet = connection === "loading" || lastConnection.current === "loading";
    lastConnection.current = connection;
    setNodes((current) => {
      const next = toFlowNodes(current, incoming, edges, quiet);
      const added = next.some((node) => !current.some((known) => known.id === node.id));
      // Follow new work until the person moves the view themselves. fitView waits for measurement.
      if (added && !userMoved.current) {
        queueMicrotask(() =>
          flowRef.current?.fitView({
            ...(next.length > 1 ? graphFit : loneFit),
            duration: reduced ? 0 : 300,
          }),
        );
      }
      return next;
    });
  }, [incoming, edges, connection, setNodes, reduced]);

  const flowEdges = useMemo<Edge[]>(() => {
    const ids = new Set(nodes.map((node) => node.id));
    return edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        focusable: false,
        selectable: false,
      }));
  }, [nodes, edges]);

  const selected = nodes.find((node) => node.selected)?.data.node;
  const output = selected && renderOutput ? renderOutput(selected) : null;

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
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
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
              minZoom={0.3}
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
