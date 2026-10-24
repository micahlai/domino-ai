"use client";

import { Button } from "../ui/button";

const TIME_STEPS = [1, 1.5, 2, 3];
const CASH_STEPS = [0.75, 1, 1.5, 2];

function ScaleControl({
  label,
  value,
  steps,
  onChange,
}: {
  label: string;
  value: number;
  steps: number[];
  onChange: (value: number) => void;
}) {
  const index = steps.indexOf(value);
  return (
    <fieldset aria-label={`${label} scale`} className="flex items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 px-2"
        aria-label={`Decrease ${label.toLowerCase()} scale`}
        disabled={index <= 0}
        onClick={() => onChange(steps[index - 1] ?? value)}
      >
        −
      </Button>
      <output aria-live="polite" className="w-11 text-center text-xs tabular-nums">
        {Math.round(value * 100)}%
      </output>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 px-2"
        aria-label={`Increase ${label.toLowerCase()} scale`}
        disabled={index >= steps.length - 1}
        onClick={() => onChange(steps[index + 1] ?? value)}
      >
        +
      </Button>
    </fieldset>
  );
}

export function TimelineScaleControls({
  timeScale,
  cashScale,
  onTimeScale,
  onCashScale,
  onReset,
}: {
  timeScale: number;
  cashScale: number;
  onTimeScale: (value: number) => void;
  onCashScale: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Timeline scales">
      <ScaleControl label="Time" value={timeScale} steps={TIME_STEPS} onChange={onTimeScale} />
      <ScaleControl label="Cash" value={cashScale} steps={CASH_STEPS} onChange={onCashScale} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 text-xs text-muted-foreground"
        disabled={timeScale === 1 && cashScale === 1}
        onClick={onReset}
      >
        Reset scales
      </Button>
      {timeScale > 1 || cashScale > 1 ? (
        <p className="text-xs text-muted-foreground">Scroll the chart to explore.</p>
      ) : null}
    </div>
  );
}
