import type { FieldOperation } from "./types";

// Demo only (no backend configured): a scripted agent swarm for the brain map, labelled as demo
// on screen. Each round the Analyst asks a Claude scenario writer for what-if events, a CREAO
// research agent reads the web through Apify demo actors, and the Analyst starts 8 Forecaster
// copies in parallel, one per event. Rows use the same fields the live log records (instance
// ids, parent agent, status steps, current task, messages), so the map code path is the same.
// Pure: the caller passes the time. Text only; no number here is computed or real.

export const SWARM_BEAT_MS = 1100;
/** Rounds of history kept; older rows drop off so a long demo stays light. */
const KEEP_ROUNDS = 4;
const FORECASTERS = 8;

const EVENTS = [
  "Northwind pays 30 days late",
  "Largest customer leaves in week 4",
  "Payroll rises 8% in January",
  "Card spend jumps 20% for a month",
  "A $250k deal slips a quarter",
  "Bank holds a $90k deposit for 5 days",
  "Office rent rises at renewal",
  "Two invoices go unpaid",
];
const RESULTS = [
  "Lowest cash $1.4M in week 6. Stays above the lender's limit.",
  "Falls below the lender's limit in week 5.",
  "Lowest cash $1.9M in week 9. Stays above the lender's limit.",
  "Lowest cash $1.6M in week 4. Stays above the lender's limit.",
  "Falls below the lender's limit in week 8.",
  "Lowest cash $2.1M in week 2. Stays above the lender's limit.",
  "Lowest cash $1.8M in week 11. Stays above the lender's limit.",
  "Lowest cash $1.2M in week 7. Stays above the lender's limit.",
];
const SOURCES = ["billing", "cards", "bank", "crm", "payroll", "books"];

type Row = Omit<FieldOperation, "id" | "at" | "seq">;
export type SwarmState = {
  round: number;
  beat: number;
  beats: Row[][];
  nextOp: number;
  ops: FieldOperation[];
};

/** Small deterministic hash, so each round's pacing differs but replays exactly. */
const mix = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

const msg = (from: string, fromName: string, to: string, summary: string): Row => ({
  agent: fromName,
  ...(from.includes("#") && { instanceId: from }),
  kind: "message",
  status: "succeeded",
  from,
  to,
  summary,
});

/** One round of the script, as beats; each beat is the rows recorded together. */
export function scriptRound(round: number): Row[][] {
  const beats: Row[][] = [];
  const at = (i: number) => {
    while (beats.length <= i) beats.push([]);
    return beats[i] as Row[];
  };
  const writer = `writer#${round + 1}`;
  const source = SOURCES[round % SOURCES.length] ?? "bank";
  const analystTask = `Test ${FORECASTERS} what-if events against this week's forecast`;

  at(0).push(
    {
      agent: "Analyst",
      kind: "run",
      status: "working",
      agentKind: "domino",
      currentTask: analystTask,
      summary: "Started this week's what-if tests.",
    },
    {
      agent: "Ingestion agent",
      kind: "pull",
      tool: "read_feed",
      source,
      status: "succeeded",
      summary: "Read new entries.",
    },
  );
  at(1).push(
    {
      agent: "Ingestion agent",
      kind: "snapshot",
      tool: "save_snapshot",
      status: "succeeded",
      summary: "Saved a new version of the weekly books.",
    },
    {
      agent: "Audit agent",
      kind: "audit",
      tool: "check_entries",
      parentAgentId: "ingestion",
      status: "succeeded",
      summary: "Checked the new entries. Nothing needs review.",
    },
  );
  at(2).push(
    {
      agent: "Scenario writer",
      instanceId: writer,
      agentKind: "claude",
      parentAgentId: "analyst",
      kind: "spawn",
      status: "spawned",
      currentTask: `Draft ${FORECASTERS} plausible events from the new books`,
      instructions:
        "Propose events that could plausibly hurt cash in the next 13 weeks, each tied to a record in the books. Do not compute any amounts.",
      summary: "Started a scenario writer.",
    },
    msg("analyst", "Analyst", writer, `Draft ${FORECASTERS} events that could hurt cash soon.`),
  );
  at(3).push(
    {
      agent: "Scenario writer",
      instanceId: writer,
      kind: "run",
      tool: "draft_events",
      status: "working",
      progress: 0.5,
      currentTask: `Draft ${FORECASTERS} plausible events from the new books`,
      summary: "Drafted events from late invoices, payroll and card spend.",
    },
    {
      agent: "Research agent",
      agentKind: "creao",
      kind: "pull",
      tool: "apify.google-search-scraper",
      toolCategory: "apify",
      status: "working",
      currentTask: "Check the news on the top 5 customers",
      instructions:
        "Search public news for the largest customers and summarize anything that could change when they pay. Demo actors return saved pages.",
      summary: "Searched news for Northwind Health (demo actor).",
    },
  );
  at(4).push(
    {
      agent: "Research agent",
      kind: "pull",
      tool: "apify.website-content-crawler",
      toolCategory: "apify",
      status: "working",
      currentTask: "Read the 3 most relevant articles",
      summary: "Read 3 articles (demo actor).",
    },
    msg(writer, "Scenario writer", "analyst", `${FORECASTERS} events ready: ${EVENTS[0]}, ...`),
    {
      agent: "Scenario writer",
      instanceId: writer,
      kind: "run",
      status: "done",
      progress: 1,
      summary: "Finished drafting events.",
    },
  );
  at(5).push({
    agent: "Research agent",
    kind: "pull",
    tool: "apify.instagram-scraper",
    toolCategory: "apify",
    status: "working",
    currentTask: "Check customer announcements",
    summary: "Checked 2 customer pages (demo actor).",
  });
  at(6).push(
    msg(
      "research-agent",
      "Research agent",
      "analyst",
      "Northwind announced a hiring freeze (demo page). Payment delays are plausible.",
    ),
    {
      agent: "Research agent",
      kind: "run",
      status: "done",
      currentTask: "Check the news on the top 5 customers",
      summary: "Finished the news check.",
    },
  );

  let last = 0;
  for (let k = 0; k < FORECASTERS; k++) {
    const id = `forecaster#${round * FORECASTERS + k + 1}`;
    const event = EVENTS[k] ?? "";
    const task = `Forecast: ${event}`;
    const start = 6 + Math.floor(k / 2);
    const stride = 1 + (mix(round, k) % 3);
    const steps: Row[] = [
      {
        agent: "Forecaster",
        instanceId: id,
        agentKind: "domino",
        parentAgentId: "analyst",
        kind: "spawn",
        status: "spawned",
        currentTask: task,
        progress: 0,
        instructions:
          "Run the 13-week cash forecast with this one event applied. The engine computes every number; report the lowest week and whether it crosses the lender's limit.",
        summary: `Started for "${event}".`,
      },
      {
        agent: "Forecaster",
        instanceId: id,
        kind: "pull",
        tool: "read_snapshot",
        status: "working",
        progress: 0.25,
        currentTask: task,
        summary: "Read the saved books.",
      },
      {
        agent: "Forecaster",
        instanceId: id,
        kind: "forecast",
        tool: "engine.recompute",
        status: "working",
        progress: 0.6,
        currentTask: task,
        summary: "Recomputed 13 weeks with the event applied.",
      },
      {
        agent: "Forecaster",
        instanceId: id,
        kind: "audit",
        tool: "check_limit",
        status: "working",
        progress: 0.85,
        currentTask: task,
        summary: "Checked each week against the lender's limit.",
      },
      msg(id, "Forecaster", "analyst", `${event}: ${RESULTS[k] ?? ""}`),
      {
        agent: "Forecaster",
        instanceId: id,
        kind: "run",
        status: "done",
        progress: 1,
        currentTask: task,
        summary: "Finished.",
      },
    ];
    at(start).push(msg("analyst", "Analyst", id, `Run: ${event}.`));
    steps.forEach((row, j) => {
      // The spawn row lands just before the analyst's message, in the same beat.
      const beat = j === 0 ? start : start + j * stride;
      if (j === 0) at(beat).splice(at(beat).length - 1, 0, row);
      else at(beat).push(row);
      last = Math.max(last, beat);
    });
  }
  at(last + 1).push({
    agent: "Analyst",
    kind: "forecast",
    tool: "rank_scenarios",
    status: "working",
    currentTask: "Rank the events by how close cash gets to the limit",
    summary: `Ranked ${FORECASTERS} events: 2 would drop cash below the lender's limit.`,
  });
  at(last + 2).push({
    agent: "Analyst",
    kind: "run",
    status: "done",
    currentTask: analystTask,
    summary: "Finished this week's what-if tests.",
  });
  at(last + 3);
  return beats;
}

const roundOf = (op: FieldOperation) => Number(op.id.split("-")[1] ?? 0);

/** Record the next beat at `now`, starting the next round when this one is done. */
export function swarmStep(state: SwarmState, now: string): SwarmState {
  let { round, beat, beats } = state;
  if (beat >= beats.length) {
    round += 1;
    beat = 0;
    beats = scriptRound(round);
  }
  let next = state.nextOp;
  const fresh = (beats[beat] ?? []).map((row) => {
    const n = next++;
    return { ...row, id: `swarm-${round}-${n}`, at: now, seq: n } as FieldOperation;
  });
  const ops = [...state.ops, ...fresh].filter((op) => roundOf(op) > round - KEEP_ROUNDS);
  return { round, beat: beat + 1, beats, nextOp: next, ops };
}

/** One finished round of history, stamped as if it ended a little before `nowMs`. */
export function initialSwarm(nowMs: number): SwarmState {
  const beats = scriptRound(0);
  let state: SwarmState = { round: 0, beat: 0, beats, nextOp: 1, ops: [] };
  const start = nowMs - (beats.length + 4) * SWARM_BEAT_MS;
  for (let i = 0; i < beats.length; i++)
    state = swarmStep(state, new Date(start + i * SWARM_BEAT_MS).toISOString());
  return state;
}
