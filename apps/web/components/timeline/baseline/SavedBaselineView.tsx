import type { Constraint } from "@domino/contracts";
import type { ReactNode } from "react";
import { Badge } from "../../ui/badge";
import { Skeleton } from "../../ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import type { BaselineRead, SavedBaseline } from "./api";
import { formatExactCents, formatFullDate, formatSavedAt } from "./format";

const WhenDate = ({ iso }: { iso: string }) => <time dateTime={iso}>{formatFullDate(iso)}</time>;

/** One plain sentence per saved rule. Limits are shown as saved, never recomputed. */
function constraintText(c: Constraint): string {
  if (c.kind === "min_cash")
    return Number.isSafeInteger(c.limit)
      ? `Keep at least ${formatExactCents(c.limit)} of usable cash`
      : `Keep at least ${c.limit} cents of usable cash`;
  if (c.kind === "pay_by_date")
    return `Pay bill ${c.billId ?? "(no bill named)"} no more than ${c.limit} days late`;
  return `Keep at least ${c.limit} months of cash`;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{children}</dd>
    </div>
  );
}

function RawInput({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm">{label}</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

/** Read-only saved baseline. Every number comes from the saved record; nothing is computed here. */
export function SavedBaselineView({ baseline: b }: { baseline: SavedBaseline }) {
  const { weeks, lowPoint } = b.forecast;
  const first = weeks[0]?.weekStart;
  const last = weeks[weeks.length - 1]?.weekStart;
  return (
    <article data-testid="saved-baseline" className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Saved forecast, read only</Badge>
          <span className="text-xs text-muted-foreground">Saved {formatSavedAt(b.savedAt)}</span>
        </div>
        <h2 data-testid="baseline-headline" className="text-2xl font-medium">
          {b.companyName}&rsquo;s usable cash is lowest in the week of{" "}
          <WhenDate iso={lowPoint.weekStart} />, at {formatExactCents(lowPoint.usable)}
        </h2>
        <p className="text-sm text-muted-foreground">
          13 weeks from {first ? <WhenDate iso={first} /> : "?"} to{" "}
          {last ? <WhenDate iso={last} /> : "?"}, under the assumptions below. Weeks start on
          Monday.
        </p>
      </header>

      <Block title="Week by week">
        <Table data-testid="baseline-weeks">
          <TableCaption>
            Usable cash is ending cash minus money that cannot be spent. Exact dollars.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Week of</TableHead>
              <TableHead className="text-right">Starting cash</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Money out</TableHead>
              <TableHead className="text-right">Ending cash</TableHead>
              <TableHead className="text-right">Usable cash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((w) => {
              const low = w.weekStart === lowPoint.weekStart;
              return (
                <TableRow
                  key={w.weekStart}
                  data-testid={`week-${w.weekStart}`}
                  data-low-point={low || undefined}
                  className={low ? "bg-muted/60" : undefined}
                >
                  <TableCell className="whitespace-nowrap">
                    <WhenDate iso={w.weekStart} />
                    {low ? (
                      <Badge variant="outline" className="ml-2">
                        Lowest
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatExactCents(w.opening)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatExactCents(w.inflow)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatExactCents(w.outflow)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatExactCents(w.closing)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {formatExactCents(w.usable)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Block>

      <Block title="What follows from it">
        {b.dominoes.length ? (
          <ol className="space-y-2 text-sm" data-testid="baseline-dominoes">
            {b.dominoes.map((d) => (
              <li key={d.order}>
                <span className="text-muted-foreground">
                  Week of <WhenDate iso={d.weekStart} />:
                </span>{" "}
                {d.label}
                {d.evidence.length ? (
                  <span className="block text-xs text-muted-foreground">
                    {d.evidence.map((e) => e.note).join(" ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="baseline-dominoes">
            No problems were saved with this forecast.
            {b.constraints.length ? null : " With no cash rules added, no rule can be broken."}
          </p>
        )}
      </Block>

      <Block title="Assumptions used">
        <p className="max-w-3xl whitespace-pre-wrap text-sm" data-testid="baseline-note">
          {b.assumptionNote || "No note was saved."}
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Model version {b.model.version}</li>
          <li>
            {Object.keys(b.model.customerDelayDays).length} customer payment delays,{" "}
            {b.model.recurringSpend.length} recurring costs, {b.model.rules.length} learned rules
          </li>
          {b.constraints.length ? (
            b.constraints.map((c) => (
              <li key={c.id}>
                {c.label}: {constraintText(c)}
              </li>
            ))
          ) : (
            <li>No lender&rsquo;s limits or other cash rules</li>
          )}
        </ul>
      </Block>

      <Block title="Where this came from">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Company">
            {b.companyName} ({b.companyId})
          </Fact>
          <Fact label="Weekly seed">
            {b.seed.id}, exported {formatSavedAt(b.seed.exportedAt)}
          </Fact>
          <Fact label="Seed fingerprint">{b.seedHash}</Fact>
          <Fact label="Inputs fingerprint">{b.inputHash}</Fact>
          <Fact label="Method">{b.methodVersion}</Fact>
          <Fact label="Saved forecast">{b.runId}</Fact>
        </dl>
        <p className="text-xs text-muted-foreground">
          {b.history.length} past weeks and {b.pastEvents.length} past events were saved with this
          forecast.
        </p>
        <div className="space-y-2">
          <RawInput label="Show the original weekly seed" value={b.seed} />
          <RawInput label="Show the model as saved" value={b.model} />
          <RawInput label="Show the cash rules as saved" value={b.constraints} />
        </div>
      </Block>
    </article>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border p-5 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

/** Every state of opening a saved link, so loading or failure never looks like an empty forecast. */
export function SavedBaselineState({ read }: { read: BaselineRead | { state: "unavailable" } }) {
  if (read.state === "ready") return <SavedBaselineView baseline={read.baseline} />;
  if (read.state === "loading")
    return (
      <div className="space-y-3" aria-busy="true">
        <output className="block text-sm text-muted-foreground">
          Opening the saved forecast...
        </output>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (read.state === "missing")
    return (
      <Notice title="No saved forecast at this link">
        Nothing was found for this company and forecast. Check the link, or save a new baseline
        below.
      </Notice>
    );
  if (read.state === "unavailable")
    return (
      <Notice title="Cannot open saved forecasts here">
        This page is not connected to the forecast service, so saved forecasts cannot be opened.
      </Notice>
    );
  return (
    <Notice title="This saved forecast cannot be shown">
      The service answered, but the record was not in the expected shape, so it is not shown.
    </Notice>
  );
}
