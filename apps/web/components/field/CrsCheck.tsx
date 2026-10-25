import { ToolLogo } from "../icons/ToolLogo";
import { Badge } from "../ui/badge";
import type { FieldCrs } from "./types";

// The CRS identity and fraud check on a payment-change flag (convex/fieldCrs.ts). Shows the
// verdict, the CRS fields behind it, and says plainly that a sandbox persona stands in for the
// vendor's account owner.

const VERDICT: Record<
  FieldCrs["verdict"],
  { label: string; variant: "success" | "destructive" | "secondary" }
> = {
  verified: { label: "Identity verified", variant: "success" },
  signals: { label: "Fraud signals", variant: "destructive" },
  unavailable: { label: "CRS unreachable", variant: "secondary" },
  not_configured: { label: "CRS not configured", variant: "secondary" },
  capped: { label: "CRS limit reached", variant: "secondary" },
};

export function CrsCheck({ crs }: { crs: FieldCrs }) {
  const v = VERDICT[crs.verdict];
  const facts: { label: string; value: string }[] = [];
  if (crs.identity) {
    facts.push({ label: "TransUnion TruValidate", value: crs.identity.result });
    for (const m of crs.identity.messages)
      facts.push({ label: `Code ${m.code || "?"}`, value: m.text || "identity problem" });
  }
  if (crs.fraud) {
    if (crs.fraud.score !== null)
      facts.push({ label: "Fraud Finder risk", value: `${crs.fraud.score} / 100` });
    if (crs.fraud.emailStatus) facts.push({ label: "Email", value: crs.fraud.emailStatus });
    if (crs.fraud.emailFirstSeen)
      facts.push({ label: "Email first seen", value: crs.fraud.emailFirstSeen });
    if (crs.fraud.domainRisk !== null)
      facts.push({ label: "Domain risk", value: `${crs.fraud.domainRisk} / 10` });
    if (crs.fraud.phoneMatch) facts.push({ label: "Phone owner", value: crs.fraud.phoneMatch });
  }
  const ids = [crs.identity?.requestId, crs.fraud?.requestId].filter(Boolean);
  return (
    <div className="mt-3 rounded-md border bg-muted/40 p-3 text-[13px] leading-5">
      <div className="flex flex-wrap items-center gap-2">
        <ToolLogo vendor="crs" size={18} />
        <span className="font-medium">Identity & fraud check (CRS sandbox)</span>
        <Badge variant={v.variant}>{v.label}</Badge>
      </div>
      <p className="mt-1.5">{crs.headline}</p>
      {facts.length > 0 ? (
        <dl className="mt-1.5 space-y-0.5">
          {facts.map((f) => (
            <div key={`${f.label}:${f.value}`} className="flex min-w-0 justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 text-right font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {crs.detail ? <p className="mt-1.5 text-muted-foreground">{crs.detail}</p> : null}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Sandbox persona {crs.personaId} {crs.personaName} ({crs.personaProfile}) stands in for the
        vendor's account owner; Domino's vendors are simulated.{" "}
        {crs.cached
          ? "Reused an earlier CRS sandbox answer for this persona (no new call)."
          : crs.calls > 0
            ? `${crs.calls} live CRS calls.`
            : ""}
        {ids.length > 0 ? ` CRS request ${ids.join(", ")}.` : ""}
      </p>
    </div>
  );
}
