"use client";
import { formatDate } from "@/lib/format";
import type { Evidence, ISODate } from "@domino/contracts";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ProofDrawer } from "./ProofDrawer";
export interface GradePreview {
  week: ISODate;
  errorPct: number;
  misses?: Evidence[];
}
export function LearningChart({ grades }: { grades: GradePreview[] }) {
  if (!grades.length)
    return (
      <div className="py-5">
        <p className="text-sm font-medium">No weekly accuracy results yet.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Results appear after a completed week is compared with its forecast.
        </p>
      </div>
    );
  const ordered = [...grades].sort((a, b) => a.week.localeCompare(b.week));
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Forecast error by week · lower is closer to the actual result
      </p>
      <div className="h-64 min-w-0" aria-label="Weekly forecast error in percent">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={ordered}
            margin={{ top: 12, right: 24, left: 0, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 6" />
            <XAxis
              dataKey="week"
              tickFormatter={(value) => formatDate(String(value))}
              minTickGap={30}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={(value) => `${value}%`}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <Tooltip
              labelFormatter={(value) => `Week of ${formatDate(String(value))}`}
              formatter={(value) => [`${value}%`, "Forecast error"]}
              contentStyle={{
                background: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            <Line
              type="linear"
              dataKey="errorPct"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="min-h-9 cursor-pointer py-2 text-muted-foreground">
          View accuracy results and proof
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Weekly forecast error, oldest first</caption>
            <thead>
              <tr>
                <th className="p-3">Week of</th>
                <th className="p-3">Forecast error</th>
                <th className="p-3">Proof</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((grade) => (
                <tr key={grade.week} className="border-t">
                  <th className="whitespace-nowrap p-3 font-normal">
                    {formatDate(grade.week)}, {grade.week.slice(0, 4)}
                  </th>
                  <td className="p-3 tabular-nums">{grade.errorPct}%</td>
                  <td className="p-3">
                    {grade.misses?.length ? (
                      <ProofDrawer evidence={grade.misses} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No source records attached
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
