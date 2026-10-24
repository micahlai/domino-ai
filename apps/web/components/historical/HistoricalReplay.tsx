"use client";

import type { ISODate } from "@domino/contracts";
import { FileText } from "lucide-react";
import { useState } from "react";
import { formatCents } from "../../lib/format";
import { cn } from "../../lib/utils";
import { ActivityPanel } from "../ActivityPanel";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { HistoricalChart, chartPoints } from "./HistoricalChart";
import { formatReportDate } from "./format";
import type {
  AlternativeView,
  ComparisonRow,
  HistoricalEvidence,
  HistoricalView,
  Provenance,
} from "./types";

const provenanceText: Record<Provenance, string> = {
  reported: "Reported",
  derived: "Derived from reported",
  assumption: "Assumption",
  synthetic: "Synthetic detail",
};

const provenanceClass: Record<Provenance, string> = {
  reported: "border-transparent bg-primary/15 text-primary",
  derived: "border-transparent bg-secondary text-secondary-foreground",
  assumption: "border-dashed bg-transparent text-clay",
  synthetic: "border-dashed bg-transparent text-muted-foreground",
};

export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  return <Badge className={cn("font-medium", provenanceClass[kind])}>{provenanceText[kind]}</Badge>;
}

const outcomeText: Record<ComparisonRow["outcome"], string> = {
  within_range: "Within the saved range",
  miss: "Missed the saved range",
  unscored: "Not scored",
};

const stages = [
  { id: "baseline", label: "Saved forecast" },
  { id: "observed", label: "What was reported" },
  { id: "response", label: "One alternative" },
] as const;

export interface HistoricalReplayProps {
  view?: HistoricalView;
  status?: "ready" | "loading" | "error" | "unavailable";
  /** Plain-words detail for the error and unavailable states. */
  statusMessage?: string;
}

function DateFacts({ view }: { view: HistoricalView }) {
  const { dates } = view;
  const facts = [
    ["Knowledge cutoff", dates.knowledgeCutoff, "Nothing published after this date was used."],
    ["Last reported", dates.lastReportedOn, "Latest balance date in the filings available."],
    ["Projected through", dates.projectedThrough, "Last period the saved forecast covers."],
    dates.revealedOn
      ? ["Disclosure published", dates.revealedOn, "Revealed after the forecast was saved."]
      : null,
  ].filter((fact): fact is [string, ISODate, string] => fact !== null);
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map(([label, date, hint]) => (
        <div key={label} className="space-y-1">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium">{formatReportDate(date)}</dd>
          <dd className="text-xs leading-5 text-muted-foreground">{hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceDetail({ item }: { item: HistoricalEvidence }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge kind={item.provenance} />
        <span className="text-xs text-muted-foreground">
          Published {formatReportDate(item.publishedOn)}
        </span>
      </div>
      <p className="break-words text-sm font-medium">{item.label}</p>
      <p className="break-words text-xs text-muted-foreground">
        {item.source}
        {item.locator ? ` · ${item.locator}` : ""}
      </p>
      {item.quote ? (
        <blockquote className="border-l-2 pl-4 text-sm leading-6">{item.quote}</blockquote>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
    </div>
  );
}

export function EvidenceList({ evidence }: { evidence: HistoricalEvidence[] }) {
  return evidence.length ? (
    <>
      {evidence.map((item) => (
        <EvidenceDetail key={item.id} item={item} />
      ))}
    </>
  ) : (
    <p className="text-sm text-muted-foreground">No sources are attached yet.</p>
  );
}

function EvidenceSheet({ evidence }: { evidence: HistoricalEvidence[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FileText className="mr-2 size-4" aria-hidden="true" />
          Show sources and assumptions
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Sources and assumptions</SheetTitle>
          <SheetDescription>
            Each item says whether it was reported, derived, assumed or invented detail.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-8 space-y-8">
          <EvidenceList evidence={evidence} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Comparison({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Saved forecast versus what was reported
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The forecast was saved before these results were published. It is not changed here, and
          misses stay visible.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period end</TableHead>
              <TableHead>Saved forecast</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>Reported minus forecast</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.period}>
                <TableCell>{formatReportDate(row.period)}</TableCell>
                <TableCell>{formatCents(row.projected)}</TableCell>
                <TableCell>
                  {row.observed !== undefined ? formatCents(row.observed) : "Not reported yet"}
                </TableCell>
                <TableCell>
                  {row.difference !== undefined
                    ? `${row.difference > 0 ? "+" : ""}${formatCents(row.difference)}`
                    : "n/a"}
                </TableCell>
                <TableCell>
                  <span className={row.outcome === "miss" ? "text-destructive" : undefined}>
                    {outcomeText[row.outcome]}
                  </span>
                  {row.note ? (
                    <span className="block text-xs text-muted-foreground">{row.note}</span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Alternative({ alt }: { alt: AlternativeView }) {
  const rows: [string, string, string][] = [
    ["Cost up front", formatCents(alt.upfrontCost), "Paid before any benefit."],
    [
      "Benefit later",
      formatCents(alt.delayedBenefit),
      `Starts after ${formatReportDate(alt.benefitFrom)}.`,
    ],
    ["Downside", formatCents(alt.downside), alt.downsideNote],
  ];
  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm font-medium">{alt.label}</CardTitle>
          {alt.postHoc ? (
            <Badge variant="outline" className="border-dashed text-clay">
              Post-hoc: chosen after the reveal
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Starts from the same evidence as the saved forecast. A projection, not a result.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          {rows.map(([label, value, hint]) => (
            <div key={label} className="space-y-1">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-base font-medium">{value}</dd>
              <dd className="text-xs leading-5 text-muted-foreground">{hint}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <h4 className="text-xs text-muted-foreground">Assumptions this depends on</h4>
          <ul className="space-y-2 text-sm leading-6">
            {alt.assumptions.map((a) => (
              <li key={a.text} className="flex flex-wrap items-baseline gap-2">
                <ProvenanceBadge kind="assumption" />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function HistoricalReplay({ view, status = "ready", statusMessage }: HistoricalReplayProps) {
  const [selectedId, setSelectedId] = useState<string>();
  if (status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <output className="block text-sm text-muted-foreground">
          Loading the saved case and the disclosures available at its cutoff…
        </output>
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (status !== "ready" || !view) {
    return (
      <div role="alert" className="rounded-lg border p-5 text-sm">
        <p className="font-medium">
          {status === "unavailable"
            ? "The historical case is not available yet."
            : "Could not load this case."}
        </p>
        <p className="mt-1 text-muted-foreground">
          {statusMessage ?? "Nothing was saved or changed. Try again in a moment."}
        </p>
      </div>
    );
  }
  const selected = chartPoints(view).find((p) => p.id === selectedId);
  const selectedEvidence = view.evidence.find((e) => e.id === selected?.evidenceId);
  const stageIndex = stages.findIndex((s) => s.id === view.stage);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ol aria-label="Journey" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {stages.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === view.stage ? "step" : undefined}
              className={i <= stageIndex ? "font-medium" : "text-muted-foreground"}
            >
              {i + 1}. {s.label}
              {i > stageIndex ? " (not revealed yet)" : ""}
            </li>
          ))}
        </ol>
        <DateFacts view={view} />
      </div>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="5" fill="hsl(var(--primary-ink))" />
              </svg>
              Reported balance
            </span>
            {view.nowcast ? (
              <span className="inline-flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true">
                  <circle
                    cx="6"
                    cy="6"
                    r="4.5"
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--primary-ink))"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                </svg>
                Modeled estimate at cutoff
              </span>
            ) : null}
            <span className="inline-flex items-center gap-2">
              <svg width="12" height="12" aria-hidden="true">
                <rect
                  x="2.5"
                  y="2.5"
                  width="7"
                  height="7"
                  transform="rotate(45 6 6)"
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--primary-ink))"
                  strokeWidth="1.5"
                />
              </svg>
              Projected, hollow and dashed
            </span>
            {view.alternative ? (
              <span className="inline-flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true">
                  <rect
                    x="2.5"
                    y="2.5"
                    width="7"
                    height="7"
                    transform="rotate(45 6 6)"
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--clay))"
                    strokeWidth="1.5"
                  />
                </svg>
                Alternative, projected
              </span>
            ) : null}
            <span>One point per reported period. No weekly values.</span>
          </div>
          <HistoricalChart view={view} selectedId={selectedId} onSelect={setSelectedId} />
          <div aria-live="polite" className="min-h-16 rounded-lg bg-muted/40 p-4">
            {selected ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {formatReportDate(selected.date)}: {formatCents(selected.cash)}
                </p>
                {selectedEvidence ? (
                  <EvidenceDetail item={selectedEvidence} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No source is attached to this point.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a point, with the mouse or the keyboard, to see where it comes from.
              </p>
            )}
          </div>
          <EvidenceSheet evidence={view.evidence} />
        </CardContent>
      </Card>
      {view.comparison.length ? <Comparison rows={view.comparison} /> : null}
      {view.alternative ? <Alternative alt={view.alternative} /> : null}
      <ActivityPanel source="unavailable" />
    </div>
  );
}
