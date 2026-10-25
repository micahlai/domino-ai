import type { Change } from "@domino/contracts";
import { money } from "@domino/engine";
import {
  MAX_PREDICTIONS,
  MAX_START_DAYS,
  type PredictionCatalogEntry,
  predictionCatalog,
  resolvePredictions,
  rulePredictions,
} from "@domino/engine/src/predictions";
import { type PredictionSet, eventTone, personalNumbers } from "../chat/predicted";
import type { WorkspaceRun } from "../questions/context";
import { runStructured } from "./claude";
import { companyContext } from "./context";

/**
 * One Claude call that predicts what an event described in words does to the company: one to
 * six consequences from the engine's catalog, each with bounded parameters, a start offset, a
 * probability and a one-line reason. Claude sees the saved books and the Brain map's findings;
 * code clamps every value and the engine builds all cash. Numbers the person gave win. Without
 * a usable answer the rule defaults for the event's tone apply; null when there is no event.
 */
const PREDICT_TIMEOUT_MS = 30_000;
const SYSTEM = `You are Domino's forecaster. Predict what one event, described in words, does to a B2B software company's cash in its 13-week forecast. Think like an operator: who reacts (customers, prospects, investors, competitors, staff) and how, sized for THIS company from its books, plan sizes, pipeline and the Brain map findings. Good news usually brings several effects (more new customers, faster deal closes, investor interest, then hiring to support growth); bad news too (cancellations, slower collections, slower deals, one-time costs).
Return 1 to ${MAX_PREDICTIONS} consequences, only kinds from the catalog, each once: every parameter of the kind with a value inside its bounds (cents parameters are integer cents), startInDays (0 to ${MAX_START_DAYS}, days after the event starts), a probability from 0 to 1 that it happens, and one plain reason under 120 characters with no money amounts. Numbers the person gave are listed in personNumbers and are applied by code; do not contradict them. Prefer moderate, typical values unless the wording says the event is big or small. If the text is not an event that changes the business, return an empty list. Return JSON only.`;

export async function predictEvent(
  run: WorkspaceRun,
  item: string,
  a: { eventStart: string; prior: Change[]; brain: unknown },
): Promise<PredictionSet | null> {
  const snapshot = run.baseline.seed.snapshot;
  const catalog = predictionCatalog(snapshot, run.baseline.model, a.prior);
  if (!catalog.length) return null;
  const mine = personalNumbers(item);
  const fallback = (): PredictionSet | null => {
    const tone = eventTone(item);
    const choices = tone ? rulePredictions(tone, catalog, mine) : null;
    return choices ? { item, source: "rule", choices } : null;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PREDICT_TIMEOUT")), PREDICT_TIMEOUT_MS);
    });
    const call = runStructured({
      system: SYSTEM,
      schema: SCHEMA(catalog),
      maxSteps: 1,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            event: item.slice(0, 300),
            eventStartsOn: a.eventStart,
            personNumbers: mine,
            catalog: catalog.map(describe),
            company: companyContext(run),
            brainMapOutput: a.brain,
          }),
        },
      ],
    });
    const raw = await Promise.race([call, timeout]);
    const listed = (raw as { consequences?: unknown[] } | null)?.consequences;
    if (Array.isArray(listed) && listed.length === 0 && eventTone(item) === null) return null;
    const choices = resolvePredictions(catalog, fromWire(raw), mine);
    return choices ? { item, source: "ai", choices } : fallback();
  } catch (error) {
    console.warn(
      `event prediction failed, using rule defaults: ${error instanceof Error ? error.message : error}`,
    );
    return fallback();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Bounds in words too, so cents are never misread as dollars. */
function describe(entry: PredictionCatalogEntry) {
  return {
    kind: entry.kind,
    title: entry.title,
    meaning: entry.meaning,
    goodNews: entry.good,
    params: entry.params.map((p) => ({
      ...p,
      ...(p.unit === "cents"
        ? { readable: `${money(p.min)} to ${money(p.max)}, typical ${money(p.default)}` }
        : {}),
    })),
  };
}

function SCHEMA(catalog: PredictionCatalogEntry[]): Record<string, unknown> {
  const names = [...new Set(catalog.flatMap((c) => c.params.map((p) => p.name)))];
  return {
    type: "object",
    additionalProperties: false,
    required: ["consequences"],
    properties: {
      consequences: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "params", "startInDays", "probability", "reason"],
          properties: {
            kind: { type: "string", enum: catalog.map((c) => c.kind) },
            params: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "value"],
                properties: { name: { type: "string", enum: names }, value: { type: "number" } },
              },
            },
            startInDays: { type: "integer" },
            probability: { type: "number" },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

/** Parameter lists on the wire become the engine's name-to-value record. */
function fromWire(raw: unknown): unknown {
  const list = (raw as { consequences?: unknown[] } | null)?.consequences;
  if (!Array.isArray(list)) return null;
  return {
    consequences: list.map((c) => {
      if (!c || typeof c !== "object") return null;
      const row = c as Record<string, unknown>;
      const params = Array.isArray(row.params)
        ? Object.fromEntries(
            row.params.flatMap((p) =>
              p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string"
                ? [[(p as { name: string }).name, (p as { value?: unknown }).value]]
                : [],
            ),
          )
        : {};
      return { ...row, params };
    }),
  };
}
