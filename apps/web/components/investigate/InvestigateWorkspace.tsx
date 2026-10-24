"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type NodeProps,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ConversationPanel } from "./ConversationPanel";
import "@xyflow/react/dist/style.css";
import { X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef } from "react";

type DominoData = { status: "idle" };
type DominoNode = Node<DominoData, "domino">;

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
} as CSSProperties;

// Shared by the initial fit and the Fit View button so the lone node never jumps to maxZoom.
const fitOptions = { padding: 0.8, maxZoom: 1 };

export function DominoNodeCard({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        "flex w-60 items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-card-foreground shadow-sm transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/40",
      )}
    >
      <Image src="/domino-logo.svg" width={36} height={36} alt="" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Domino</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/60" />
          Idle
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Waiting for a question</p>
      </div>
    </div>
  );
}

function DominoNodeView({ selected }: NodeProps<DominoNode>) {
  return <DominoNodeCard selected={selected} />;
}

const nodeTypes = { domino: DominoNodeView };

const initialNodes: DominoNode[] = [
  {
    id: "domino",
    type: "domino",
    position: { x: 0, y: 0 },
    data: { status: "idle" },
    deletable: false,
    ariaLabel: "Domino, idle. Press Enter for details.",
    className:
      "rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  },
];

export function NodeDetails({ onClose }: { onClose: () => void }) {
  return (
    <section
      aria-label="Domino details"
      className="rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Domino</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Idle</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label="Close details"
          onClick={onClose}
          className="-mr-2 -mt-2 size-11"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-3 text-sm">Nothing has run yet.</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Investigations aren't connected in this preview, so there is no evidence or output to show.
      </p>
    </section>
  );
}

export function InvestigateWorkspace() {
  const [nodes, setNodes, onNodesChange] = useNodesState<DominoNode>(initialNodes);
  const open = nodes.some((node) => node.selected);
  const canvasRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    // The Close button unmounts, so hand focus back to the node instead of dropping it to <body>.
    canvasRef.current?.querySelector<HTMLElement>('.react-flow__node[data-id="domino"]')?.focus();
  }, [setNodes]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

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
              edges={[]}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              colorMode="dark"
              style={flowStyle}
              fitView
              fitViewOptions={fitOptions}
              minZoom={0.3}
              maxZoom={2}
              nodesConnectable={false}
              deleteKeyCode={null}
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
          <p className="text-xs text-muted-foreground">Preview · not connected yet</p>
        </div>
        {/* Below the canvas on mobile so it never hides the node or zoom controls; floats top-right on desktop. */}
        {open ? (
          <div className="border-t p-3 lg:absolute lg:right-4 lg:top-4 lg:z-10 lg:w-80 lg:border-t-0 lg:p-0">
            <NodeDetails onClose={close} />
          </div>
        ) : null}
      </section>
      <div className="flex shrink-0 flex-col border-t lg:min-h-0 lg:w-[400px] lg:border-l lg:border-t-0">
        <ConversationPanel />
      </div>
    </div>
  );
}
