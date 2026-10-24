import type { timelineGeometry } from "./geometry";
import { timestamp } from "./geometry";
import { type InspectionPoint, inspectionCash, inspectionDate } from "./inspection";

export function TimelineCrosshair({
  point,
  graph,
}: {
  point: InspectionPoint;
  graph: ReturnType<typeof timelineGeometry>;
}) {
  const x = graph.x(timestamp(point.date));
  const y = graph.y(point.usable);
  const dateX = Math.max(graph.left + 61, Math.min(graph.right - 61, x));
  return (
    <g className="pointer-events-none" data-timeline-crosshair="">
      <line
        x1={x}
        x2={x}
        y1={graph.top}
        y2={graph.bottom}
        className="stroke-foreground/60"
        strokeDasharray="2 5"
      />
      <line
        x1={graph.left}
        x2={graph.right}
        y1={y}
        y2={y}
        className="stroke-foreground/60"
        strokeDasharray="2 5"
      />
      <circle cx={x} cy={y} r={4} className="fill-background stroke-foreground" strokeWidth={1.5} />
      <rect x={graph.right + 5} y={y - 13} width={122} height={26} rx={4} className="fill-card" />
      <text x={graph.right + 12} y={y + 4} className="fill-foreground text-[11px] tabular-nums">
        {inspectionCash(point.usable)}
      </text>
      <rect
        x={dateX - 61}
        y={graph.bottom + 7}
        width={122}
        height={26}
        rx={4}
        className="fill-card"
      />
      <text
        x={dateX}
        y={graph.bottom + 24}
        textAnchor="middle"
        className="fill-foreground text-[11px]"
      >
        {inspectionDate(point.date)}
      </text>
    </g>
  );
}
