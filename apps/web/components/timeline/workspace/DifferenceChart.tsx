import { formatCents } from "../../../lib/format";
import { formatFullDate } from "../baseline/format";

export type DifferenceSeries = {
  runId: string;
  label: string;
  color: string;
  /** Usable cash minus the line this scenario builds on, per forecast week. */
  points: { weekStart: string; delta: number }[];
};

const W = 800;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 34, left: 72 };

/** A round step so about four gridlines cover the range: 1, 2 or 5 times a power of ten. */
function niceStep(span: number): number {
  if (span <= 0) return 100_00;
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

const shortDate = (iso: string) => formatFullDate(iso).replace(/, \d{4}$/, "");

/**
 * How far each shown scenario sits from the line it builds on, week by week. On the cash chart
 * a few million is invisible next to swings of a hundred million; here zero is the parent line,
 * so a response that bends a scenario shows as a moving line instead of a flat offset.
 */
export function DifferenceChart({ series }: { series: DifferenceSeries[] }) {
  const weeks = series[0]?.points.map((p) => p.weekStart) ?? [];
  if (!series.length || !weeks.length)
    return (
      <p className="p-4 text-sm text-muted-foreground" data-testid="difference-empty">
        Tick a scenario to see how far it moves from the line it builds on.
      </p>
    );
  const values = series.flatMap((s) => s.points.map((p) => p.delta));
  const step = niceStep(Math.max(...values, 0) - Math.min(...values, 0));
  const lo = Math.floor(Math.min(...values, 0) / step) * step;
  const hi = Math.max(Math.ceil(Math.max(...values, 0) / step) * step, lo + step);
  const x = (i: number) =>
    PAD.left + (weeks.length === 1 ? 0 : (i / (weeks.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return (
    <figure className="flex min-h-0 flex-1 flex-col gap-2" data-testid="difference-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full min-h-[200px] w-full"
        role="img"
        aria-label="Weekly difference in usable cash from the line each scenario builds on"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 ? "stroke-foreground/50" : "stroke-border"}
              strokeDasharray={v === 0 ? undefined : "3 3"}
            />
            <text
              x={PAD.left - 8}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {v === 0 ? "No change" : `${v > 0 ? "+" : ""}${formatCents(v)}`}
            </text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i % 2 === 0 ? (
            <text
              key={w}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {shortDate(w)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.runId} data-testid={`difference-line-${s.runId}`}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.delta)}`).join(" ")}
            />
            {s.points.map((p, i) => (
              <circle key={p.weekStart} cx={x(i)} cy={y(p.delta)} r={3} fill={s.color}>
                <title>{`${s.label}, week of ${formatFullDate(p.weekStart)}: ${p.delta > 0 ? "+" : ""}${formatCents(p.delta)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => {
          const last = s.points[s.points.length - 1]?.delta ?? 0;
          return (
            <span key={s.runId} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-foreground/90">{s.label}</span>
              <span className="tabular-nums">
                {last === 0 ? "ends level" : `ends ${last > 0 ? "+" : ""}${formatCents(last)}`}
              </span>
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
