"use client";
import { formatCents, formatDate } from "@/lib/format";
import type { Branch, Cents } from "@domino/contracts";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const colors = [
  "hsl(var(--primary))",
  "hsl(var(--foreground))",
  "hsl(var(--clay))",
  "hsl(var(--destructive))",
];
export function BranchChart({
  branches,
  limit,
  selectedId,
}: { branches: Branch[]; limit?: Cents; selectedId?: string }) {
  const dates = [
    ...new Set(branches.flatMap((branch) => branch.forecast.weeks.map((week) => week.weekStart))),
  ].sort();
  const data = dates.map((date) =>
    Object.fromEntries([
      ["date", date],
      ...branches.map((branch, index) => [
        `cash${index}`,
        branch.forecast.weeks.find((week) => week.weekStart === date)?.usable,
      ]),
    ]),
  );
  if (!branches.length)
    return (
      <p className="text-sm text-muted-foreground">
        No saved cash forecasts are available to compare.
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="h-80 w-full min-w-0" aria-label="Weekly usable cash by scenario">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={data}
            margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 6" />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => formatDate(String(value))}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              minTickGap={36}
            />
            <YAxis
              width={72}
              tickFormatter={(value) => formatCents(value)}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              domain={["auto", "auto"]}
            />
            <Tooltip
              labelFormatter={(value) => `Week of ${formatDate(String(value))}`}
              formatter={(value) => (typeof value === "number" ? formatCents(value) : "—")}
              contentStyle={{
                background: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            {limit !== undefined ? (
              <ReferenceLine
                y={limit}
                stroke="hsl(var(--destructive))"
                strokeDasharray="5 5"
                label={{
                  value: "Lender’s limit",
                  fill: "hsl(var(--danger-text))",
                  fontSize: 11,
                  position: "insideTopRight",
                }}
              />
            ) : null}
            {branches.map((branch, index) => (
              <Line
                key={branch.id}
                name={branch.label}
                dataKey={`cash${index}`}
                type="monotone"
                stroke={branch.id === selectedId ? colors[0] : colors[(index + 1) % colors.length]}
                strokeWidth={branch.id === selectedId ? 3 : 1.5}
                strokeDasharray={branch.kind === "base" ? "5 4" : undefined}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {branches.map((branch, index) => (
          <li key={branch.id} className="flex items-center gap-2">
            <span
              className="h-0.5 w-5"
              style={{
                background:
                  branch.id === selectedId ? colors[0] : colors[(index + 1) % colors.length],
              }}
            />
            {branch.label}
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="min-h-9 cursor-pointer py-2 text-muted-foreground">
          View weekly cash values
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Supplied weekly cash values in USD</caption>
            <thead>
              <tr>
                <th className="p-3">Week of</th>
                {branches.map((branch) => (
                  <th className="min-w-36 p-3" key={branch.id}>
                    {branch.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <tr key={date} className="border-t">
                  <th className="whitespace-nowrap p-3 font-normal">
                    {formatDate(date)}, {date.slice(0, 4)}
                  </th>
                  {branches.map((branch) => {
                    const week = branch.forecast.weeks.find((week) => week.weekStart === date);
                    return (
                      <td className="p-3 tabular-nums" key={branch.id}>
                        {week ? formatCents(week.usable) : "No forecast"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
