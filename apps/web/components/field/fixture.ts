import type {
  Decision,
  FieldFinding,
  FieldOperation,
  FieldStatus,
  OperationKind,
  OperationValues,
} from "./types";

// Demo data for the Field pages when the field.* backend is not reachable. Every record here is
// labelled "demo data" on screen. Reducers are pure: the caller passes the time, so tests are exact.
// Record ids in findings come from the Kestrel weekly seed fixture so refs stay meaningful.

export type DemoState = {
  status: FieldStatus;
  operations: FieldOperation[];
  findings: FieldFinding[];
  /** Feed batches that arrived but are not ingested yet. */
  pending: number[];
  nextBatch: number;
  nextOp: number;
};

type Step = {
  agent: string;
  kind: OperationKind;
  summary: string;
  tool?: string;
  source?: string;
  inputs?: OperationValues;
  outputs?: OperationValues;
  reasoning?: string;
  /** Index of an earlier step in the same cycle that started this one. */
  parent?: number;
};

type Batch = {
  sources: { id: string; entries: number; note: string }[];
  finding?: Omit<FieldFinding, "id" | "detectedAt" | "status">;
  /** Audit starts a helper for this check. */
  helper?: { agent: string; tool: string; summary: string };
};

// Each "New entries arrive" press delivers the next batch, then they repeat without findings.
const BATCHES: Batch[] = [
  {
    sources: [{ id: "cards", entries: 3, note: "3 new card charges" }],
    finding: {
      kind: "duplicate",
      severity: "medium",
      summary:
        "Two card charges of $38,000 to Software vendors on the same day look like the same charge entered twice.",
      refs: ["card_1"],
    },
  },
  {
    sources: [
      { id: "payroll", entries: 1, note: "1 new pay run" },
      { id: "bank", entries: 4, note: "4 new bank transactions" },
    ],
    finding: {
      kind: "unusual_amount",
      severity: "high",
      summary:
        "The November 6 payroll is $600,000, much higher than the usual run. Check for bonuses or a double run before it is paid.",
      refs: ["pay_1106"],
    },
  },
  {
    sources: [
      { id: "billing", entries: 2, note: "2 invoice updates" },
      { id: "crm", entries: 1, note: "1 deal update" },
    ],
    finding: {
      kind: "unusual_timing",
      severity: "medium",
      summary:
        "Northwind Health's Q4 invoice now lands about three weeks later than they usually pay.",
      refs: ["inv_nw_q4"],
    },
    helper: {
      agent: "Timing checker",
      tool: "compare_payment_history",
      summary: "Compared Northwind's due dates with their last 6 payments.",
    },
  },
  {
    sources: [
      { id: "books", entries: 2, note: "2 new bills" },
      { id: "bank", entries: 1, note: "1 new bank transaction" },
    ],
    finding: {
      kind: "conflict",
      severity: "low",
      summary:
        "The office rent bill says $62,000 is due this week, but the bank shows no matching payment scheduled.",
      refs: ["bill_rent_nov"],
    },
  },
];

function cycleSteps(batch: Batch): Step[] {
  const steps: Step[] = batch.sources.map((s) => ({
    agent: "ingestion",
    kind: "pull",
    tool: "read_feed",
    source: s.id,
    summary: `Read ${s.note}.`,
    outputs: { entries: s.entries },
  }));
  const total = batch.sources.reduce((n, s) => n + s.entries, 0);
  steps.push(
    {
      agent: "ingestion",
      kind: "map",
      tool: "map_to_books",
      summary: `Matched ${total} new ${total === 1 ? "entry" : "entries"} to the books format.`,
      inputs: { entries: total },
      outputs: { mapped: total, unmapped: 0 },
      reasoning: "Every entry matched a known account by its source field, so nothing was guessed.",
    },
    {
      agent: "ingestion",
      kind: "snapshot",
      tool: "save_snapshot",
      summary: "Saved a new version of the weekly books.",
      outputs: { totalsMatchSources: true },
    },
  );
  const snapshot = steps.length - 1;
  steps.push({
    agent: "audit",
    kind: "audit",
    tool: "check_entries",
    parent: snapshot,
    summary: batch.finding
      ? "Checked the new entries and flagged 1 item for review."
      : "Checked the new entries. Nothing needs review.",
    inputs: { entries: total },
    outputs: { flagged: batch.finding ? 1 : 0 },
    reasoning: batch.finding?.summary,
  });
  if (batch.helper) {
    const audit = steps.length - 1;
    steps.push({
      agent: batch.helper.agent,
      kind: "spawn",
      tool: batch.helper.tool,
      parent: audit,
      summary: batch.helper.summary,
    });
  }
  return steps;
}

function record(state: DemoState, steps: Step[], now: string): DemoState {
  let next = state.nextOp;
  const ids: string[] = [];
  const ops = steps.map((step) => {
    const id = `demo-op-${next++}`;
    ids.push(id);
    const { parent, ...rest } = step;
    return {
      id,
      at: now,
      status: "succeeded",
      ...rest,
      parentId: parent === undefined ? undefined : ids[parent],
    } satisfies FieldOperation;
  });
  return { ...state, operations: [...state.operations, ...ops], nextOp: next };
}

const openCount = (findings: FieldFinding[]) => findings.filter((f) => f.status === "open").length;

function withCounts(state: DemoState): DemoState {
  const sources = new Set(state.operations.flatMap((op) => op.source ?? [])).size;
  const snapshots = state.operations.filter((op) => op.kind === "snapshot").length;
  return {
    ...state,
    status: {
      ...state.status,
      counts: { sources, snapshots, openFindings: openCount(state.findings) },
    },
  };
}

/** New entries land in the mock feed. The always-on agent picks them up on its next run. */
export function demoAdvanceFeed(state: DemoState, now: string): DemoState {
  return {
    ...state,
    pending: [...state.pending, state.nextBatch],
    nextBatch: state.nextBatch + 1,
    status: { ...state.status, feed: { ...state.status.feed, lastAdvanceAt: now } },
  };
}

export function demoIngest(state: DemoState, now: string): DemoState {
  let next: DemoState = { ...state, pending: [] };
  if (state.pending.length === 0) {
    next = record(
      next,
      [
        {
          agent: "ingestion",
          kind: "pull",
          tool: "read_feed",
          summary: "Checked all 6 sources. No new entries.",
          outputs: { entries: 0 },
        },
      ],
      now,
    );
  }
  for (const n of state.pending) {
    const batch = BATCHES[n % BATCHES.length] ?? { sources: [] };
    // After the first round, batches repeat without findings so the queue does not refill forever.
    const fresh = n < BATCHES.length ? batch : { ...batch, finding: undefined, helper: undefined };
    next = record(next, cycleSteps(fresh), now);
    if (fresh.finding) {
      next = {
        ...next,
        findings: [
          ...next.findings,
          { ...fresh.finding, id: `demo-finding-${n}`, detectedAt: now, status: "open" },
        ],
      };
    }
  }
  return withCounts({
    ...next,
    status: { ...next.status, ingest: { ...next.status.ingest, lastRunAt: now, lastStatus: "ok" } },
  });
}

export function demoDecide(
  state: DemoState,
  args: { findingId: string; decision: Decision; note: string },
  now: string,
): DemoState {
  const finding = state.findings.find((f) => f.id === args.findingId);
  if (!finding || finding.status !== "open") return state;
  const findings = state.findings.map((f) =>
    f.id === args.findingId ? { ...f, status: args.decision, note: args.note || undefined } : f,
  );
  const verb = args.decision === "approved" ? "approved" : "rejected";
  const next = record(
    { ...state, findings },
    [
      {
        agent: "audit",
        kind: "decision",
        summary: `A person ${verb} a flag: ${finding.summary}`,
        inputs: { findingId: finding.id, decision: args.decision, note: args.note || null },
      },
    ],
    now,
  );
  return withCounts(next);
}

export function demoRecordExport(state: DemoState, now: string): DemoState {
  return record(
    state,
    [
      {
        agent: "ingestion",
        kind: "export",
        tool: "export_seed",
        summary: "Exported the weekly books and open flags for a simulation.",
      },
    ],
    now,
  );
}

/** Demo history is stamped a few hours before `historyAt` so "x ago" labels read naturally. */
export function initialDemoState(historyAt = "2026-10-30T16:00:00-07:00"): DemoState {
  const at = Date.parse(historyAt);
  const HISTORY_AT = new Date(at).toISOString();
  const base: DemoState = {
    status: {
      feed: { enabled: true, lastAdvanceAt: new Date(at - 120_000).toISOString() },
      ingest: { enabled: true, lastRunAt: HISTORY_AT, lastStatus: "ok" },
      counts: { sources: 0, snapshots: 0, openFindings: 0 },
    },
    operations: [],
    findings: [
      {
        id: "finding_nw_expansion_unsigned",
        kind: "missing_expected",
        severity: "medium",
        summary:
          "Northwind expansion deal is marked won but is unsigned and has no invoice, so its cash is not scheduled.",
        refs: ["deal_nw_expansion"],
        detectedAt: new Date(at + 60_000).toISOString(),
        status: "open",
      },
    ],
    pending: [],
    nextBatch: 0,
    nextOp: 1,
  };
  const sources = ["billing", "crm", "cards", "books", "payroll", "bank"];
  const first = record(
    base,
    [
      ...sources.map(
        (id): Step => ({
          agent: "ingestion",
          kind: "pull",
          tool: "read_feed",
          source: id,
          summary: `Read the full history from ${id === "crm" ? "customer records" : id}.`,
        }),
      ),
      {
        agent: "ingestion",
        kind: "map",
        tool: "map_to_books",
        summary: "Matched 1,385 entries to the books format.",
      },
      {
        agent: "ingestion",
        kind: "snapshot",
        tool: "save_snapshot",
        summary: "Saved the first version of the weekly books.",
      },
      {
        agent: "audit",
        kind: "audit",
        tool: "check_entries",
        parent: 7,
        summary: "Checked all entries and flagged 1 item for review.",
        outputs: { flagged: 1 },
      },
      {
        agent: "forecaster",
        kind: "pull",
        tool: "build_forecast",
        summary: "Built the 13-week cash forecast from the saved books.",
      },
    ],
    HISTORY_AT,
  );
  return withCounts(first);
}
