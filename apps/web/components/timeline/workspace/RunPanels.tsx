import type { Domino, ScheduledItem } from "@domino/contracts";
import type { ReactNode } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatFullDate } from "../baseline/format";
import type { RuleReceipt, WorkspaceRun } from "./api";
import { changeText } from "./drafts";

export const WhenDate = ({ iso }: { iso: string }) => (
  <time dateTime={iso}>{formatFullDate(iso)}</time>
);

/** A server-supplied difference with its sign spelled out. Formatting only. */
export function formatDelta(cents: number): string {
  if (cents === 0) return "no change";
  return cents > 0 ? `+${formatExactCents(cents)}` : formatExactCents(cents);
}

export function Panel({
  title,
  children,
  testId,
  bare = false,
}: { title: string; children: ReactNode; testId?: string; bare?: boolean }) {
  return (
    <section
      className={`min-w-0 max-w-full space-y-3 [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal max-sm:[&_button]:min-h-11 ${bare ? "" : "rounded-lg border bg-card p-4 text-card-foreground shadow-xs"}`}
      data-testid={testId}
    >
      <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      {children}
    </section>
  );
}

const ITEM_KIND: Record<ScheduledItem["kind"], string> = {
  receivable: "Customer payment",
  payable: "Bill",
  payroll: "Payroll",
  other: "Other",
};
const ITEM_STATUS: Record<ScheduledItem["status"], string> = {
  expected: "expected",
  confirmed: "confirmed",
  at_risk: "at risk",
};

/** The chosen week: saved values, the server's difference, and the items scheduled in it. */
export function WeekDetail({
  run,
  weekStart,
  selectedItemId,
  onSelectItem,
}: {
  run: WorkspaceRun;
  weekStart: string | null;
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
}) {
  const week = run.forecast.weeks.find((w) => w.weekStart === weekStart);
  if (!week)
    return (
      <Panel title="Chosen week" testId="week-detail">
        <p className="text-sm text-muted-foreground">
          Choose a week on the chart to see its saved numbers and original imported schedule.
        </p>
      </Panel>
    );
  const delta = run.comparison?.weekly.find((d) => d.weekStart === week.weekStart);
  const items = run.baseline.seed.scheduledItems.filter((i) => i.dueWeek === week.weekStart);
  return (
    <Panel title="Chosen week" testId="week-detail">
      <p className="text-sm">
        Week of <WhenDate iso={week.weekStart} />: usable cash{" "}
        <span className="whitespace-nowrap font-mono tabular-nums">
          {formatExactCents(week.usable)}
        </span>
        {delta ? (
          <span className="text-muted-foreground" data-testid="week-delta">
            {" "}
            ({formatDelta(delta.usableDelta)} against the scenario it started from)
          </span>
        ) : null}
      </p>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 text-xs">
        {(
          [
            ["Starting cash", week.opening],
            ["Money in", week.inflow],
            ["Money out", week.outflow],
            ["Ending cash", week.closing],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-nowrap font-mono tabular-nums">{formatExactCents(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Original imported schedule. These items keep their original weeks; scenario changes are
        reflected in the saved cash numbers above.
      </p>
      {items.length ? (
        <ul className="space-y-1" aria-label="Original schedule for this week">
          {items.map((it) => {
            const selected = it.id === selectedItemId;
            return (
              <li key={it.id}>
                <Button
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  className="h-auto w-full justify-start whitespace-normal py-1.5 text-left"
                  onClick={() => onSelectItem(selected ? null : it.id)}
                  data-testid={`item-${it.id}`}
                >
                  {ITEM_KIND[it.kind]}: {it.counterparty}, {formatExactCents(it.cents)} (
                  {ITEM_STATUS[it.status]})
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No items were imported for this week.</p>
      )}
    </Panel>
  );
}

/** Low point and weekly differences against the parent, exactly as the service saved them. */
export function ComparisonPanel({ run }: { run: WorkspaceRun }) {
  const c = run.comparison;
  if (!c)
    return (
      <Panel title="Compared with" testId="comparison">
        <p className="text-sm text-muted-foreground">
          This is the imported baseline, so there is nothing earlier to compare with.
        </p>
      </Panel>
    );
  const changed = c.weekly.filter((w) => w.usableDelta !== 0);
  return (
    <Panel title="Compared with the scenario it started from" testId="comparison">
      <p className="text-sm" data-testid="low-point-delta">
        Low point: {formatDelta(c.lowPointDelta)}
      </p>
      {changed.length ? (
        <ul className="space-y-1 text-xs">
          {changed.map((w) => (
            <li key={w.weekStart} className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                Week of <WhenDate iso={w.weekStart} />
              </span>
              <span className="font-mono tabular-nums">{formatDelta(w.usableDelta)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Usable cash is the same in every week.</p>
      )}
    </Panel>
  );
}

const STATUS: Record<RuleReceipt["status"], { text: string; tone: "bad" | "ok" | "plain" }> = {
  breached: { text: "Outside the rule", tone: "bad" },
  clear: { text: "No breach found in these 13 weeks", tone: "plain" },
  beyond_horizon: { text: "Beyond the 13 weeks", tone: "plain" },
  unable: { text: "Cannot be checked", tone: "plain" },
};
const RELATION: Record<RuleReceipt["relation"], string> = {
  new: "New in this scenario",
  pre_existing: "Already outside the rule in the scenario it started from",
  resolved: "Earlier breach no longer found in these 13 weeks",
  clear: "No breach found in either saved 13-week forecast",
  outside_horizon: "Falls after the forecast ends",
  unable: "The saved data is not enough to check it",
};

function measure(unit: RuleReceipt["unit"], v: number): string {
  if (unit === "cents") return Number.isSafeInteger(v) ? formatExactCents(v) : `${v} cents`;
  return unit === "months" ? `${v} months` : `${v} days`;
}

/** Rule results with their saved evidence. Runway values stay blank when not supplied. */
export function ReceiptsPanel({ run }: { run: WorkspaceRun }) {
  return (
    <Panel title="Cash rules" testId="receipts">
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">How rules are checked</summary>
        <p className="mt-1">
          Cash minimums use Sunday closing usable cash. Runway uses the forecast’s average monthly
          cash use. Bill rules check the allowed payment deadline. These checks cover the saved
          13-week forecast; they do not establish daily cash compliance.
        </p>
      </details>
      {run.receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cash rules are set for this scenario. No rule check has been made.
        </p>
      ) : (
        <ul className="space-y-3">
          {run.receipts.map((r) => {
            const s = STATUS[r.status];
            return (
              <li
                key={r.constraintId}
                className="space-y-1 text-sm"
                data-testid={`receipt-${r.constraintId}`}
                data-status={r.status}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.label}</span>
                  <Badge
                    variant={
                      s.tone === "bad" ? "destructive" : s.tone === "ok" ? "success" : "secondary"
                    }
                  >
                    {s.text}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{RELATION[r.relation]}</p>
                <p className="text-xs">
                  Limit {measure(r.unit, r.limit)}
                  {r.value !== null ? `; projected ${measure(r.unit, r.value)}` : ""}
                  {r.shortfall !== null ? `; short by ${measure(r.unit, r.shortfall)}` : ""}
                  {r.date ? (
                    <>
                      {" "}
                      on <WhenDate iso={r.date} />
                    </>
                  ) : r.weekStart ? (
                    <>
                      {" "}
                      in the week of <WhenDate iso={r.weekStart} />
                    </>
                  ) : null}
                </p>
                {r.actionLabels.length ? (
                  <p className="text-xs">
                    Scenario inputs checked together: {r.actionLabels.join("; ")}. This check does
                    not attribute the breach to an individual input.
                  </p>
                ) : null}
                {r.evidence.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Show proof</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {r.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ImpactPanel({ dominoes }: { dominoes: Domino[] }) {
  return (
    <Panel title="Projected impact" testId="impact">
      {dominoes.length ? (
        <ol className="space-y-2 text-sm">
          {dominoes.map((d) => (
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
        <p className="text-sm text-muted-foreground">No problems were saved with this scenario.</p>
      )}
    </Panel>
  );
}

export function ChangesPanel({ run }: { run: WorkspaceRun }) {
  const inherited = run.changes.length - run.ownChanges.length;
  return (
    <Panel title="What this scenario changes" testId="changes">
      {run.ownChanges.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {run.ownChanges.map((c, i) => (
            // Changes have no id; order is fixed in the saved record.
            // biome-ignore lint/suspicious/noArrayIndexKey: saved order is stable
            <li key={i}>{changeText(c, formatExactCents)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {run.kind === "rules"
            ? "Only the cash rules changed here."
            : run.kind === "baseline"
              ? "Nothing: this is the imported baseline."
              : "No changes of its own."}
        </p>
      )}
      {inherited > 0 ? (
        <p className="text-xs text-muted-foreground">
          Plus {inherited} {inherited === 1 ? "change" : "changes"} from earlier scenarios.
        </p>
      ) : null}
    </Panel>
  );
}
