import type { Change } from "@domino/contracts";
import { formatCents } from "../../../lib/format";
import type { AgentKind } from "../../icons/AgentIcon";
import type { ToolCategory } from "../../icons/ToolIcon";
import { formatExactCents, formatFullDate } from "../../timeline/baseline/format";
import { describeTool } from "../tool-names";

// Shared, presentational model for "How we got here". Builders for the Timeline and Field views
// fill it from saved records only: every amount is a saved engine output or receipt value, copied
// and formatted, never computed here. The only arithmetic in the view is bar geometry.

/** A saved amount, short for reading ("$78.3M") with the exact value kept for tooltips/details. */
export type Money = { cents: number; short: string; exact: string };

export function moneyOf(cents: number | null | undefined): Money | null {
  if (cents === null || cents === undefined || !Number.isSafeInteger(cents)) return null;
  return { cents, short: formatCents(cents), exact: formatExactCents(cents) };
}

/**
 * Two saved amounts that would read the same when shortened ("$3.2M" vs "$3.2M") are shown
 * exactly, so a comparison never looks like a tie or a contradiction.
 */
export function distinct(a: Money | null, b: Money | null): [Money | null, Money | null] {
  if (!a || !b || a.short !== b.short || a.cents === b.cents) return [a, b];
  return [
    { ...a, short: a.exact },
    { ...b, short: b.exact },
  ];
}

/** "1 change", "2 changes", "1 day". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Oct 25, 2026", or the raw text when it is not a date. */
export const fullDay = (iso: string | null | undefined) =>
  iso ? formatFullDate(iso.slice(0, 10)) : null;

export type Fact = { text: string; money?: Money | null };
export type Logo = { vendor: string; label: string };

export type Step = {
  headline: string;
  facts: Fact[];
  logos?: Logo[];
};

export type ResultTone = "above" | "below" | "unknown";

export type ExplainResult = {
  tone: ResultTone;
  /** "Stays above", "Falls below", "No minimum saved". */
  badge: string;
  low: Money | null;
  lowWeek: string | null;
  floor: Money | null;
  /** "minimum", "illustrative cash floor", or a saved rule label. */
  floorLabel: string;
  facts: Fact[];
  /** Saved rationale text, quoted as-is. */
  quote?: { text: string; by: string } | null;
};

/** A result whose lowest cash and line never read as the same short amount. */
export function readableResult(r: ExplainResult): ExplainResult {
  const [low, floor] = distinct(r.low, r.floor);
  return { ...r, low, floor };
}

export type MapIcon =
  | { type: "vendor"; vendor: string }
  | { type: "agent"; kind: AgentKind }
  | { type: "tool"; category: ToolCategory }
  | { type: "result"; tone: ResultTone };

export type MapNode = {
  id: string;
  /** Column, left to right: sources, agents by depth, then AI/engine, then result. */
  col: number;
  label: string;
  sub: string | null;
  icon: MapIcon;
  /** First-activity order, 1-based; null for inputs that were read before the run's steps. */
  order: number | null;
  failed?: boolean;
};
export type MapEdge = { from: string; to: string; order: number };
export type AgentMap = {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Column headings, indexed like MapNode.col. */
  columns: string[];
  note: string;
  agentWork: boolean;
  truncated: boolean;
};

export type Detail = { label: string; value: string };
export type DetailGroup = { title: string; rows: Detail[] };

export type Explain = {
  eyebrow: string;
  title: string;
  subtitle: string;
  data: Step;
  change: Step & { tone: "change" | "none" };
  calc: Step;
  result: ExplainResult;
  map: AgentMap;
  limits: string[];
  details: DetailGroup[];
};

// ---------- Plain wording for saved changes ----------

/** Snapshot records that name the thing a change touches. Missing records stay generic. */
export type RecordLookup = {
  invoice?: (id: string) => { customer: string | null; amount: number; due: string } | null;
  customer?: (id: string) => string | null;
  bill?: (id: string) => { vendor: string; amount: number; due: string } | null;
};

const days = (n: number) => plural(Math.abs(n), "day");

export type ChangeFact = Fact & { amountLabel: string };

/** "Customer cohort 18 pays 14 days late" plus the saved invoice amount when known. */
export function describeChange(change: Change, lookup: RecordLookup = {}): ChangeFact {
  const fact = describe(change, lookup);
  const amountLabel =
    change.kind === "delay_bill"
      ? "Bill amount"
      : change.kind === "shift_hire"
        ? "Monthly cost"
        : change.kind === "add_cash" || change.kind === "remove_cash"
          ? "Amount"
          : "Invoice amount";
  return { ...fact, amountLabel };
}

function describe(change: Change, lookup: RecordLookup): Fact {
  switch (change.kind) {
    case "delay_invoice":
    case "lose_invoice":
    case "discount_early_pay": {
      const inv = lookup.invoice?.(change.invoiceId) ?? null;
      const due = inv ? fullDay(inv.due) : null;
      const who = inv?.customer ?? (due ? `An invoice due ${due}` : "An invoice");
      const theirs = inv?.customer ? `${inv.customer}'s invoice` : who;
      const money = inv ? moneyOf(inv.amount) : null;
      if (change.kind === "delay_invoice")
        return {
          text: inv?.customer
            ? `${who} pays ${days(change.days)} late`
            : `${who} is paid ${days(change.days)} late`,
          money,
        };
      if (change.kind === "lose_invoice") return { text: `${theirs} is never paid`, money };
      return {
        text: `${theirs} is paid early on ${fullDay(change.payOn)} for a ${change.percent}% discount`,
        money,
      };
    }
    case "churn": {
      const name = lookup.customer?.(change.customerId) ?? "A customer";
      return { text: `${name} stops paying from ${fullDay(change.fromDate)}` };
    }
    case "delay_bill": {
      const bill = lookup.bill?.(change.billId) ?? null;
      const who = bill ? `The ${bill.vendor} bill` : "A bill";
      return {
        text: `${who} is paid ${days(change.days)} later`,
        money: bill ? moneyOf(bill.amount) : null,
      };
    }
    case "add_cash":
      return {
        text: `${change.label}: cash in on ${fullDay(change.date)}`,
        money: moneyOf(change.amount),
      };
    case "remove_cash":
      return {
        text: `${change.label}: cash out on ${fullDay(change.date)}`,
        money: moneyOf(change.amount),
      };
    case "shift_hire":
      return {
        text: `${change.label} moves from ${fullDay(change.fromDate)} to ${fullDay(change.toDate)}`,
        money: moneyOf(change.monthlyCost),
      };
  }
}

/** Saved labels can carry raw record ids; prefer the plain change text then. */
export function readableLabel(label: string, ids: string[], fallback: string): string {
  const trimmed = label.trim();
  if (!trimmed) return fallback;
  return ids.some((id) => id && trimmed.includes(id)) ? fallback : trimmed;
}

export const changeIds = (changes: Change[]) =>
  changes.map((c) =>
    "invoiceId" in c
      ? c.invoiceId
      : "billId" in c
        ? c.billId
        : "customerId" in c
          ? c.customerId
          : "",
  );

// ---------- Agent map snapshot ----------

/** The recorded fields the snapshot needs (FieldTrace operations satisfy this). */
export type RecordedOp = {
  id: string;
  at: string;
  agentId: string | null;
  agentKind: "domino" | "claude" | "creao" | "system" | null;
  parentAgentId: string | null;
  status: "spawned" | "working" | "done" | "failed" | null;
  tool: string | null;
  toolCategory: string | null;
  toolLabel: string | null;
  fromAgentId: string | null;
  toAgentId: string | null;
};

const ADVISOR: Record<string, string> = {
  credit_line_draw: "Credit line advisor",
  delay_bill: "Bill timing advisor",
  accelerate_collections: "Collections advisor",
  defer_hires: "Hiring advisor",
};

/** "forecaster#3" -> "Forecaster 3", "analyst#1" -> "Analyst", "advisor.delay_bill" -> label. */
export function agentTitle(id: string): string {
  const advisor = /^advisor\.(.+)$/.exec(id);
  if (advisor) return ADVISOR[advisor[1] ?? ""] ?? "Advisor";
  const [role = "", n] = id.split("#");
  const words = role.replace(/[_.-]+/g, " ").trim();
  const base = words ? words.charAt(0).toUpperCase() + words.slice(1) : "Agent";
  return n && n !== "1" ? `${base} ${n}` : base;
}

const providerOf = (tool: string | null): "claude" | "creao" | null => {
  const key = (tool ?? "").toLowerCase();
  return key.startsWith("claude.") ? "claude" : key.startsWith("creao.") ? "creao" : null;
};
const isEngineTool = (tool: string | null) => (tool ?? "").toLowerCase().startsWith("engine.");

const PROVIDER_LABEL = { claude: "Claude", creao: "CREAO" } as const;
const MAX_SOURCES = 5;

/**
 * Only the parts that actually did recorded work on this result: saved sources, agents that
 * logged a step, AI calls they logged, the engine when an engine tool ran, then the result.
 */
export function agentMapFromOps(input: {
  ops: RecordedOp[];
  sources: Logo[];
  resultLabel: string;
  resultTone: ResultTone;
  truncated?: boolean;
}): AgentMap {
  const ops = [...input.ops].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const agents = new Map<
    string,
    { kind: AgentKind; parent: string | null; order: number; tools: string[]; failed: boolean }
  >();
  const ai = new Map<
    string,
    { order: number; tools: string[]; failed: boolean; from: Set<string> }
  >();
  const edges: MapEdge[] = [];
  const edgeKeys = new Set<string>();
  let order = 0;
  let engineOrder: number | null = null;
  const engineFrom = new Set<string>();
  const engineTools: string[] = [];
  const addEdge = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (from === to || edgeKeys.has(key) || edgeKeys.has(`${to}>${from}`)) return;
    edgeKeys.add(key);
    edges.push({ from, to, order: edges.length + 1 });
  };
  const touch = (id: string, kind: AgentKind, parent: string | null) => {
    const found = agents.get(id);
    if (found) {
      if (!found.parent && parent && parent !== id && agents.has(parent)) found.parent = parent;
      return found;
    }
    const row = {
      kind,
      parent: parent && parent !== id && agents.has(parent) ? parent : null,
      order: ++order,
      tools: [],
      failed: false,
    };
    agents.set(id, row);
    return row;
  };
  for (const op of ops) {
    if (!op.agentId) continue;
    const kind: AgentKind = op.agentKind ?? "domino";
    const agent = touch(op.agentId, kind, op.parentAgentId);
    if (op.status === "failed") agent.failed = true;
    if (op.parentAgentId && agents.has(op.parentAgentId))
      addEdge(`agent:${op.parentAgentId}`, `agent:${op.agentId}`);
    if (op.fromAgentId && op.toAgentId) {
      touch(op.fromAgentId, "domino", null);
      touch(op.toAgentId, "domino", op.fromAgentId);
      addEdge(`agent:${op.fromAgentId}`, `agent:${op.toAgentId}`);
    }
    if (!op.tool) continue;
    const label = describeTool(
      op.tool,
      op.toolCategory ?? undefined,
      op.toolLabel ?? undefined,
    ).label;
    const provider = providerOf(op.tool);
    if (provider) {
      const row = ai.get(provider) ?? { order: ++order, tools: [], failed: false, from: new Set() };
      if (!row.tools.includes(label)) row.tools.push(label);
      if (op.status === "failed") row.failed = true;
      row.from.add(op.agentId);
      ai.set(provider, row);
      continue;
    }
    if (isEngineTool(op.tool)) {
      engineOrder ??= ++order;
      engineFrom.add(op.agentId);
      if (!engineTools.includes(label)) engineTools.push(label);
    }
    if (!agent.tools.includes(label)) agent.tools.push(label);
  }

  const depth = (id: string, seen = new Set<string>()): number => {
    const parent = agents.get(id)?.parent;
    if (!parent || seen.has(id)) return 0;
    seen.add(id);
    return 1 + depth(parent, seen);
  };
  const nodes: MapNode[] = [];
  const shown = input.sources.slice(0, MAX_SOURCES);
  const hidden = input.sources.length - shown.length;
  for (const s of shown)
    nodes.push({
      id: `source:${s.vendor}`,
      col: 0,
      label: s.label,
      sub: null,
      icon: { type: "vendor", vendor: s.vendor },
      order: null,
    });
  if (hidden > 0)
    nodes.push({
      id: "source:more",
      col: 0,
      label: `+${hidden} more`,
      sub: plural(hidden, "source"),
      icon: { type: "tool", category: "read" },
      order: null,
    });
  const hasSources = nodes.length > 0;
  const agentCol = (id: string) => (hasSources ? 1 : 0) + depth(id);
  let maxAgentCol = hasSources ? 0 : -1;
  for (const [id, a] of agents) {
    const col = agentCol(id);
    maxAgentCol = Math.max(maxAgentCol, col);
    const tools = a.tools.length
      ? a.tools.slice(0, 2).join(", ") + (a.tools.length > 2 ? ` +${a.tools.length - 2}` : "")
      : null;
    nodes.push({
      id: `agent:${id}`,
      col,
      label: agentTitle(id),
      sub: a.failed ? "Failed" : tools,
      icon: { type: "agent", kind: a.kind },
      order: a.order,
      ...(a.failed && { failed: true }),
    });
  }
  const workCol = maxAgentCol + 1;
  for (const [provider, row] of ai) {
    nodes.push({
      id: `ai:${provider}`,
      col: workCol,
      label: PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL],
      sub: row.failed ? "Call failed" : (row.tools[0]?.replace(/^(Claude|CREAO):\s*/, "") ?? null),
      icon: { type: "agent", kind: provider as AgentKind },
      order: row.order,
      ...(row.failed && { failed: true }),
    });
    for (const from of row.from) addEdge(`agent:${from}`, `ai:${provider}`);
  }
  if (engineOrder !== null) {
    nodes.push({
      id: "engine",
      col: workCol,
      label: "Forecast engine",
      sub: plural(engineTools.length, "kind of step", "kinds of step"),
      icon: { type: "tool", category: "forecast" },
      order: engineOrder,
    });
    for (const from of engineFrom) addEdge(`agent:${from}`, "engine");
  }
  const resultCol = Math.max(workCol, 0) + (engineOrder !== null || ai.size ? 1 : 0);
  nodes.push({
    id: "result",
    col: resultCol,
    label: input.resultLabel,
    sub: null,
    icon: { type: "result", tone: input.resultTone },
    order: null,
  });
  // Inputs feed the first top-level agent; work feeds the result.
  const roots = [...agents.entries()].filter(([, a]) => !a.parent).map(([id]) => id);
  const firstRoot = roots[0];
  if (firstRoot)
    for (const s of nodes.filter((n) => n.col === 0 && n.id.startsWith("source:")))
      addEdge(s.id, `agent:${firstRoot}`);
  if (engineOrder !== null) addEdge("engine", "result");
  for (const provider of ai.keys()) addEdge(`ai:${provider}`, "result");
  if (engineOrder === null && !ai.size) {
    const last = [...agents.entries()].sort((a, b) => b[1].order - a[1].order)[0];
    if (last) addEdge(`agent:${last[0]}`, "result");
  }
  const columns: string[] = [];
  for (const n of nodes)
    columns[n.col] = n.id.startsWith("source:")
      ? "Data read"
      : n.id.startsWith("agent:")
        ? "Agents"
        : n.id === "result"
          ? "Result"
          : "AI and engine";
  const agentWork = agents.size > 0;
  return {
    nodes,
    edges,
    columns: Array.from(columns, (c) => c ?? ""),
    agentWork,
    truncated: !!input.truncated,
    note: !agentWork
      ? "No agent step was recorded for this result."
      : ai.size
        ? `AI used: ${[...ai.keys()].map((p) => PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL]).join(" and ")}, as recorded in this run's log. Every number comes from the forecast engine.`
        : "No AI model call was recorded for this result. Every number comes from the forecast engine.",
  };
}

/** Timeline saved calculations: no agents, the engine reads the saved books directly. */
export function engineOnlyMap(input: {
  booksLabel: string;
  resultLabel: string;
  resultTone: ResultTone;
  origin?: string | null;
}): AgentMap {
  const nodes: MapNode[] = [];
  if (input.origin)
    nodes.push({
      id: "origin",
      col: 0,
      label: input.origin,
      sub: "Change came from here",
      icon: { type: "agent", kind: "domino" },
      order: null,
    });
  const o = input.origin ? 1 : 0;
  nodes.push(
    {
      id: "books",
      col: o,
      label: "Saved books",
      sub: input.booksLabel,
      icon: { type: "tool", category: "save" },
      order: null,
    },
    {
      id: "engine",
      col: o + 1,
      label: "Forecast engine",
      sub: "Recalculated weeks",
      icon: { type: "tool", category: "forecast" },
      order: null,
    },
    {
      id: "result",
      col: o + 2,
      label: input.resultLabel,
      sub: null,
      icon: { type: "result", tone: input.resultTone },
      order: null,
    },
  );
  const edges: MapEdge[] = [
    ...(input.origin ? [{ from: "origin", to: "books", order: 1 }] : []),
    { from: "books", to: "engine", order: o + 1 },
    { from: "engine", to: "result", order: o + 2 },
  ];
  return {
    nodes,
    edges,
    columns: [...(input.origin ? ["Suggestion"] : []), "Data read", "Calculation", "Result"],
    agentWork: false,
    truncated: false,
    note: "Calculated directly by the forecast engine; no AI was used.",
  };
}
