"use client";

import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { formatDate } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { ToolLogo } from "../../icons/ToolLogo";
import { Badge } from "../../ui/badge";
import { PageHeader, Section, StatTile } from "../../ui/page";
import { Skeleton } from "../../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { OpenInTimeline } from "../OpenInTimeline";
import { AgentsGate } from "../agents";
import { useSelectedCompany, useSelectedCompanyName } from "../company";
import { formatCents } from "../dashboard/money";
import type { CustomerRow, CustomersView, RiskLevel } from "./derive";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const UNKNOWN = <span className="text-muted-foreground">unknown</span>;
const TOOL_NAME = { stripe: "Stripe", qbo: "QuickBooks", hubspot: "HubSpot" } as const;
const CADENCE: Record<number, string> = { 1: "mo", 3: "qtr", 12: "yr" };
const date = (d: string | null) => (d ? formatDate(d.slice(0, 10)) : null);
const pct = (x: number | null) => (x === null ? null : `${(x * 100).toFixed(1)}%`);

export function CustomersPage() {
  if (!CONVEX_URL)
    return <Notice title="Backend needed">Customers read the saved books from the backend.</Notice>;
  return <Live />;
}

function Live() {
  const { companyId, error } = useSelectedCompany();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated || companyId === undefined) return <Loading />;
  if (error) return <Notice title="Company could not connect">{error}</Notice>;
  if (!companyId) return <Loading />;
  return (
    <AgentsGate
      idle={() => (
        <Shell>
          <Notice title="Books not read yet">
            Customer balances, payment behavior and risk appear after the agents read the books.
            Start the agents on the Brain map.
          </Notice>
        </Shell>
      )}
    >
      <Body companyId={companyId} />
    </AgentsGate>
  );
}

function Shell({ children, view }: { children: ReactNode; view?: CustomersView }) {
  const company = useSelectedCompanyName();
  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader
        eyebrow={company}
        title="Customers"
        description={
          view
            ? `Recurring revenue, receivables, payment behavior and risk from the books as of ${date(view.asOf)}.`
            : "Recurring revenue, receivables, payment behavior and risk from the saved books."
        }
        actions={view ? <OpenInTimeline variant="outline" /> : null}
      />
      {children}
    </div>
  );
}

function Body({
  companyId,
}: { companyId: NonNullable<ReturnType<typeof useSelectedCompany>["companyId"]> }) {
  const data = useQuery(api.fieldCustomers.list, { companyId });
  if (data === undefined) return <Loading />;
  if (data === null || data.result === null)
    return (
      <Shell>
        <Notice title="Waiting for the first read of the books">
          No snapshot is saved for this company yet.
        </Notice>
      </Shell>
    );
  const view = data.result;
  const rows = view.customers;
  const atRisk = rows.filter((r) => r.risk.level !== "low");
  const overdue = rows.reduce((s, r) => s + r.overdueAmount, 0);
  const open = rows.reduce((s, r) => s + r.openAmount, 0);
  const top = rows
    .filter((r) => r.recurringShare !== null)
    .sort((a, b) => (b.recurringShare ?? 0) - (a.recurringShare ?? 0))[0];
  return (
    <Shell view={view}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Monthly recurring revenue"
          value={view.totalMonthlyRecurring ? formatCents(view.totalMonthlyRecurring) : "unknown"}
          delta={
            view.totalMonthlyRecurring
              ? `${formatCents(view.totalMonthlyRecurring * 12)} annualized`
              : "No active billing plans"
          }
        />
        <StatTile
          label="Open receivables"
          value={formatCents(open)}
          delta={`${formatCents(overdue)} overdue`}
          tone={overdue > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Largest customer share"
          value={top ? (pct(top.recurringShare) ?? "unknown") : "unknown"}
          delta={top?.name}
          tone={top && (top.recurringShare ?? 0) >= 0.2 ? "negative" : "neutral"}
        />
        <StatTile
          label="Customers at risk"
          value={`${atRisk.length}`}
          unit={`of ${rows.length}`}
          delta={`${rows.filter((r) => r.risk.level === "high").length} high`}
          tone={atRisk.some((r) => r.risk.level === "high") ? "negative" : "neutral"}
        />
      </div>

      <Section
        title="Customer ledger"
        description="Sorted by risk. Recurring amounts come from billing plans; receivables from open invoices."
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Plans</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead className="text-right">Annual</TableHead>
              <TableHead>Next bill</TableHead>
              <TableHead className="text-right">Open invoices</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Share of recurring</TableHead>
              <TableHead>Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="flex -space-x-1">
                      {r.sources.map((s) => (
                        <ToolLogo key={s} vendor={s} size={18} title={TOOL_NAME[s]} />
                      ))}
                    </span>
                    <span className="font-medium">{r.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.plans.length
                    ? r.plans
                        .map(
                          (p) =>
                            `${formatCents(p.amount)}/${CADENCE[p.everyMonths] ?? `${p.everyMonths}mo`}${p.active ? "" : " (ended)"}`,
                        )
                        .join(", ")
                    : "No plan"}
                </TableCell>
                <TableCell className="text-right">
                  {r.monthlyRecurring === null ? UNKNOWN : formatCents(r.monthlyRecurring)}
                </TableCell>
                <TableCell className="text-right">
                  {r.annualRecurring === null ? UNKNOWN : formatCents(r.annualRecurring)}
                </TableCell>
                <TableCell>{date(r.nextBillDate) ?? UNKNOWN}</TableCell>
                <TableCell className="text-right">
                  {r.openInvoices ? `${r.openInvoices} · ${formatCents(r.openAmount)}` : "0"}
                </TableCell>
                <TableCell className={cn("text-right", r.overdueAmount > 0 && "text-destructive")}>
                  {r.overdueAmount ? formatCents(r.overdueAmount) : "$0"}
                </TableCell>
                <TableCell className="text-right">{pct(r.recurringShare) ?? UNKNOWN}</TableCell>
                <TableCell>
                  <RiskBadge level={r.risk.level} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Learned from payment history"
        description="Days late the forecast applies to each customer. Same order the forecast uses: learned payment model, else this customer's paid invoices, else customers on the same terms."
        flush
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead className="text-right">Avg days late</TableHead>
              <TableHead className="text-right">Paid invoices observed</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.termsDays === 0 ? "Due on receipt" : `Net ${r.termsDays}`}</TableCell>
                <TableCell className="text-right">{r.payment.delayDays}</TableCell>
                <TableCell className="text-right">{r.payment.paidCount}</TableCell>
                <TableCell>
                  {r.payment.trend === null
                    ? UNKNOWN
                    : r.payment.trend === "slower"
                      ? "Paying slower"
                      : r.payment.trend === "faster"
                        ? "Paying faster"
                        : "Steady"}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.payment.basisLabel}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Customer risk and domino chains"
        description={`Reasons come from engine risks, payment history, concentration, plan changes, open audit flags and saved public news. Each chain is computed by the forecast engine against the current low point of ${formatCents(view.baseLowPoint.usable)} in the week of ${date(view.baseLowPoint.weekStart)}.`}
        card={false}
      >
        {atRisk.length === 0 ? (
          <Notice title="No customer risk found">
            No customer shows late payment, concentration, plan changes or open flags in these
            books.
          </Notice>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {atRisk.map((r) => (
              <RiskCard key={r.id} row={r} />
            ))}
          </div>
        )}
      </Section>
    </Shell>
  );
}

function RiskCard({ row }: { row: CustomerRow }) {
  const chain = row.chain;
  return (
    <div
      className="rounded-lg border bg-card p-[var(--card-pad)] shadow-xs"
      data-testid="customer-risk"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {row.sources.map((s) => (
            <ToolLogo key={s} vendor={s} size={18} title={TOOL_NAME[s]} />
          ))}
          <span className="text-[15px] font-semibold">{row.name}</span>
        </div>
        <RiskBadge level={row.risk.level} />
      </div>
      <ul className="mt-3 space-y-1 text-sm leading-5 text-muted-foreground">
        {row.risk.reasons.map((reason) => (
          <li key={reason.text} className="flex gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                reason.level === "high" ? "bg-destructive" : "bg-warning",
              )}
            />
            {reason.text}
          </li>
        ))}
      </ul>
      {chain ? (
        <div className="mt-4 border-t pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Domino chain{chain.assumption ? " (stress assumption)" : ""}
          </div>
          <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            <Step>
              If {chain.scenario}
              {chain.probability !== null
                ? ` (${Math.round(chain.probability * 100)}% chance)`
                : ""}
            </Step>
            <Arrow />
            <Step>
              {chain.lowPoint.usable < chain.baseLowPoint.usable
                ? `Cash low point falls to ${formatCents(chain.lowPoint.usable)} in week of ${date(chain.lowPoint.weekStart)} (${formatCents(chain.lowPoint.usable - chain.baseLowPoint.usable)})`
                : `Cash low point unchanged at ${formatCents(chain.lowPoint.usable)} in week of ${date(chain.lowPoint.weekStart)}`}
            </Step>
            {chain.dominoes
              .filter(
                (d) => (d.constraintId || d.causedBy) && !chain.alreadyInBase.includes(d.order),
              )
              .map((d) => (
                <span key={d.order} className="contents">
                  <Arrow />
                  <Step tone={d.constraintId ? "danger" : undefined}>{d.label}</Step>
                </span>
              ))}
          </ol>
          {chain.dominoes.every((d) => !d.constraintId || chain.alreadyInBase.includes(d.order)) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No new cash rule breaks in this stress.
              {chain.alreadyInBase.length
                ? ` Already breached in the base forecast: ${chain.dominoes
                    .filter((d) => chain.alreadyInBase.includes(d.order))
                    .map((d) => d.label)
                    .join("; ")}.`
                : ""}
            </p>
          ) : null}
          <div className="mt-3">
            <OpenInTimeline variant="outline" />
          </div>
        </div>
      ) : row.chainNote ? (
        <p className="mt-3 text-xs text-muted-foreground">{row.chainNote}</p>
      ) : null}
    </div>
  );
}

function Step({ children, tone }: { children: ReactNode; tone?: "danger" }) {
  return (
    <li
      className={cn(
        "rounded-md border bg-muted/40 px-2 py-0.5",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.06] text-destructive",
      )}
    >
      {children}
    </li>
  );
}
const Arrow = () => (
  <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
);

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge variant={level === "high" ? "destructive" : level === "medium" ? "warning" : "success"}>
      {level === "high" ? "High" : level === "medium" ? "Watch" : "Low"}
    </Badge>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-4" aria-busy="true">
      <p className="text-sm text-muted-foreground">Reading the latest books...</p>
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-[var(--card-pad)] shadow-xs">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}
