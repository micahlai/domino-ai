import { formatCents, formatDate } from "../lib/format";
import { STYLES } from "../lib/style-registry";
import { previewView } from "./historical/preview";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

// One fixed sample state drawn once per style. Each panel only sets data-style on a wrapper, so
// the same shared primitives pick up that style's tokens. No queries, no stored choice and no
// second app tree: the live page still uses the single selected style.
const view = previewView("observed");
const evidence = view.evidence.find((item) => item.id === "ev-observed");
const rows = view.comparison.slice(0, 3);

function Panel({ id, label }: { id: (typeof STYLES)[number]["id"]; label: string }) {
  return (
    <section
      data-style={id}
      aria-label={`${label} sample`}
      className="space-y-4 rounded-xl border bg-background p-4 text-foreground"
    >
      <h3 className="text-sm font-medium">{label}</h3>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Forecast vs reported (preview values)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-right">Reported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.period}>
                  <TableCell>{formatDate(row.period)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(row.projected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.observed === undefined ? "Not published" : formatCents(row.observed)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-2">
            <Button>Save forecast</Button>
            <Button variant="outline">Show source</Button>
            <Button variant="destructive">Remove</Button>
            <Badge variant="secondary">Forecast</Badge>
            <span className="text-sm text-primary">Reported</span>
            <span className="text-sm text-destructive">Below threshold</span>
          </div>
        </CardContent>
      </Card>
      {evidence ? (
        <div className="space-y-1 rounded-lg border bg-card p-4 text-sm text-card-foreground">
          <p className="font-medium">Source (open): {evidence.label}</p>
          <p className="text-muted-foreground">{evidence.source}</p>
          <p className="text-muted-foreground">{evidence.note}</p>
        </div>
      ) : null}
      <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
        Error state: the source could not be loaded. Nothing was saved.
      </p>
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Empty state: no alternative has been computed yet.
      </p>
    </section>
  );
}

export function StyleComparison() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {STYLES.map(({ id, label }) => (
        <Panel key={id} id={id} label={label} />
      ))}
    </div>
  );
}
