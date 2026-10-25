"use client";

import { useMutation, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import {
  type Prediction,
  PredictionSchema,
  latestPredictionRef,
  startPredictionRef,
} from "./prediction";

const link = "inline-flex items-center gap-1 rounded text-primary hover:underline";

/**
 * "Predict knock-on effects" for one saved scenario: agents read the Brain map and the books,
 * the engine checks each effect, and the result is saved as a child line. Takes about a minute.
 */
export function PredictionView({
  name,
  prediction,
  starting = false,
  startError = null,
  onStart,
  onShow,
}: {
  name: string;
  prediction: Prediction | null;
  starting?: boolean;
  startError?: string | null;
  onStart?: () => void;
  onShow?: (runId: string) => void;
}) {
  const busy = starting || prediction?.status === "queued" || prediction?.status === "running";
  if (busy) {
    const percent = Math.round(prediction?.progress ?? 2);
    const last = prediction?.activity[prediction.activity.length - 1]?.text;
    return (
      <div className="w-full space-y-1 pt-1" data-testid="prediction-progress">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{prediction?.stage ?? "Starting"}</span>
          <span className="shrink-0 tabular-nums">{percent}%</span>
        </div>
        <progress
          className="sr-only"
          max={100}
          value={percent}
          aria-label={`Predicting knock-on effects of ${name}`}
        />
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[hsl(var(--primary-ink))] transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="truncate text-[11px] text-muted-foreground" title={last}>
          {last ?? "Usually takes about a minute."}
        </p>
      </div>
    );
  }
  const start = onStart ? (
    <button
      type="button"
      onClick={onStart}
      className={link}
      aria-label={`Predict knock-on effects of ${name}`}
    >
      <Sparkles aria-hidden="true" className="size-3" />
      {prediction ? "Predict again" : "Predict knock-on effects"}
    </button>
  ) : null;
  if (!prediction)
    return (
      <span className="flex flex-col items-start gap-0.5">
        {start}
        {startError ? <span className="text-[11px] text-destructive">{startError}</span> : null}
      </span>
    );
  if (prediction.status === "failed")
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="text-[11px] text-destructive">{prediction.error}</span>
        {start}
      </span>
    );
  const count = prediction.effects.length;
  const response = prediction.response;
  const read = [...new Set((prediction.context ?? []).flatMap((c) => c.sources))];
  return (
    <div className="w-full space-y-1 pt-0.5" data-testid="prediction-result">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {prediction.resultRunId && onShow ? (
          <button
            type="button"
            onClick={() => onShow(prediction.resultRunId ?? "")}
            className={link}
          >
            <Sparkles aria-hidden="true" className="size-3" />
            Show predicted line
          </button>
        ) : null}
        {start}
      </div>
      <details className="group/prediction text-[11px] leading-4 text-muted-foreground">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          {count === 0
            ? "No knock-on effects found"
            : `${count} knock-on ${count === 1 ? "effect" : "effects"}`}
          {response?.applied ? ` · growth spending cut ${response.spendCutPercent}%` : ""}
          {prediction.interest
            ? ` · interest ${prediction.interest.netCents < 0 ? "lost" : "gained"} ${formatCents(Math.abs(prediction.interest.netCents))} at ${prediction.interest.annualBps / 100}%/yr`
            : ""}
          <span className="text-primary group-open/prediction:hidden"> · Why</span>
        </summary>
        <div className="mt-1 space-y-1.5">
          {prediction.summary ? <p className="text-foreground/80">{prediction.summary}</p> : null}
          {prediction.effects.length ? (
            <ul className="space-y-1">
              {prediction.effects.map((e) => (
                <li key={`${e.title}-${JSON.stringify(e.change)}`}>
                  <span className="font-medium text-foreground/90">{e.title}</span>{" "}
                  <span
                    className={cn(
                      "rounded px-1 py-px text-[10px]",
                      e.likelihood === "likely" ? "bg-secondary text-foreground" : "bg-muted",
                    )}
                  >
                    {e.likelihood}
                  </span>
                  <span className="block">{e.reason}</span>
                  {e.evidence.length ? (
                    <span className="block italic">Evidence: {e.evidence.join("; ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {response ? (
            <div data-testid="prediction-response">
              <span className="font-medium text-foreground/90">
                {response.applied ? "Management response" : "No management response"}
              </span>{" "}
              <span className="rounded bg-muted px-1 py-px text-[10px]">
                {response.source === "agents" ? response.likelihood : "default assumption"}
              </span>
              {response.applied ? (
                <span className="block">
                  {response.respondFrom === "event"
                    ? "Responds to the event itself"
                    : "Responds once cash falls below the lowest cash rule"}
                  {response.trigger ? ` (${response.trigger.date})` : ""}.
                </span>
              ) : null}
              {response.notes.map((n) => (
                <span key={n} className="block">
                  {n}
                </span>
              ))}
              {response.skipped ? <span className="block">{response.skipped}</span> : null}
              <span className="block">{response.reason}</span>
              {response.evidence.length ? (
                <span className="block italic">Evidence: {response.evidence.join("; ")}</span>
              ) : null}
            </div>
          ) : null}
          {read.length ? (
            <p>Agents read: {read.join(", ")}, plus the brain map and books.</p>
          ) : null}
          {prediction.rejected.length ? (
            <p>Not used: {prediction.rejected.map((r) => `${r.title} (${r.reason})`).join("; ")}</p>
          ) : null}
          {prediction.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p>
            Agents only name records and choose bounded assumptions; the engine computes every
            amount. A prediction is a hypothesis, not a forecast of record.
          </p>
        </div>
      </details>
    </div>
  );
}

/** Live wrapper: reads the newest prediction for this scenario and starts new ones. */
export function PredictionControl({
  companyId,
  runId,
  name,
  show,
}: {
  companyId: string;
  runId: string;
  name: string;
  show: (runId: string) => void;
}) {
  const raw = useQuery(latestPredictionRef, { companyId, runId });
  const parsed = raw ? PredictionSchema.safeParse(raw) : null;
  const prediction = parsed?.success ? parsed.data : null;
  const start = useMutation(startPredictionRef);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Draw the result once when a prediction finishes while this page is open.
  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (!prediction) return;
    if (prediction.status === "queued" || prediction.status === "running")
      watched.current = prediction.predictionId;
    else if (
      watched.current === prediction.predictionId &&
      prediction.status === "done" &&
      prediction.resultRunId
    ) {
      watched.current = null;
      show(prediction.resultRunId);
    }
  }, [prediction, show]);
  return (
    <PredictionView
      name={name}
      prediction={prediction}
      starting={starting}
      startError={startError}
      onShow={show}
      onStart={async () => {
        setStarting(true);
        setStartError(null);
        try {
          await start({ companyId, runId, requestId: `predict-${crypto.randomUUID()}` });
        } catch {
          setStartError("Could not start the prediction. Try again.");
        } finally {
          setStarting(false);
        }
      }}
    />
  );
}
