import type { ReactNode } from "react";

// Presentation boundary (kb/coordination/historical/canvas-ui-packet.md). Not a persistence schema:
// the backend owner adapts durable records into these shapes.

export type CanvasNodeKind = "domino" | "agent" | "source" | "tool" | "output" | "knowledge";
export type CanvasStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
export type CanvasConnection = "live" | "loading" | "offline" | "unavailable" | "preview";

export type CanvasEvidence = {
  id: string;
  title: string;
  url?: string;
  publishedAt?: string;
  excerpt?: string;
};

export type CanvasProfile = {
  role: string;
  workingStyle: string;
  instructions: string;
  version: string;
  tools: string[];
  provider?: string;
  model?: string;
  knowledgeCutoff?: string;
};

export type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  status: CanvasStatus;
  summary?: string;
  outputText?: string;
  error?: string;
  evidence?: CanvasEvidence[];
  profile?: CanvasProfile;
  metadata?: { label: string; value: string }[];
};

export type CanvasEdge = { id: string; source: string; target: string };

export type CanvasMessage = { id: string; role: "user" | "assistant" | "system"; text: string };

export type InvestigateWorkspaceProps = {
  sessionId?: string;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
  messages?: CanvasMessage[];
  connection?: CanvasConnection;
  pending?: boolean;
  error?: string;
  onSend?: (text: string) => void;
  onReveal?: () => void;
  onAlternative?: () => void;
  canReveal?: boolean;
  canAlternative?: boolean;
  renderOutput?: (node: CanvasNode) => ReactNode;
  /** Optional detail for the Company knowledge node (G8). Rendered from saved evidence only. */
  renderKnowledge?: () => ReactNode;
};
