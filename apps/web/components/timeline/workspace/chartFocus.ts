/** Plot coordinates only: interpolating a segment never creates a saved cash value or week. */
export type FocusPoint = { slot: number; x: number; y: number };
export type FocusCurve = {
  runId: string;
  label: string;
  color?: string;
  points: FocusPoint[];
};

export function pointOnCurve(points: FocusPoint[], slot: number): FocusPoint | null {
  if (points.length < 2 || slot < points[0]!.slot || slot > points.at(-1)!.slot) return null;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (slot > end.slot) continue;
    const fraction = (slot - start.slot) / (end.slot - start.slot);
    return {
      slot,
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
    };
  }
  return null;
}

/** Compare curves at the clicked time, excluding branches before their drawn fork. */
export function nearestCurveAt(
  curves: FocusCurve[],
  slot: number,
  pointerY: number,
  preferredRunId?: string,
): { curve: FocusCurve; point: FocusPoint } | null {
  let nearest: { curve: FocusCurve; point: FocusPoint } | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const curve of curves) {
    const point = pointOnCurve(curve.points, slot);
    if (!point) continue;
    const nextDistance = Math.abs(point.y - pointerY);
    if (
      nextDistance < distance - 0.001 ||
      (Math.abs(nextDistance - distance) <= 0.001 && curve.runId === preferredRunId)
    ) {
      nearest = { curve, point };
      distance = nextDistance;
    }
  }
  return nearest;
}
