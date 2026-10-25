import type { FieldTrace } from "@/lib/field-trace-contract";
import { VENDORS, vendorFor } from "../../icons/vendors";
import {
  type Explain,
  type ExplainResult,
  type Fact,
  type Logo,
  agentMapFromOps,
  describeChange,
  fullDay,
  moneyOf,
  plural,
  readableResult,
} from "./explain-model";
import { traceProvenanceLine } from "./story";

const FLOOR = "lender's minimum";

export function selectedScenario(trace: FieldTrace) {
  return trace.selection.scenarioId
    ? (trace.scenarios.find((s) => s.id === trace.selection.scenarioId) ?? null)
    : null;
}
export function selectedCandidate(trace: FieldTrace) {
  return trace.selection.fixKind
    ? (trace.candidates.find(
        (c) =>
          c.scenarioId === trace.selection.scenarioId && c.fix.kind === trace.selection.fixKind,
      ) ?? null)
    : null;
}

/** Operations that touched the selected scenario or option, plus run-wide steps (no refs). */
export function relevantOps(trace: FieldTrace) {
  const candidate = selectedCandidate(trace);
  return trace.operations.filter(
    (op) =>
      !trace.selection.scenarioId ||
      op.refs.length === 0 ||
      op.refs.includes(trace.selection.scenarioId) ||
      (candidate && op.refs.includes(candidate.fix.id)),
  );
}

/**
 * Operations for the map snapshot: agents linked to the selected scenario or option by their
 * own refs or saved assignment, plus their parents. Run-wide rows from unrelated agents (other
 * forecasters, advisors of options not chosen) are left out.
 */
export function mapOps(trace: FieldTrace) {
  const ops = relevantOps(trace);
  const scenario = selectedScenario(trace);
  const candidate = selectedCandidate(trace);
  if (!scenario) return ops;
  const linked = new Set<string>([scenario.agentId, ...(candidate ? [candidate.agentId] : [])]);
  for (const op of ops)
    if (
      op.agentId &&
      (op.refs.includes(scenario.id) || (candidate && op.refs.includes(candidate.fix.id)))
    )
      linked.add(op.agentId);
  if (candidate)
    for (const id of [...linked])
      if (id.startsWith("advisor.") && id !== candidate.agentId) linked.delete(id);
  const parents = new Map<string, string>();
  for (const op of trace.operations)
    if (op.agentId && op.parentAgentId) parents.set(op.agentId, op.parentAgentId);
  for (const id of [...linked]) {
    let parent = parents.get(id);
    while (parent && !linked.has(parent)) {
      linked.add(parent);
      parent = parents.get(parent);
    }
  }
  return ops.filter(
    (op) =>
      !!op.agentId &&
      linked.has(op.agentId) &&
      (!op.toAgentId || linked.has(op.toAgentId)) &&
      (!op.fromAgentId || linked.has(op.fromAgentId)),
  );
}

/** Saved source checks pinned at the run's start, one logo per vendor. */
export function traceSources(trace: FieldTrace): Logo[] {
  const seen = new Map<string, Logo>();
  for (const s of trace.inputs?.sources ?? []) {
    const vendor = vendorFor(s.kind);
    const key = vendor === "generic" ? `generic:${s.kind}` : vendor;
    if (seen.has(key)) continue;
    const ok = s.tieOut === "ok";
    const pulled = s.lastPull ? `pulled ${fullDay(s.lastPull)}` : null;
    const line = [
      vendor === "generic" ? null : VENDORS[vendor].category,
      ok ? "ties out" : `check: ${s.tieOut}`,
      pulled,
    ]
      .filter(Boolean)
      .join(" · ");
    seen.set(key, {
      vendor,
      label: vendor === "generic" ? s.kind : VENDORS[vendor].name,
      line,
      ok,
    });
  }
  return [...seen.values()];
}

function rawResult(trace: FieldTrace): ExplainResult {
  const candidate = selectedCandidate(trace);
  const scenario = selectedScenario(trace);
  if (candidate) {
    const e = candidate.effect;
    const without = moneyOf(e.scenarioLow);
    return {
      tone: e.survives ? "above" : "below",
      badge: e.survives ? "Stays above" : "Falls below",
      low: moneyOf(e.lowPoint),
      lowWeek: fullDay(e.lowWeekStart),
      floor: moneyOf(e.lenderMinimum),
      floorLabel: FLOOR,
      facts: [
        ...(without ? [{ text: "Without this option", money: without }] : []),
        ...(moneyOf(e.gain)
          ? [{ text: "Cash gained at the low point", money: moneyOf(e.gain) }]
          : []),
      ],
      quote: candidate.recommendation
        ? { text: candidate.recommendation.text, by: "CREAO advisor, saved with this run" }
        : null,
    };
  }
  const work = scenario?.work;
  if (work) {
    const rule = trace.inputs?.constraints.find(
      (c) =>
        c.kind === "min_cash" && (!work.brokenConstraintId || c.id === work.brokenConstraintId),
    );
    const floor = rule?.kind === "min_cash" ? moneyOf(rule.limit) : null;
    return {
      tone: work.survives ? "above" : "below",
      badge: work.survives ? "Stays above" : "Falls below",
      low: moneyOf(work.low),
      lowWeek: fullDay(work.weeks[work.lowWeek]?.weekStart ?? null),
      floor,
      floorLabel: FLOOR,
      facts: [
        ...(work.breaksAt ? [{ text: `First break: ${fullDay(work.breaksAt)}` }] : []),
        ...(moneyOf(work.baseLow)
          ? [{ text: "Lowest cash before the event", money: moneyOf(work.baseLow) }]
          : []),
      ],
    };
  }
  return {
    tone: "unknown",
    badge: "No saved result",
    low: null,
    lowWeek: null,
    floor: null,
    floorLabel: FLOOR,
    facts: [{ text: trace.run.summary ?? "The run has no saved result for this selection." }],
  };
}

/** Every claim comes from the exact receipt. Missing old evidence stays missing. */
export function traceExplain(trace: FieldTrace): Explain {
  const scenario = selectedScenario(trace);
  const candidate = selectedCandidate(trace);
  const inputs = trace.inputs;
  const r = readableResult(rawResult(trace));
  const sources = traceSources(trace);
  const ops = relevantOps(trace);
  const changes = scenario?.changes.map((c) => describeChange(c)) ?? [];
  const weeks = scenario?.work?.weeks.length ?? null;
  const title = candidate
    ? `Why ${candidate.fix.label}?`
    : scenario
      ? scenario.title
      : "How we got here";
  const calcFacts: Fact[] = [];
  if (candidate) calcFacts.push({ text: `Option tested: ${candidate.fix.label}` });
  if (scenario?.work) calcFacts.push({ text: "Cash rules checked by the forecast engine" });
  if (!scenario?.work && trace.scenarios.some((s) => s.work))
    calcFacts.push({
      text: `${plural(trace.scenarios.filter((s) => s.work).length, "scenario")} calculated in this run`,
    });
  const provenance = traceProvenanceLine(trace);
  return {
    eyebrow: `Recorded ${trace.evidence} run · ${trace.run.status}`,
    title,
    subtitle: [
      inputs?.company.name ?? "Company name unavailable",
      candidate ? candidate.scenarioTitle : null,
      `As of ${fullDay(trace.run.asOf)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    data: inputs
      ? {
          headline: `Books as of ${fullDay(inputs.snapshot.asOf)}`,
          logos: sources,
          facts: [
            ...(weeks ? [{ text: `${weeks}-week forecast` }] : []),
            ...(moneyOf(inputs.snapshot.cashOnHand)
              ? [{ text: "Cash on hand", money: moneyOf(inputs.snapshot.cashOnHand) }]
              : []),
            { text: plural(inputs.sources.length, "source check") },
          ],
        }
      : {
          headline: "Books for this older run were not saved",
          facts: [{ text: `Run as of ${fullDay(trace.run.asOf)}` }],
        },
    change: scenario
      ? {
          tone: "change",
          headline: scenario.title,
          facts:
            changes.length === 1
              ? [{ text: changes[0]?.text ?? "" }]
              : [{ text: plural(changes.length, "recorded change") }, ...changes.slice(0, 2)],
        }
      : {
          tone: "none",
          headline: "No scenario selected",
          facts: [{ text: `Run started by ${trace.run.trigger}` }],
        },
    calc: {
      headline: scenario?.work
        ? `${plural(weeks ?? 0, "week")} forecast · cash rules checked`
        : "No completed scenario calculation is saved for this selection",
      facts: calcFacts,
    },
    result: r,
    map: agentMapFromOps({
      ops: mapOps(trace),
      sources,
      resultLabel: r.badge,
      resultTone: r.tone,
      truncated: trace.truncation.operations,
    }),
    limits:
      trace.evidence === "legacy" && trace.limitations.length === 0
        ? ["Some older run inputs were not saved."]
        : trace.limitations,
    details: [
      {
        title: "Source",
        rows: [
          ...(provenance ? [{ label: "Provenance", value: provenance }] : []),
          ...(scenario ? [{ label: "Scenario basis", value: scenario.basis }] : []),
          ...(candidate ? [{ label: "Cost of this option", value: candidate.fix.costNote }] : []),
          ...(inputs?.sources.map((s) => ({
            label: `Source ${s.kind}`,
            value: `${s.tieOut}; ${s.step}`,
          })) ?? []),
        ],
      },
      {
        title: "Changes",
        rows: scenario?.changes.length
          ? scenario.changes.map((c, i) => ({
              label: `${i + 1}. ${describeChange(c).text}`,
              value: JSON.stringify(c),
            }))
          : [{ label: "Changes", value: "None saved" }],
      },
      {
        title: `Recorded steps (${ops.length})`,
        rows: [
          ...ops.map((op) => ({
            label: op.toolLabel ?? op.summary,
            value: [op.toolLabel ? op.summary : null, op.status ?? "recorded", op.at]
              .filter(Boolean)
              .join(" · "),
          })),
          ...(trace.truncation.operations
            ? [{ label: "Note", value: "Older steps were left out." }]
            : []),
        ],
      },
      {
        title: "Exact values",
        rows: [
          ...(r.low
            ? [{ label: "Lowest usable cash", value: `${r.low.exact} (week of ${r.lowWeek})` }]
            : []),
          ...(r.floor ? [{ label: "Lender's minimum (sample)", value: r.floor.exact }] : []),
          ...r.facts.flatMap((f) => (f.money ? [{ label: f.text, value: f.money.exact }] : [])),
        ],
      },
      {
        title: "Technical",
        rows: [
          { label: "Company ID", value: trace.run.companyId },
          { label: "Run ID", value: trace.run.runId },
          {
            label: "Snapshot",
            value: `${trace.run.snapshotId} (version ${trace.run.snapshotVersion})`,
          },
          { label: "Scenario ID", value: trace.selection.scenarioId ?? "none" },
          { label: "Fix kind", value: trace.selection.fixKind ?? "none" },
          {
            label: "Source model",
            value: inputs ? `${inputs.model.id} version ${inputs.model.version}` : "not saved",
          },
          {
            label: "Dataset",
            value: inputs
              ? `${inputs.company.datasetId} version ${inputs.company.datasetVersion ?? "unknown"}`
              : "not saved",
          },
          {
            label: "Providers",
            value: trace.providers.length
              ? trace.providers
                  .map((p) =>
                    p.provider === "crs"
                      ? `CRS identity and fraud check (${p.attribution}, ${p.status}): ${p.detail ?? "no detail"}`
                      : `${p.provider} ${p.kind}: ${p.attribution}, ${p.status}`,
                  )
                  .join("; ")
              : "None recorded",
          },
          {
            label: "Advisor / coordinator",
            value: `${trace.aiSummary?.status ?? "No advisor summary recorded"} / ${trace.coordinator?.status ?? "No coordinator record"}`,
          },
          ...(trace.truncation.providers
            ? [{ label: "Note", value: "Some AI records were left out." }]
            : []),
        ],
      },
    ],
  };
}
